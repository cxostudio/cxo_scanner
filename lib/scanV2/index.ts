// Scan engine v2: capture evidence once, judge every checkpoint with it.
// Returns rows in the same shape as engine v1, so the run and results pages are unchanged.
// Extra field `status` separates "not relevant" and "couldn't check" from real passes and fails.
import { captureEvidence, PageCheckError } from './capture'
import { judge, V2_MODEL, type Niche, type Rule, type Verdict } from './judge'
import { MEASURED } from './measured'

export { PageCheckError }

export type V2Row = {
  ruleId: string
  ruleTitle: string
  passed: boolean
  reason: string
  status: 'pass' | 'fail' | 'na' | 'unknown'
  /** Shopify does this by default: counted as passed, grouped as one line in the report. */
  coveredByShopify?: boolean
}

type Answer = Omit<Verdict, 'id'>

/** Hard niche rules from Airtable: "Not relevant for niches", and "Niches" when it is a closed list. */
function nicheVerdict(r: Rule, niche: Niche): Answer | null {
  if (r.notRelevantNiches?.includes(niche))
    return { answer: 'na', evidence: `Not relevant for ${niche.toLowerCase()} stores.` }
  const only = (r.niches || []).filter((n) => n !== 'All')
  if (only.length && !only.includes(niche))
    return { answer: 'na', evidence: `Only checked for ${only.map((n) => n.toLowerCase()).join(', ')} stores.` }
  return null
}

export async function runScanV2(url: string, rules: Rule[], apiKey: string) {
  const t0 = Date.now()
  const ev = await captureEvidence(url)
  const t1 = Date.now()
  // measured checkpoints first; the model only judges what code cannot settle
  const settled = new Map<string, Answer & { coveredByShopify?: boolean }>()
  for (const r of rules) {
    if (ev.isShopify && r.shopifyControl === 'Handled by Shopify') {
      settled.set(r.id, { answer: 'pass', evidence: 'Shopify handles this by default.', coveredByShopify: true })
      continue
    }
    const m = MEASURED[r.id]?.(ev, ev.facts as Record<string, any>)
    if (m) settled.set(r.id, m)
  }
  const measuredCount = settled.size
  const { niche, verdicts } = await judge(ev, rules.filter((r) => !settled.has(r.id)), apiKey)
  const byId = new Map<string, Answer & { coveredByShopify?: boolean }>(verdicts.map((v) => [v.id, v]))
  for (const [id, m] of Array.from(settled)) byId.set(id, m)
  // niche rules are facts in Airtable, not the model's call: they override any answer
  for (const r of rules) {
    const n = nicheVerdict(r, niche)
    if (n && !byId.get(r.id)?.coveredByShopify) byId.set(r.id, n)
  }
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
      ...(v?.coveredByShopify ? { coveredByShopify: true } : {}),
    }
  })
  const screenshot = ev.desktopTiles[0]?.dataUrl ?? null
  console.log(`[scanV2] ${url} ${rules.length} checkpoints, niche ${niche}, capture ${t1 - t0}ms judge ${Date.now() - t1}ms model ${V2_MODEL()} tiles ${ev.desktopTiles.length}+${ev.mobileTiles.length}`)
  const diag = {
    facts: Object.keys(ev.facts).length,
    tiles: `${ev.desktopTiles.length}+${ev.mobileTiles.length}`,
    cart: ev.cartTest,
    cartTile: !!ev.cartHeader,
    cartView: `${ev.cartView ? 'desktop' : '-'}+${ev.mobileCartView ? 'mobile' : '-'}`,
    shopify: !!ev.isShopify,
    niche,
    textChars: ev.text.length,
    hiddenChars: ev.hiddenText.length,
    measured: measuredCount,
    checkpoints: rules.length,
  }
  return { results, screenshot, niche, timings: { captureMs: t1 - t0, judgeMs: Date.now() - t1 }, model: V2_MODEL(), diag }
}
