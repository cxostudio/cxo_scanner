/**
 * Server-only: Airtable conversion checkpoints → scan `Rule` shape.
 * Field names match typical Airtable columns (override via env if yours differ).
 */

import checkpointsSnapshot from './checkpoints.snapshot.json'

export type ScanRule = {
  id: string
  title: string
  description: string
}

type AirtableSingleRecord = {
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
  return {
    id: record.id,
    title,
    description,
  }
}

function isStickyAddToCartRule(rule: ScanRule): boolean {
  const haystack = `${rule.title} ${rule.description}`.toLowerCase()
  return (
    rule.id === 'cta-sticky-add-to-cart' ||
    (haystack.includes('sticky') && haystack.includes('cart'))
  )
}

/**
 * Airtable record IDs (30 checkpoints). Full rows supply rule text + Justifications/Examples in scan results.
 * Edit this list when you add or replace rows in Airtable.
 */
export const TARGET_CHECKPOINT_RECORD_IDS = [
  'recSs12TogM60Mf6w',
  'recEcmUYxWGuOz3vK',
  'recXqQmYLbyuIil2a',
  'rec1iBTNslYj4y05d',
  'rec3kmxGigBELSAlu',
  'recZ158fy5ndWroli',
  'rectyUC9T4WUfFYvc',
  'rectt6VIDYK1SbaBH',
  'rec59tWeW27UFwDuX',
  'recoRfbr8slQLFqTB',
  'recBIykwniSTLYVjI',
  'recDkT1jqcBJworBQ',
  'recihw16WgNwYG09z',
  'rec74RD9IgZgfDUwl',
  'recVqogizZUTrTN4p',
  'recXmTTGKCp0rqOH8',
  'recUSgWqCEq0anlm2',  
  'recjK9IQ0T4rpu4iu',
  'rechuFEvuIW0ULmFW',
  'recKjEZrP38rjqCoY',
  'recdkYxD8QVU9j14p',
  'rec7DA1trGfVmAUET',
  'recTUunKnIj3laNCO',
  'recjEVPpCRkdi17EE',
  'rec5qkI2EcLQ5jQ9D',
  'recbtnaZ7nEchnx8O',
  'rece6cI4zL9uA7dyO',
  'rec33A6aJXon8YXfR',
  'recLehZKzun1Rxv0Z',
  'recYUxusypKnfViyM',
  'recnbgJzDarhgi4RH',
  'recNxnjMNyufvGsDX',
  'rec9Bd8mIKecasTPF',
  'rechQdZcW7EkLpi5J',
  'recH6IBXpHPI1KIxY',
  'receK3gEjM9yV2vi2',
  'recxEGfZMHhvNPCUa',
  'recKQWJU3qEuKGFA3',
  'recxoLHExiwXLdy75',
  'rec7WWY98CVhOtAXo',
  'rec7hmBdP9rqP4gVw',
  'recP2gybr9r0x8LYz',
  'recf9TVdWozjE1laI',
  'recYvb2wC1safMjpN',
  'rechWSGCANIZS39ja'

] as const

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Base list URL for the table (no `/rec…` retrieve suffix, no query string). */
function getListRecordsBaseUrl(apiUrl: string): string {
  const u = new URL(apiUrl)
  let segments = u.pathname.split('/').filter(Boolean)
  if (segments.length >= 4 && /^rec[a-zA-Z0-9]+$/.test(segments[segments.length - 1]!)) {
    segments = segments.slice(0, -1)
  }
  const path = `/${segments.join('/')}`
  return `${u.origin}${path}`
}

function chunkIds<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size) as T[])
  return out
}

/** Airtable formula: match any of the given record IDs (sanitized). */
function buildOrRecordIdFormula(ids: readonly string[]): string {
  const safe = ids.map((id) => id.trim()).filter((id) => /^rec[a-zA-Z0-9]+$/.test(id))
  if (safe.length === 0) return ''
  return `OR(${safe.map((id) => `RECORD_ID()='${id}'`).join(',')})`
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
async function fetchAllRecordsForFormula(
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

/**
 * Loads many checkpoint rows with **few list API calls** (batched `filterByFormula`).
 * Avoids one HTTP request per ID — that pattern trips Airtable `RATE_LIMIT_REACHED` quickly.
 */
async function fetchRecordsByIds(
  apiUrl: string,
  apiKey: string,
  recordIds: readonly string[],
): Promise<
  | {
      ok: true
      records: AirtableSingleRecord[]
      requestedIds: readonly string[]
      foundCount: number
      notFoundIds: string[]
    }
  | { ok: false; status: number; body: unknown }
> {
  const unique = [...new Set(recordIds.map((id) => id.trim()).filter(Boolean))]
  if (unique.length === 0) {
    return { ok: true, records: [], requestedIds: recordIds, foundCount: 0, notFoundIds: [] }
  }

  const listBaseUrl = getListRecordsBaseUrl(apiUrl)
  const idChunks = chunkIds(unique, 20)
  const mergedById = new Map<string, AirtableSingleRecord>()

  for (let i = 0; i < idChunks.length; i += 1) {
    const formula = buildOrRecordIdFormula(idChunks[i]!)
    if (!formula) continue

    const chunkRes = await fetchAllRecordsForFormula(listBaseUrl, apiKey, formula)
    if (!chunkRes.ok) return chunkRes

    for (const rec of chunkRes.records) {
      mergedById.set(rec.id, rec)
    }

    if (i < idChunks.length - 1) {
      await sleep(250)
    }
  }

  const ordered: AirtableSingleRecord[] = []
  for (const id of unique) {
    const rec = mergedById.get(id)
    if (rec) ordered.push(rec)
  }

  const notFoundIds = unique.filter((id) => !mergedById.has(id))

  return {
    ok: true,
    records: ordered,
    requestedIds: unique,
    foundCount: ordered.length,
    notFoundIds,
  }
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
 * Default 1 day; override with CHECKPOINTS_CACHE_TTL_MS (ms).
 */
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60_000 // 1 day

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
    requestedIds: snapshot.requestedIds ?? [...TARGET_CHECKPOINT_RECORD_IDS],
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
 * Loads Airtable rows and maps them to scan rules (title = Conversion Checkpoint, description = Required Actions).
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

    const result = await fetchRecordsByIds(apiUrl, apiKey, TARGET_CHECKPOINT_RECORD_IDS)
    if (!result.ok) {
      return { ok: false, status: result.status, body: result.body }
    }

    const rules: ScanRule[] = []
    for (const rec of result.records) {
      const rule = mapAirtableRecordToRule(rec)
      if (rule && !isStickyAddToCartRule(rule)) rules.push(rule)
    }

    return {
      ok: true,
      requestedIds: result.requestedIds,
      foundCount: result.foundCount,
      notFoundIds: result.notFoundIds,
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
