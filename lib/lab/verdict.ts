// What to do with a checkpoint, from the lab's evidence: agreement with Louis's labels and how
// stable the scanner's answer is when the same screenshots are judged again.
export const MIN_LABELS = 5
export const TARGET = 0.9

export type Verdict = 'ready' | 'demote' | 'audit' | 'testing' | 'live'

export const VERDICT_LABEL: Record<Verdict, string> = {
  ready: 'Ready for Live',
  live: 'Live, holding',
  demote: 'Back to Draft',
  audit: 'Audit only or drop',
  testing: 'Keep testing',
}

export function verdictOf(row: { status?: string; labelled: number; agree: number; flips: number }): Verdict {
  const rate = row.labelled ? row.agree / row.labelled : 0
  const enough = row.labelled >= MIN_LABELS
  const stable = row.flips === 0
  if (row.status === 'Live') return enough && (rate < TARGET || !stable) ? 'demote' : 'live'
  if (enough && rate >= TARGET && stable) return 'ready'
  if (enough && rate < 0.7) return 'audit'
  return 'testing'
}
