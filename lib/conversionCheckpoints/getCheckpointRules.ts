/**
 * Server-only: Airtable conversion checkpoints → scan `Rule` shape.
 * Field names match typical Airtable columns (override via env if yours differ).
 */

import checkpointsSnapshot from './checkpoints.snapshot.json'

export type ScannerStatus = 'Live' | 'Draft' | 'Off'

/**
 * One checkpoint as the scanner uses it. Airtable is the single source of truth:
 * the question, CXO Studio's pass / fail / not-relevant definitions, device, niches,
 * check method and status all come from the "Conversion Checkpoints" table.
 */
export type ScanRule = {
  id: string
  title: string
  description: string
  /** Scanner status. Missing on the legacy snapshot, which only held live checkpoints. */
  status?: ScannerStatus
  pageTypeIds?: string[]
  /** Part of the page the checkpoint is about (Airtable "Page area"). */
  area?: string
  device?: 'Both' | 'Desktop only' | 'Mobile only'
  method?: string
  pass?: string
  fail?: string
  na?: string
  nicheNotes?: string
  /** Niches where the checkpoint applies. Empty or 'All' = every store. */
  niches?: string[]
  /** Hard rule: 'not relevant' for these niches. */
  notRelevantNiches?: string[]
  shopifyControl?: string
  /** Where a pass may be found (Airtable "Seen in"). Empty or 'Anywhere' = no restriction. */
  seenIn?: string[]
  /** Shown in the free scan (Airtable "Free scan"); the rest of the results appear as a locked count. */
  freeScan?: boolean
  /** The fix in one sentence (Airtable "Short fix"), and the expected revenue effect 1 to 5 ("Impact weight"). */
  shortFix?: string
  impact?: number
}

export type AirtableSingleRecord = {
  id: string
  createdTime?: string
  fields?: Record<string, unknown>
}

const TITLE_FIELD_KEYS = [
  process.env.AIRTABLE_CHECKPOINT_TITLE_FIELD,
  'Conversion Checkpoint',
  'Title',
  'Name',
].filter(Boolean) as string[]

const DESCRIPTION_FIELD_KEYS = [
  process.env.AIRTABLE_CHECKPOINT_DESCRIPTION_FIELD,
  'Required Actions',
  'Description',
  'Notes',
].filter(Boolean) as string[]

function fieldString(fields: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    if (!(key in fields)) continue
    const v = fields[key]
    const s = stringifyFieldValue(v)
    if (s.trim()) return s.trim()
  }
  return ''
}

