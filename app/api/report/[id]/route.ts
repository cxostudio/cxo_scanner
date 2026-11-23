import { NextResponse } from 'next/server'
import { getJob, listJobsByPrefix } from '@/lib/scanJobs/store'
import { getConversionCheckpointRules } from '@/lib/conversionCheckpoints/getCheckpointRules'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SITE = 'reclgdsv5ric0dkku', PRODUCT = 'recq3oalwwoefg2x5', CART = 'recdyiscpsbfrbbha', CHECKOUT = 'recokhtzh3nxsqnmb'
export type ReportArea = 'site' | 'homepage' | 'category' | 'product' | 'cart' | 'checkout'

/** The full report for /report?id=: every result tagged with its store area, or the progress while it runs. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parent = await getJob(params.id).catch(() => null)
  if (!parent || !parent.scan_id.startsWith('report_') || parent.scan_id.includes('__')) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const jobs = await listJobsByPrefix(`${parent.scan_id}__`)

  // the product page scan also judges the cart, checkout and store-wide checks: split them out by the checkpoint's page tags
  const tags = new Map<string, string[]>()
  if (parent.status === 'done') {
    const cp = await getConversionCheckpointRules().catch(() => null)
    if (cp && cp.ok) for (const r of cp.rules) tags.set(r.id, (r.pageTypeIds || []).map((x) => x.toLowerCase()))
  }
  const areaOf = (page: string, ruleId: string): ReportArea => {
    if (page === 'homepage' || page === 'category') return page
    const t = tags.get(ruleId) || []
    if (t.includes(CHECKOUT)) return 'checkout'
    if (t.includes(CART)) return 'cart'
    if (t.includes(PRODUCT)) return 'product'
    if (t.includes(SITE)) return 'site'
    return 'product'
  }

  const pages = jobs.map((j) => {
    const page = j.answers?.page || 'product'
    const snap = j.status === 'done' ? j.snapshot : null
    return {
      key: page, how: j.answers?.how || '', url: j.url, status: j.status,
      previewDesktop: snap?.previewDesktop || null, previewMobile: snap?.previewMobile || null,
      results: parent.status === 'done' && snap ? ((snap.results || []) as { ruleId: string }[]).map((r) => ({ ...r, area: areaOf(page, r.ruleId) })) : [],
    }
  })
  return NextResponse.json({
    status: parent.status, url: parent.url, locale: parent.locale, createdAt: parent.created_at,
    answers: { revenue: parent.answers?.revenue, aov: parent.answers?.aov, cr: parent.answers?.cr }, pages,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
