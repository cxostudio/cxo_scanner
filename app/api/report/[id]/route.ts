import { NextResponse } from 'next/server'
import { getJob, listJobsByPrefix } from '@/lib/scanJobs/store'
import { getConversionCheckpointRules } from '@/lib/conversionCheckpoints/getCheckpointRules'
import { areaOf } from '@/lib/fullReport/areas'
import { signedUrls } from '@/lib/fullReport/images'
import type { ReportPageSnapshot } from '@/lib/fullReport/run'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The full report for /report?id=: results tagged by store area, screenshots as short-lived links, or the progress while it runs. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parent = await getJob(params.id).catch(() => null)
  if (!parent || !parent.scan_id.startsWith('report_') || parent.scan_id.includes('__')) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const jobs = await listJobsByPrefix(`${parent.scan_id}__`)
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
      key: page, how: j.answers?.how || '', url: j.url, status: j.status,
      located: done ? { desktop: loc('desktop'), mobile: loc('mobile') } : null,
      // older reports kept the previews inline
      preview: done ? { desktop: link(s?.previewFiles?.desktop) || s?.previewDesktop || null, mobile: link(s?.previewFiles?.mobile) || s?.previewMobile || null } : null,
      images: done ? (s?.images || []).map((i) => ({ role: i.role, device: i.device, label: i.label, url: link(i.file) })).filter((i) => i.url) : [],
      results: done && s ? ((s.results || []) as { ruleId: string }[]).map((r) => ({ ...r, area: areaOf(page, tags.get(r.ruleId)) })) : [],
    }
  })
  return NextResponse.json({
    status: parent.status, url: parent.url, locale: parent.locale, createdAt: parent.created_at,
    answers: { revenue: parent.answers?.revenue, aov: parent.answers?.aov, cr: parent.answers?.cr }, pages,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
