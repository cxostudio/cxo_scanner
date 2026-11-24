import { NextResponse } from 'next/server'
import { getJob, listJobsByPrefix } from '@/lib/scanJobs/store'
import { getConversionCheckpointRules } from '@/lib/conversionCheckpoints/getCheckpointRules'
import { areaOf } from '@/lib/fullReport/areas'
import { signedUrls } from '@/lib/fullReport/images'
import type { ReportPageSnapshot } from '@/lib/fullReport/run'
import { stripe } from '@/lib/stripe'

export const runtime = 'nodejs'
const RESCANS = 3
export const dynamic = 'force-dynamic'

/** The full report for /report?id=: results tagged by store area, screenshots as short-lived links, or the progress while it runs. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parent = await getJob(params.id).catch(() => null)
  if (!parent || !parent.scan_id.startsWith('report_') || parent.scan_id.includes('__')) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const all = await listJobsByPrefix(`${parent.scan_id}__`)
  // a page can be rescanned ("scan another page", scan_id …__<page>~<n>): show the latest finished scan of
  // each page, and the newer one still running (or failed) next to it
  const keys = Array.from(new Set(all.map((j) => j.answers?.page || 'product')))
  const jobs = keys.map((k) => {
    const mine = all.filter((j) => (j.answers?.page || 'product') === k)
    return [...mine].reverse().find((j) => j.status === 'done') || mine[mine.length - 1]
  })
  const pending = new Map(keys.map((k, i) => {
    const latest = all.filter((j) => (j.answers?.page || 'product') === k).pop()!
    return [k, latest.id !== jobs[i].id ? { status: latest.status, url: latest.url, error: latest.status === 'failed' ? latest.error : null } : null]
  }))
  const rescansLeft = Math.max(0, RESCANS - all.filter((j) => j.scan_id.includes('~')).length)
  const done = parent.status === 'done'

  const tags = new Map<string, string[]>()
  if (done) {
    const cp = await getConversionCheckpointRules().catch(() => null)
    if (cp && cp.ok) for (const r of cp.rules) tags.set(r.id, r.pageTypeIds || [])
  }
  const snaps = jobs.map((j) => (j.status === 'done' ? (j.snapshot as ReportPageSnapshot | null) : null))
  const files = done ? snaps.flatMap((s) => [s?.located?.desktop?.file, s?.located?.mobile?.file, s?.previewFiles?.desktop, s?.previewFiles?.mobile, ...(s?.images || []).map((i) => i.file)]).filter((f): f is string => !!f) : []
  const url = await signedUrls(files).catch(() => new Map<string, string>())
  const link = (f?: string | null) => (f ? url.get(f) || null : null)

  const pages = jobs.map((j, k) => {
    const page = j.answers?.page || 'product'
    const s = snaps[k]
    const loc = (d: 'desktop' | 'mobile') => { const l = s?.located?.[d]; return l && link(l.file) ? { screenshot: link(l.file)!, width: l.width, height: l.height, pins: l.pins } : null }
    return {
      key: page, how: j.answers?.how || '', url: j.url, status: j.status, error: j.status === 'failed' ? j.error : null, rescan: pending.get(page) || null,
      located: done ? { desktop: loc('desktop'), mobile: loc('mobile') } : null,
      // older reports kept the previews inline
      preview: done ? { desktop: link(s?.previewFiles?.desktop) || s?.previewDesktop || null, mobile: link(s?.previewFiles?.mobile) || s?.previewMobile || null } : null,
      images: done ? (s?.images || []).map((i) => ({ role: i.role, device: i.device, label: i.label, url: link(i.file), pins: (s?.flowPins || []).filter((p) => p.file === i.file).map(({ findingId, box }) => ({ findingId, box })) })).filter((i) => i.url) : [],
      results: done && s ? ((s.results || []) as { ruleId: string }[]).map((r) => ({ ...r, area: areaOf(page, tags.get(r.ruleId)) })) : [],
    }
  })
  // a paid report (scan_id report_<Stripe session>): the order and its invoice, for the loading screen
  let order = null
  const session = parent.scan_id.slice('report_'.length)
  if (!done && /^cs_(test|live)_[A-Za-z0-9]+$/.test(session)) {
    try {
      const s = await stripe().checkout.sessions.retrieve(session, { expand: ['invoice'] })
      const inv = s.invoice && typeof s.invoice === 'object' ? s.invoice : null
      order = { amount: s.amount_total, currency: s.currency, tax: s.total_details?.amount_tax ?? null, invoiceUrl: inv?.hosted_invoice_url || null, invoicePdf: inv?.invoice_pdf || null, storeUrl: parent.url }
    } catch { /* no order card */ }
  }
  return NextResponse.json({
    order,
    rescansLeft,
    status: parent.status, url: parent.url, locale: parent.locale, createdAt: parent.created_at,
    answers: { revenue: parent.answers?.revenue, aov: parent.answers?.aov, cr: parent.answers?.cr }, pages,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
