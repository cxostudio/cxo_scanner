// The paid full report. One parent job (scan_jobs, scan_id "report_<uuid>") and one job per page
// ("report_<uuid>__homepage" ...). Each page scans in its own function, so no invocation waits for
// all of them; the last page to finish closes the report and sends the email once.
//
//   startReport() ─▶ kickoff (pick pages, create page jobs) ─▶ POST /api/report/page × 3
//   runPage() ─▶ /api/scan (all Live checkpoints, paid mode) ─▶ combine ─▶ finalize()
import { createHash, randomUUID } from 'crypto'
import { completeJob, createJob, failJob, listJobsByPrefix, markEmailed, type ScanJob, type ScanSnapshot } from '@/lib/scanJobs/store'
import { previews, selfOrigin } from '@/lib/scanJobs/runServer'
import { resultsEmailFor } from '@/lib/scanJobs/finish'
import { sendEmail } from '@/lib/email/send'
import { pickReportPages, type ReportPageKey } from './pages'

const api = (p: string) => `${selfOrigin()}/scan/api${p}`
const AREA_ORDER: ReportPageKey[] = ['homepage', 'category', 'product']

export type ReportPageSnapshot = ScanSnapshot & { page: ReportPageKey; how?: string }
export type ReportSnapshot = ScanSnapshot & { kind: 'report'; pages: { key: ReportPageKey; id: string; status: string }[] }

export async function startReport(input: { email: string; url: string; locale: string; answers?: ScanJob['answers']; origin?: string | null; orderId?: string }): Promise<ScanJob> {
  const scanId = `report_${input.orderId || randomUUID()}`
  return createJob({
    scanId, email: input.email, url: input.url, locale: input.locale === 'fr' ? 'fr' : 'en',
    answers: { ...(input.answers || {}), kind: 'report' }, origin: input.origin ?? null,
  })
}

/** Pick the pages and start one scan per page. Runs after the order is stored. */
export async function kickoff(parent: ScanJob): Promise<void> {
  try {
    const pages = await pickReportPages(parent.url)
    await Promise.all(pages.map(async (p) => {
      const child = await createJob({
        scanId: `${parent.scan_id}__${p.key}`, email: parent.email, url: p.url, locale: parent.locale,
        answers: { ...(parent.answers || {}), kind: 'report', page: p.key, how: p.how }, origin: parent.origin,
      })
      const r = await fetch(api('/report/page'), { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-report-key': internalKey() }, body: JSON.stringify({ id: child.id }) })
      if (!r.ok) await failJob(child.id, `page start ${r.status}`)
    }))
  } catch (e) {
    console.error('[report] kickoff failed', e)
    await failJob(parent.id, e instanceof Error ? e.message : 'kickoff failed')
  }
}

/** A secret only this deployment knows, so /api/report/page can't be called from outside. */
export function internalKey(): string {
  return createHash('sha256').update(`cxo-report:${process.env.SUPABASE_SERVICE_ROLE_KEY || ''}`).digest('hex').slice(0, 32)
}

export async function runPage(job: ScanJob): Promise<void> {
  const parentScanId = job.scan_id.split('__')[0]
  try {
    const pageType = job.answers?.page === 'category' ? 'category' : job.answers?.page === 'homepage' ? 'homepage' : 'product'
    const cp = await fetch(api(`/conversion-checkpoints?pageType=${pageType}`))
    const rules = cp.ok ? (((await cp.json()) as { rules?: unknown[] }).rules || []) : []
    if (!rules.length) throw new Error('no checkpoints')

    const previewP = previews(job.url)
    let results: unknown[] = []
    let lastErr = ''
    for (let attempt = 1; attempt <= 2 && !results.length; attempt++) {
      const res = await fetch(api('/scan'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: job.url, rules, captureScreenshot: true, scanId: job.scan_id, reportJob: job.id }) })
      const data = (await res.json().catch(() => ({}))) as { results?: unknown[]; error?: string }
      if (res.ok && Array.isArray(data.results)) { results = data.results; break }
      lastErr = data.error || `scan ${res.status}`
      if (res.status === 422 || res.status === 403) break
    }
    if (!results.length) throw new Error(lastErr || 'scan failed')
    try {
      const c = await fetch(api('/scan/combine'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ results }) })
      if (c.ok) { const d = (await c.json()) as { results?: unknown[] }; if (Array.isArray(d.results)) results = d.results }
    } catch { /* keep raw */ }
    const p = await previewP
    const snap: ReportPageSnapshot = {
      page: (job.answers?.page || 'product') as ReportPageKey, how: job.answers?.how, results, scanUrl: job.url,
      revenue: job.answers?.revenue, aov: job.answers?.aov, cr: job.answers?.cr, locale: job.locale,
      previewDesktop: p.desktop, previewMobile: p.mobile,
    }
    await completeJob(job.id, snap)
  } catch (e) {
    console.error('[report] page failed', job.scan_id, e)
    await failJob(job.id, e instanceof Error ? e.message : 'page failed')
  }
  await finalize(parentScanId)
}

/** When every page has finished: close the report and send the email (once). */
export async function finalize(parentScanId: string): Promise<void> {
  const all = await listJobsByPrefix(parentScanId)
  const parent = all.find((j) => j.scan_id === parentScanId)
  const pages = all.filter((j) => j.scan_id.startsWith(`${parentScanId}__`))
  if (!parent || !pages.length || pages.some((j) => j.status !== 'done' && j.status !== 'failed')) return
  const ok = pages.filter((j) => j.status === 'done')
  if (!ok.length) { await failJob(parent.id, 'every page failed'); return }
  const order = (k?: string) => AREA_ORDER.indexOf((k || 'product') as ReportPageKey)
  const snap: ReportSnapshot = {
    kind: 'report', scanUrl: parent.url, locale: parent.locale,
    revenue: parent.answers?.revenue, aov: parent.answers?.aov, cr: parent.answers?.cr,
    results: ok.flatMap((j) => (j.snapshot?.results || []) as unknown[]),
    pages: [...pages].sort((a, b) => order(a.answers?.page) - order(b.answers?.page)).map((j) => ({ key: (j.answers?.page || 'product') as ReportPageKey, id: j.id, status: j.status })),
  }
  const done = await completeJob(parent.id, snap)
  if (!done || !(await markEmailed(parent.id))) return
  const mail = reportEmailFor(done, snap)
  const sent = await sendEmail({ to: done.email, ...mail })
  if (!sent.sent) console.error('[report] email not sent', sent.error)
}

function reportEmailFor(job: ScanJob, snap: ReportSnapshot) {
  return resultsEmailFor(job, { ...snap, scanUrl: job.url }, { report: true, link: `/scan/report?id=${job.id}` })
}
