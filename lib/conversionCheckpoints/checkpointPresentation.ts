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
}

type Fields = Record<string, unknown>

function parseExamplesField(v: unknown): CheckpointExampleImage[] {
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
    out.push({ url, filename, thumbnailUrl })
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
  const examples = parseExamplesField(f['Examples'])
  if (!requiredActions && !justificationsBenefits && examples.length === 0) return null
  return {
    requiredActions,
    justificationsBenefits,
    examples,
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