function stringifyFieldValue(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map(stringifyFieldValue).filter(Boolean).join(', ')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max - 1)}…`
}

export function mapAirtableRecordToRule(record: AirtableSingleRecord): ScanRule | null {
  const fields = record.fields ?? {}
  const titleRaw = fieldString(fields, TITLE_FIELD_KEYS)
  const descRaw = fieldString(fields, DESCRIPTION_FIELD_KEYS)
  if (!titleRaw && !descRaw) return null
  const title = truncate(titleRaw || 'Conversion checkpoint', 200)
  const description = truncate(descRaw || '(No required actions text)', 5000)
  const text = (key: string) => {
    const v = fields[key]
    return typeof v === 'string' && v.trim() ? v.trim() : undefined
  }
  const list = (key: string) => {
    const v = fields[key]
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined
  }
  const status = text('Scanner status')
  const device = text('Device')
  return {
    id: record.id,
    title,
    description,
    status: status === 'Live' || status === 'Draft' || status === 'Off' ? status : undefined,
    pageTypeIds: list('Page Type'),
    area: text('Page area'),
    device: device === 'Desktop only' || device === 'Mobile only' || device === 'Both' ? device : undefined,
    method: text('Check method'),
    pass: text('Pass when'),
    fail: text('Fail when'),
    na: text('Not relevant when'),
    nicheNotes: text('Niche notes'),
    niches: list('Niches'),
    notRelevantNiches: list('Not relevant for niches'),
    shopifyControl: text('Shopify control'),
    seenIn: list('Seen in'),
    freeScan: fields['Free scan'] === true,
    shortFix: text('Short fix'),
    impact: typeof fields['Impact weight'] === 'number' ? (fields['Impact weight'] as number) : undefined,
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Every checkpoint the scanner may run: not archived, Scanner status Live or Draft.
 * Which of them a given scan uses (page type, Live vs Draft, check method) is decided in
 * filterByUrlPageType.ts. Off and archived checkpoints never leave Airtable.
 */
const SCANNER_FORMULA = "AND(NOT({Archived}), OR({Scanner status}='Live', {Scanner status}='Draft'))"

/** Base list URL for the table (no `/rec…` retrieve suffix, no query string). */
export function getListRecordsBaseUrl(apiUrl: string): string {
  const u = new URL(apiUrl)
  let segments = u.pathname.split('/').filter(Boolean)
  if (segments.length >= 4 && /^rec[a-zA-Z0-9]+$/.test(segments[segments.length - 1]!)) {
    segments = segments.slice(0, -1)
  }
  const path = `/${segments.join('/')}`
  return `${u.origin}${path}`
}

function bodyLooksRateLimited(data: unknown): boolean {
  if (data == null) return false
  const s = JSON.stringify(data)
  return s.includes('RATE_LIMIT') || s.includes('rate limit')
}

type ListResponse = {
  records?: AirtableSingleRecord[]
  offset?: string
  error?: unknown
  errors?: unknown
}

/**
 * Fetches all records matching `filterByFormula`, following `offset` pagination.
 * Retries on 429 / Airtable rate-limit payloads with exponential backoff.
 */
export async function fetchAllRecordsForFormula(
  listBaseUrl: string,
  apiKey: string,
  filterByFormula: string,
): Promise<{ ok: true; records: AirtableSingleRecord[] } | { ok: false; status: number; body: unknown }> {
  const all: AirtableSingleRecord[] = []
  let offset: string | undefined

  for (;;) {
    const params = new URLSearchParams()
    params.set('filterByFormula', filterByFormula)
    params.set('pageSize', '100')
    if (offset) params.set('offset', offset)

    const url = `${listBaseUrl}?${params.toString()}`
    let lastStatus = 500
    let lastBody: unknown = null
    let page: ListResponse | null = null

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
      })
      lastStatus = res.status
      lastBody = await res.json().catch(() => ({}))
      page = lastBody as ListResponse

      if (res.ok) break

      const retry =
        res.status === 429 ||
        res.status === 503 ||
        bodyLooksRateLimited(lastBody)

      if (retry && attempt < 5) {
        const waitMs = Math.min(10_000, 400 * 2 ** attempt)
        console.warn(
          `[getConversionCheckpointRules] Airtable rate limit / transient ${res.status}, retry in ${waitMs}ms (attempt ${attempt + 1}/5)`,
        )
        await sleep(waitMs)
        continue
      }

      return { ok: false, status: res.status, body: lastBody }
    }

    const batch = page?.records ?? []
    all.push(...batch)
    offset = page?.offset
    if (!offset) break
  }

  return { ok: true, records: all }
}

export type GetCheckpointRulesResult =
  | {
      ok: true
      requestedIds: readonly string[]
      foundCount: number
      notFoundIds: string[]
      records: AirtableSingleRecord[]
      rules: ScanRule[]
    }
  | { ok: false; status: number; body: unknown }

/** Shape of the committed snapshot (lib/conversionCheckpoints/checkpoints.snapshot.json). */
export type CheckpointRulesSnapshot = {
  generatedAt: string | null
  requestedIds: string[]
  foundCount: number
  notFoundIds: string[]
  records: AirtableSingleRecord[]
  rules: ScanRule[]
}

type CheckpointRulesOk = Extract<GetCheckpointRulesResult, { ok: true }>

/**
 * In-memory "fresh from Airtable" cache, populated by the refresh endpoint / button / auto-refresh.
 * When present and within TTL it is served with zero network. When stale/missing we re-pull
 * Airtable so Example attachment URLs stay fresh. Snapshot is only
 * a fallback if Airtable is unreachable. Note: on serverless this lives per-instance.
 */
let liveCache: { data: CheckpointRulesOk; at: number } | null = null

/** Dedupes concurrent refreshes (scan + checkpoints route + cron) on the same instance. */
let refreshInFlight: Promise<CheckpointRulesOk | null> | null = null

/**
 * How long the in-memory Airtable cache is treated as fresh before a re-pull.
 * Default 1 hour, so a definition edited in Airtable reaches scans the same hour (the lab's
 * Promote and re-judge refresh at once); override with CHECKPOINTS_CACHE_TTL_MS (ms).
 */
const DEFAULT_CACHE_TTL_MS = 60 * 60_000 // 1 hour

function cacheTtlMs(): number {
  const n = parseInt(process.env.CHECKPOINTS_CACHE_TTL_MS ?? '', 10)
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_CACHE_TTL_MS
}

function isLiveCacheFresh(): boolean {
  return !!liveCache && Date.now() - liveCache.at < cacheTtlMs()
}

/** The committed snapshot mapped to a result, or null when it hasn't been populated yet. */
function snapshotResult(): CheckpointRulesOk | null {
  const snapshot = checkpointsSnapshot as unknown as CheckpointRulesSnapshot
  if (!snapshot || !Array.isArray(snapshot.rules) || snapshot.rules.length === 0) return null
  return {
    ok: true,
    requestedIds: snapshot.requestedIds ?? [],
    foundCount: snapshot.foundCount ?? snapshot.records.length,
    notFoundIds: snapshot.notFoundIds ?? [],
    records: snapshot.records ?? [],
    rules: snapshot.rules,
  }
}

/** Store a fresh Airtable pull as the active cache (called by the refresh endpoint). */
export function setCheckpointRulesCache(data: CheckpointRulesOk): void {
  liveCache = { data, at: Date.now() }
}

/** "Empty cache" — drop the in-memory copy so reads revert to the committed snapshot. */
export function clearCheckpointRulesCache(): void {
  liveCache = null
}

/**
 * Pull latest rules + example attachment URLs from Airtable and replace the live cache on success.
 * Does not clear existing cache first (keeps stale-but-usable data if the pull fails).
 */
export async function refreshCheckpointRulesCache(): Promise<{
  ok: true
  data: CheckpointRulesOk
} | {
  ok: false
  status: number
  body: unknown
}> {
  const result = await fetchCheckpointRulesFromAirtable()
  if (!result.ok) return result
  setCheckpointRulesCache(result)
  return { ok: true, data: result }
}

/**
 * Ensure live cache is fresh. Concurrent callers share one in-flight Airtable pull.
 * On pull failure returns prior live cache if any, else null (caller may use snapshot).
 */
async function ensureFreshLiveCache(): Promise<CheckpointRulesOk | null> {
  if (isLiveCacheFresh()) return liveCache!.data

  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const refreshed = await refreshCheckpointRulesCache()
        if (refreshed.ok) return refreshed.data
        console.warn(
          '[getConversionCheckpointRules] Airtable refresh failed; keeping prior cache/snapshot',
          refreshed.status,
          refreshed.body,
        )
        return liveCache?.data ?? null
      } finally {
        refreshInFlight = null
      }
    })()
  }

  return refreshInFlight
}

/** Status for the admin UI: is there a live cache, how old, how many rules, snapshot date. */
export function getCheckpointRulesCacheInfo(): {
  source: 'live-cache' | 'snapshot' | 'empty'
  cached: boolean
  ageMs: number | null
  ttlMs: number
  rulesCount: number
  snapshotGeneratedAt: string | null
} {
  const ttl = cacheTtlMs()
  const snapshot = checkpointsSnapshot as unknown as CheckpointRulesSnapshot
  const fresh = isLiveCacheFresh()
  return {
    source: fresh ? 'live-cache' : snapshotResult() ? 'snapshot' : 'empty',
    cached: !!fresh,
    ageMs: liveCache ? Date.now() - liveCache.at : null,
    ttlMs: ttl,
    rulesCount: fresh ? liveCache!.data.rules.length : (snapshotResult()?.rules.length ?? 0),
    snapshotGeneratedAt: snapshot?.generatedAt ?? null,
  }
}

/**
 * Preferred entry point for all runtime reads (checkpoints route, scan route, analyze_image).
 *
 * (1) In-memory live cache when younger than TTL (fast path — no network).
 * (2) Otherwise refresh from Airtable so Example image URLs stay signed/valid, then serve that.
 * (3) If Airtable fails: prior live cache if any, else committed snapshot (rules still work;
 *     example images in the snapshot may be expired).
 */
export async function getConversionCheckpointRules(): Promise<GetCheckpointRulesResult> {
  if (isLiveCacheFresh()) {
    return liveCache!.data
  }

  const refreshed = await ensureFreshLiveCache()
  if (refreshed) return refreshed

  const snapshot = snapshotResult()
  if (snapshot) return snapshot

  return fetchCheckpointRulesFromAirtable()
}

/**
 * Loads every Live and Draft checkpoint and maps it to a scan rule (title = Conversion Checkpoint,
 * description = Required Actions, plus the definition fields).
 * Live network fetch — use `getConversionCheckpointRules()` for runtime reads; this is for the refresh route.
 */
export async function fetchCheckpointRulesFromAirtable(): Promise<GetCheckpointRulesResult> {
  try {
    const apiUrl =
      process.env.API_URL ??
      'https://api.airtable.com/v0/app1HP8C17pAMjacf/Conversion%20Checkpoints?maxRecords=500'
    const apiKey = process.env.API_KEY
    if (!apiUrl || !apiKey) {
      return { ok: false, status: 500, body: { error: 'Missing API_URL or API_KEY in environment.' } }
    }

    const result = await fetchAllRecordsForFormula(getListRecordsBaseUrl(apiUrl), apiKey, SCANNER_FORMULA)
    if (!result.ok) {
      return { ok: false, status: result.status, body: result.body }
    }

    const rules: ScanRule[] = []
    for (const rec of result.records) {
      const rule = mapAirtableRecordToRule(rec)
      if (rule) rules.push(rule)
    }

    return {
      ok: true,
      requestedIds: [],
      foundCount: result.records.length,
      notFoundIds: [],
      records: result.records,
      rules,
    }
  } catch (err) {
    console.error('[getConversionCheckpointRules]', err)
    const message =
      err instanceof Error ? err.message : 'Unexpected error loading conversion checkpoints'
    return { ok: false, status: 500, body: { error: message } }
  }
}
