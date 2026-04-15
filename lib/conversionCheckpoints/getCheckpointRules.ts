/**
 * Server-only: Airtable conversion checkpoints → scan `Rule` shape.
 * Field names match typical Airtable columns (override via env if yours differ).
 */

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
] as const

function buildRetrieveRecordUrl(listRecordsUrl: string, recordId: string): string {
  const u = new URL(listRecordsUrl)
  const path = u.pathname.replace(/\/$/, '')
  return `${u.origin}${path}/${encodeURIComponent(recordId)}`
}

async function fetchRecordById(apiUrl: string, apiKey: string, recordId: string) {
  const recordUrl = buildRetrieveRecordUrl(apiUrl, recordId)
  const res = await fetch(recordUrl, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  })
  const data = (await res.json()) as AirtableSingleRecord & { error?: unknown }
  if (!res.ok) {
    return { ok: false as const, status: res.status, body: data }
  }
  return { ok: true as const, record: data }
}

async function fetchRecordsByIds(
  apiUrl: string,
  apiKey: string,
  recordIds: readonly string[],
) {
  const results = await Promise.all(recordIds.map((id) => fetchRecordById(apiUrl, apiKey, id)))
  const records: AirtableSingleRecord[] = []
  const notFoundIds: string[] = []

  for (let i = 0; i < results.length; i += 1) {
    const result = results[i]
    const recordId = recordIds[i]
    if (result.ok) {
      records.push(result.record)
      continue
    }
    if (result.status === 404) {
      notFoundIds.push(recordId)
      continue
    }
    return { ok: false as const, status: result.status, body: result.body }
  }

  return {
    ok: true as const,
    records,
    requestedIds: recordIds,
    foundCount: records.length,
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

/**
 * Loads Airtable rows and maps them to scan rules (title = Conversion Checkpoint, description = Required Actions).
 */
export async function getConversionCheckpointRules(): Promise<GetCheckpointRulesResult> {
  const apiUrl ="https://api.airtable.com/v0/"
  const baseId = "app1HP8C17pAMjacf"
  const maxRecords = "maxRecords=500"
  const tableName = "Conversion%20Checkpoints"
  const apiKey = process.env.API_KEY
  if (!apiUrl || !apiKey) {
    return { ok: false, status: 500, body: { error: 'Missing API_URL or API_KEY in environment.' } }
  }

  const result = await fetchRecordsByIds(`https://api.airtable.com/v0/${baseId}/${tableName}?${maxRecords}`, apiKey, TARGET_CHECKPOINT_RECORD_IDS)
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
}
