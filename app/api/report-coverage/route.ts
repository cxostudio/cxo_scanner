// What the full report covers, page by page, for the free scan's offer card:
//   GET → { total, stores, pages: [{ key, label, checks, expectedIssues }] }
// checks: Live checkpoints the scanner runs for that page (what the paid report delivers today).
// expectedIssues: checks x the share that failed on that page across our lab stores (an estimate).
// Store-wide checks run on every page; they are counted once, with the product page.
import { NextResponse } from 'next/server'
import { getConversionCheckpointRules } from '@/lib/conversionCheckpoints/getCheckpointRules'
import { ruleIsScannable } from '@/lib/conversionCheckpoints/filterByUrlPageType'
import { getTestScan, listTestScans } from '@/lib/lab/store'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const PAGES = [
  { key: 'homepage', label: 'Homepage', ids: ['rectbairzlgei24hg'] },
  { key: 'category', label: 'Collections', ids: ['recpwt9mnrffkte9i'] },
  { key: 'product', label: 'Product page', ids: ['recq3oalwwoefg2x5', 'reclgdsv5ric0dkku'] },
  { key: 'cart', label: 'Cart', ids: ['recdyiscpsbfrbbha'] },
  { key: 'checkout', label: 'Checkout', ids: ['recokhtzh3nxsqnmb'] },
] as const

type Coverage = { total: number; stores: number; pages: { key: string; label: string; checks: number; expectedIssues: number }[] }
let cache: { at: number; data: Coverage } | null = null
const TTL = 6 * 60 * 60 * 1000

export async function GET() {
  if (cache && Date.now() - cache.at < TTL) return NextResponse.json(cache.data)
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

  // failure share per page, over the lab stores (judged answers only)
  const tally = new Map<string, { fail: number; judged: number }>()
  let stores = 0
  try {
    const list = await listTestScans()
    const scans = await Promise.all(list.map((s) => getTestScan(s.id).catch(() => null)))
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
  const data: Coverage = { total: pages.reduce((n, p) => n + p.checks, 0), stores, pages }
  cache = { at: Date.now(), data }
  return NextResponse.json(data)
}
