/**
 * Airtable record fields for results UI: Required Actions, Justifications, Examples attachments.
 */

export type CheckpointExampleImage = {
  url: string
  filename: string
  thumbnailUrl: string
}

export type CheckpointPresentation = {
  requiredActions: string
  justificationsBenefits: string
  examples: CheckpointExampleImage[]
  /** Airtable "Priority Level": High | Medium (results: score weight, fix order) */
  priority?: string
  /** Airtable "Difficulty Level": Easy | Moderate | Difficult */
  difficulty?: string
  /** Airtable "Target Performance Metrics", e.g. Add-to-Cart Rate (results: area) */
  metrics?: string[]
}

type Fields = Record<string, unknown>

// Airtable attachment links expire within hours; results point at our own image route instead
// (app/api/checkpoint-image), which fetches a fresh link when the image is shown.
const imageRoute = (recordId: string, i: number, size: 'thumb' | 'full') =>
  `/scan/api/checkpoint-image?r=${recordId}&i=${i}&s=${size}`

function parseExamplesField(v: unknown, recordId?: string): CheckpointExampleImage[] {
  if (!Array.isArray(v)) return []
  const out: CheckpointExampleImage[] = []
  for (const item of v) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const url = typeof o.url === 'string' ? o.url : ''
    if (!url) continue
    const filename = typeof o.filename === 'string' ? o.filename : 'Example'
    const thumbs = o.thumbnails as
      | { small?: { url?: string }; large?: { url?: string }; full?: { url?: string } }
      | undefined
    const thumbnailUrl =
      thumbs?.large?.url || thumbs?.full?.url || thumbs?.small?.url || url
    const i = out.length
    out.push(
      recordId
        ? { url: imageRoute(recordId, i, 'full'), filename, thumbnailUrl: imageRoute(recordId, i, 'thumb') }
        : { url, filename, thumbnailUrl },
    )
  }
  return out
}

export function extractCheckpointPresentation(
  record: { id: string; fields?: Fields },
): CheckpointPresentation | null {
  const f = record.fields ?? {}
  const requiredActions = typeof f['Required Actions'] === 'string' ? f['Required Actions'].trim() : ''
  const justificationsBenefits =
    typeof f['Justifications & Benefits'] === 'string' ? f['Justifications & Benefits'].trim() : ''
  const examples = parseExamplesField(f['Examples'], record.id)
  if (!requiredActions && !justificationsBenefits && examples.length === 0) return null
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
  const metrics = Array.isArray(f['Target Performance Metrics'])
    ? (f['Target Performance Metrics'] as unknown[]).filter((m): m is string => typeof m === 'string')
    : undefined
  return {
    requiredActions,
    justificationsBenefits,
    examples,
    priority: str(f['Priority Level']),
    difficulty: str(f['Difficulty Level']),
    metrics,
  }
}

export function buildCheckpointPresentationMap(
  records: Array<{ id: string; fields?: Fields }>,
): Map<string, CheckpointPresentation> {
  const m = new Map<string, CheckpointPresentation>()
  for (const rec of records) {
    const p = extractCheckpointPresentation(rec)
    if (p) m.set(rec.id, p)
  }
  return m
}
