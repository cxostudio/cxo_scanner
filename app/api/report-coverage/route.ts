// What the full report covers, page by page, for the free scan's offer card:
//   GET → { total, stores, pages: [{ key, label, checks, expectedIssues }] }
// checks: Live checkpoints the scanner runs for that page (what the paid report delivers today).
// expectedIssues: checks x the share that failed on that page across our lab stores (an estimate).
// Store-wide checks run on every page; they are counted once, with the product page.
import { NextResponse } from 'next/server'
import { getConversionCheckpointRules } from '@/lib/conversionCheckpoints/getCheckpointRules'
import { buildCheckpointPresentationMap } from '@/lib/conversionCheckpoints/checkpointPresentation'
import { ruleIsScannable } from '@/lib/conversionCheckpoints/filterByUrlPageType'
import { getLabels, getTestScan, listTestScans } from '@/lib/lab/store'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
// cached at Vercel's edge too: every new instance would otherwise re-read all the labels (slow) before
// the results page can show the offer
const EDGE = { headers: { 'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=86400' } }

// the six areas of the full report, in shopping order; checks that apply on every page (header, menu,
// footer, speed) have their own row instead of being folded into the page that was scanned
const PAGES = [
  { key: 'site', label: 'General elements', ids: ['reclgdsv5ric0dkku'] },
  { key: 'homepage', label: 'Homepage', ids: ['rectbairzlgei24hg'] },
  { key: 'category', label: 'Collection pages', ids: ['recpwt9mnrffkte9i'] },
  { key: 'product', label: 'Product pages', ids: ['recq3oalwwoefg2x5'] },
  { key: 'cart', label: 'Cart (page or drawer)', ids: ['recdyiscpsbfrbbha'] },
  { key: 'checkout', label: 'Checkout', ids: ['recokhtzh3nxsqnmb'] },
] as const

type Coverage = {
  total: number
  stores: number
  hosts?: string[]
  /** agreement with expert labels on the Live checks, in % (lab) */
  accuracy: number | null
  /** example screenshots attached to the Live checks */
  examples: number
  siteIds: string[]
  pages: { key: string; label: string; hint?: string; checks: number; expectedIssues: number }[]
}
let cache: { at: number; data: Coverage } | null = null
const TTL = 6 * 60 * 60 * 1000

export async function GET(req: Request) {
  const lite = new URL(req.url).searchParams.get('lite') === '1'
  if (cache && Date.now() - cache.at < TTL) return NextResponse.json(cache.data, EDGE)
  const res = await getConversionCheckpointRules()
  if (!res.ok) return NextResponse.json({ error: 'Checkpoints unavailable' }, { status: 502 })
  const live = res.rules.filter((r) => ruleIsScannable(r))
  // each checkpoint belongs to the first page in PAGES order it is tagged with
  const pageOf = new Map<string, string>()
  for (const r of live) {
    const ids = (r.pageTypeIds || []).map((x) => x.toLowerCase())
    const p = PAGES.find((pg) => pg.ids.some((id) => ids.includes(id)))
    if (p) pageOf.set(r.id, p.key)
  }
  // lite: just the number of checkpoints in the full report (fast: no lab reads), for the results header
  if (lite) return NextResponse.json({ total: live.filter((r) => pageOf.has(r.id)).length }, EDGE)

  // failure share per page, over the lab stores (judged answers only), and agreement with the labels
  const tally = new Map<string, { fail: number; judged: number }>()
  const liveIds = new Set(live.map((r) => r.id))
  let agree = 0
  let labelled = 0
  const hosts = new Set<string>()
  let stores = 0
  try {
    const list = await listTestScans()
    const scans: (Awaited<ReturnType<typeof getTestScan>> | null)[] = []
    const labelSets: Awaited<ReturnType<typeof getLabels>>[] = []
    for (let i = 0; i < list.length; i += 12) {
      const part = list.slice(i, i + 12)
      scans.push(...(await Promise.all(part.map((s) => getTestScan(s.id).catch(() => null)))))
      labelSets.push(...(await Promise.all(part.map((s) => getLabels(s.id).catch(() => ({}) as Awaited<ReturnType<typeof getLabels>>)))))
    }
    scans.forEach((scan, i) => {
      if (!scan) return
      try {
        hosts.add(new URL(scan.url).host.replace(/^www\./, ''))
      } catch {}
      const labels = labelSets[i] as Record<string, unknown>
      for (const a of scan.answers) {
        const raw = labels?.[a.id] as unknown
        const l = typeof raw === 'string' ? raw : (raw as { label?: string } | undefined)?.label
        if (!liveIds.has(a.id) || !l || !['pass', 'fail', 'na'].includes(l) || a.answer === 'unknown') continue
        labelled++
        const ai = a.coveredByShopify ? 'pass' : a.answer
        if (ai === l) agree++
      }
    })
    for (const scan of scans) {
      if (!scan) continue
      stores++
      for (const a of scan.answers) {
        const key = pageOf.get(a.id)
        if (!key || a.coveredByShopify || (a.answer !== 'pass' && a.answer !== 'fail')) continue
        const t = tally.get(key) || { fail: 0, judged: 0 }
        t.judged++
        if (a.answer === 'fail') t.fail++
        tally.set(key, t)
      }
    }
  } catch {}

  const pages = PAGES.map((p) => {
    const checks = live.filter((r) => pageOf.get(r.id) === p.key).length
    const t = tally.get(p.key)
    const rate = t && t.judged >= 20 ? t.fail / t.judged : 0.3
    return { key: p.key, label: p.label, checks, expectedIssues: Math.round(checks * rate) }
  })
  const presentation = buildCheckpointPresentationMap(res.records)
  const examples = live.reduce((n, r) => n + (presentation.get(r.id)?.examples?.length || 0), 0)
  const data: Coverage = {
    total: pages.reduce((n, p) => n + p.checks, 0),
    stores: hosts.size || stores,
    hosts: [...hosts].sort(),
    accuracy: labelled >= 200 ? Math.round((1000 * agree) / labelled) / 10 : null,
    examples,
    siteIds: live.filter((r) => pageOf.get(r.id) === 'site').map((r) => r.id),
    pages: pages.map((p) => (p.key === 'site' ? { ...p, hint: 'header, menu, footer, speed' } : p)),
  }
  cache = { at: Date.now(), data }
  return NextResponse.json(data, EDGE)
}
