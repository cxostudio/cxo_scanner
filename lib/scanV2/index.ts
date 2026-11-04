// Scan engine v2: capture evidence once, judge every checkpoint with it.
// Returns rows in the same shape as engine v1, so the run and results pages are unchanged.
// Extra field `status` separates "not relevant" and "couldn't check" from real passes and fails.
import { captureEvidence, PageCheckError } from './capture'
import { judge, V2_MODEL, type Rule } from './judge'
import { MEASURED } from './measured'

export { PageCheckError }

export type V2Row = {
  ruleId: string
  ruleTitle: string
  passed: boolean
  reason: string
  status: 'pass' | 'fail' | 'na' | 'unknown'
}

export async function runScanV2(url: string, rules: Rule[], apiKey: string) {
  const t0 = Date.now()
  const ev = await captureEvidence(url)
  const t1 = Date.now()
  // measured checkpoints first; the model only judges what code cannot settle
  const measured = new Map<string, { answer: 'pass' | 'fail' | 'na' | 'unknown'; evidence: string }>()
  for (const r of rules) {
    const m = MEASURED[r.id]?.(ev, ev.facts as Record<string, any>)
    if (m) measured.set(r.id, m)
  }
  const verdicts = await judge(ev, rules.filter((r) => !measured.has(r.id)), apiKey)
  const byId = new Map<string, { answer: 'pass' | 'fail' | 'na' | 'unknown'; evidence: string }>(verdicts.map((v) => [v.id, v]))
  for (const [id, m] of Array.from(measured)) byId.set(id, m)
  const results: V2Row[] = rules.map((r) => {
    const v = byId.get(r.id)
    const status = v?.answer ?? 'unknown'
    return {
      ruleId: r.id,
      ruleTitle: r.title,
      // "not relevant" never counts against the store; "couldn't check" is shown apart by the results page
      passed: status === 'pass' || status === 'na',
      reason: v?.evidence || 'We could not check this one.',
      status,
    }
  })
  const screenshot = ev.desktopTiles[0]?.dataUrl ?? null
  console.log(`[scanV2] ${url} capture ${t1 - t0}ms judge ${Date.now() - t1}ms model ${V2_MODEL()} tiles ${ev.desktopTiles.length}+${ev.mobileTiles.length}`)
  const diag = {
    facts: Object.keys(ev.facts).length,
    tiles: `${ev.desktopTiles.length}+${ev.mobileTiles.length}`,
    cart: ev.cartTest,
    cartTile: !!ev.cartHeader,
    textChars: ev.text.length,
    hiddenChars: ev.hiddenText.length,
    measured: measured.size,
  }
  return { results, screenshot, timings: { captureMs: t1 - t0, judgeMs: Date.now() - t1 }, model: V2_MODEL(), diag }
}
