// The paid full report. One parent job (scan_jobs, scan_id "report_<uuid>") and one job per page
// ("report_<uuid>__homepage" ...). Each page scans in its own function, so no invocation waits for
// all of them; the last page to finish closes the report and sends the email once.
//
//   startReport() ─▶ kickoff (pick pages, create page jobs) ─▶ POST /api/report/page × 3
//   runPage() ─▶ /api/scan (all Live checkpoints, paid mode) ─▶ combine ─▶ finalize()
import { createHash, randomUUID } from 'crypto'
import { completeJob, createJob, failJob, getJob, listJobsByPrefix, markEmailed, saveSnapshot, type ScanJob, type ScanSnapshot } from '@/lib/scanJobs/store'
import { getConversionCheckpointRules } from '@/lib/conversionCheckpoints/getCheckpointRules'
import { saveImage, signedUrls, type ReportImage } from './images'
import { visionPins } from './visionPins'
import { areaOf, type ReportArea } from './areas'
import { previews, selfOrigin } from '@/lib/scanJobs/runServer'
import { resultsEmailFor } from '@/lib/scanJobs/finish'
import { sendEmail } from '@/lib/email/send'
import { pickReportPages, type ReportPageKey } from './pages'

const api = (p: string) => `${selfOrigin()}/scan/api${p}`
const AREA_ORDER: ReportPageKey[] = ['homepage', 'category', 'product']

export type Located = { file: string; width: number; height: number; pins: { findingId: string; box: { x: number; y: number; w: number; h: number } }[] }
export type ReportPageSnapshot = ScanSnapshot & {
  page: ReportPageKey; how?: string
  /** cart and checkout screenshots (product page only) */
  images?: ReportImage[]
  /** the page with the findings pinned, per device */
  located?: { desktop?: Located | null; mobile?: Located | null }
  /** plain screenshots when pinning failed */
  previewFiles?: { desktop?: string | null; mobile?: string | null }
  /** pins on the cart and checkout screenshots: box in fractions of that image */
  flowPins?: { file: string; findingId: string; box: { x: number; y: number; w: number; h: number } }[]
}
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
    await alertTeam(parent, [`The report could not start: ${e instanceof Error ? e.message : 'kickoff failed'}`])
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
    let images: ReportImage[] = []
    let lastErr = ''
    for (let attempt = 1; attempt <= 2 && !results.length; attempt++) {
      const res = await fetch(api('/scan'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: job.url, rules, captureScreenshot: true, scanId: job.scan_id, reportJob: job.id }) })
      const data = (await res.json().catch(() => ({}))) as { results?: unknown[]; error?: string; reportImages?: ReportImage[] }
      if (res.ok && Array.isArray(data.results)) { results = data.results; images = data.reportImages || []; break }
      lastErr = data.error || `scan ${res.status}`
      if (res.status === 422 || res.status === 403) break
    }
    if (!results.length) throw new Error(lastErr || 'scan failed')
    try {
      const c = await fetch(api('/scan/combine'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ results }) })
      if (c.ok) { const d = (await c.json()) as { results?: unknown[] }; if (Array.isArray(d.results)) results = d.results }
    } catch { /* keep raw */ }
    const p = await previewP
    const stamp = Date.now().toString(36)
    const [pd, pm] = await Promise.all([
      p.desktop ? saveImage(`${job.id}/${stamp}-preview-desktop.jpg`, p.desktop).catch(() => null) : null,
      p.mobile ? saveImage(`${job.id}/${stamp}-preview-mobile.jpg`, p.mobile).catch(() => null) : null,
    ])
    const snap: ReportPageSnapshot = {
      page: (job.answers?.page || 'product') as ReportPageKey, how: job.answers?.how, results, scanUrl: job.url,
      revenue: job.answers?.revenue, aov: job.answers?.aov, cr: job.answers?.cr, locale: job.locale,
      images, previewFiles: { desktop: pd, mobile: pm },
    }
    // next step in its own invocation: pin the findings on the page (desktop and mobile)
    await saveSnapshot(job.id, snap)
    const r = await fetch(api('/report/locate'), { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-report-key': internalKey() }, body: JSON.stringify({ id: job.id }) }).catch(() => null)
    if (r && r.ok) return
    await completeJob(job.id, snap)
  } catch (e) {
    console.error('[report] page failed', job.scan_id, e)
    await failJob(job.id, e instanceof Error ? e.message : 'page failed')
  }
  await finalize(parentScanId)
}

type Row = { ruleId: string; ruleTitle: string; reason?: string; passed?: boolean; status?: string }

/** Pin this page's findings on a desktop and a mobile screenshot, then close the page. */
export async function locatePage(id: string): Promise<void> {
  const job = await getJob(id)
  if (!job || job.status === 'done' || !job.snapshot) return
  const snap = job.snapshot as ReportPageSnapshot
  const parentScanId = job.scan_id.split('__')[0]
  try {
    const cp = await getConversionCheckpointRules().catch(() => null)
    const tags = new Map<string, string[]>()
    if (cp && cp.ok) for (const r of cp.rules) tags.set(r.id, r.pageTypeIds || [])
    // the findings that live on this page: not the cart or checkout ones (their own screenshots)
    const rows = (snap.results as Row[]).filter((r) => r.status !== 'unknown' && r.status !== 'na' && !r.passed)
      .filter((r) => { const a = areaOf(snap.page, tags.get(r.ruleId)); return a !== 'cart' && a !== 'checkout' })
    const findings = rows.slice(0, 60).map((r) => ({ id: r.ruleId, title: r.ruleTitle, reason: r.reason }))
    const one = async (device: 'desktop' | 'mobile'): Promise<Located | null> => {
      if (!findings.length) return null
      try {
        const res = await fetch(api('/locate'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: job.url, findings, device, limit: 60 }) })
        if (!res.ok) return null
        const d = (await res.json()) as { screenshot?: string; width?: number; height?: number; pins?: Located['pins'] }
        if (!d.screenshot || !d.width || !d.height) return null
        const pins = d.pins || []
        // what element matching couldn't place (mostly "something is missing"): place it by looking at the screenshot
        const left = findings.filter((f) => !pins.some((p) => p.findingId === f.id))
        if (left.length) {
          const extra = await visionPins([d.screenshot], left, snap.page === 'homepage' ? 'homepage' : snap.page === 'category' ? 'collection page' : 'product page', device).catch(() => [])
          for (const v of extra) pins.push({ findingId: v.findingId, box: { x: Math.round(v.box.x * d.width), y: Math.round(v.box.y * d.height), w: Math.round(v.box.w * d.width), h: Math.round(v.box.h * d.height) } })
        }
        const file = await saveImage(`${job.id}/${Date.now().toString(36)}-located-${device}.jpg`, d.screenshot)
        return { file, width: d.width, height: d.height, pins }
      } catch (e) { console.warn('[report] locate failed', device, e); return null }
    }
    // the cart and checkout exist only as screenshots from the scan: pin their findings on those
    const flow = async (): Promise<NonNullable<ReportPageSnapshot['flowPins']>> => {
      const images = snap.images || []
      if (!images.length) return []
      const links = await signedUrls(images.map((i) => i.file)).catch(() => new Map<string, string>())
      const failedIn = (area: 'cart' | 'checkout') => (snap.results as Row[]).filter((r) => r.status !== 'unknown' && r.status !== 'na' && !r.passed && areaOf('product', tags.get(r.ruleId)) === area)
        .map((r) => ({ id: r.ruleId, title: r.ruleTitle, reason: r.reason }))
      const jobs: Promise<NonNullable<ReportPageSnapshot['flowPins']>>[] = []
      for (const area of ['cart', 'checkout'] as const) {
        const fs = failedIn(area)
        if (!fs.length) continue
        for (const device of ['desktop', 'mobile'] as const) {
          const set = images.filter((i) => i.role === area && i.device === device && links.get(i.file))
          if (!set.length) continue
          jobs.push(visionPins(set.map((i) => links.get(i.file)!), fs, area === 'cart' ? 'cart' : 'checkout', device)
            .then((ps) => ps.map((p) => ({ file: set[p.image].file, findingId: p.findingId, box: p.box })))
            .catch(() => []))
        }
      }
      return (await Promise.all(jobs)).flat()
    }
    const [desktop, mobile, flowPins] = await Promise.all([one('desktop'), one('mobile'), snap.page === 'product' ? flow() : Promise.resolve([])])
    await completeJob(job.id, { ...snap, located: { desktop, mobile }, flowPins } as ReportPageSnapshot)
  } catch (e) {
    console.error('[report] locate step failed', job.scan_id, e)
    await completeJob(job.id, snap)
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
  if (!ok.length) {
    await failJob(parent.id, 'every page failed')
    await alertTeam(parent, [`The whole report failed: no page could be scanned.`, ...pages.map((j) => `${j.answers?.page}: ${j.error || 'failed'}`)])
    return
  }
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
  // quiet test reports (batch runs): no "report ready" email, alerts still go out
  const sent = done.answers?.quiet ? { sent: true as const } : await sendEmail({ to: done.email, ...mail })
  if (!sent.sent) console.error('[report] email not sent', sent.error)
  const problems = await reportProblems(pages)
  if (!sent.sent) problems.push(`The report email to the buyer was not sent: ${sent.error}`)
  if (problems.length) await alertTeam(done, problems)
}

/** What a buyer would notice: a page missing, the cart or checkout mostly unchecked, many "couldn't check". */
async function reportProblems(pages: ScanJob[]): Promise<string[]> {
  const out: string[] = []
  for (const j of pages) if (j.status === 'failed') out.push(`${j.answers?.page} page failed (${j.url}): ${j.error || 'no reason'}`)
  // a page we never found (no product: no product page, cart or checkout at all)
  for (const k of ['homepage', 'category', 'product']) if (!pages.some((j) => j.answers?.page === k)) out.push(`No ${k === 'category' ? 'collection' : k} page was found to scan${k === 'product' ? ': the report has no product page, cart or checkout' : ''}.`)
  const cp = await getConversionCheckpointRules().catch(() => null)
  const tags = new Map<string, string[]>()
  if (cp && cp.ok) for (const r of cp.rules) tags.set(r.id, r.pageTypeIds || [])
  const per = new Map<ReportArea, { all: number; unknown: number }>()
  for (const j of pages) {
    if (j.status !== 'done') continue
    for (const r of ((j.snapshot?.results || []) as Row[])) {
      const a = areaOf(j.answers?.page || 'product', tags.get(r.ruleId))
      const v = per.get(a) || { all: 0, unknown: 0 }
      v.all++; if (r.status === 'unknown') v.unknown++
      per.set(a, v)
    }
  }
  for (const [a, v] of Array.from(per)) {
    if (!v.all) continue
    if ((a === 'cart' || a === 'checkout') && v.unknown / v.all >= 0.5) out.push(`${a === 'cart' ? 'Cart' : 'Checkout'} mostly not checked: ${v.unknown} of ${v.all} checkpoints "couldn't check".`)
    else if (v.unknown / v.all >= 0.25) out.push(`${a}: ${v.unknown} of ${v.all} checkpoints "couldn't check".`)
  }
  const product = pages.find((j) => j.answers?.page === 'product')
  if (product?.status === 'done' && !((product.snapshot as ReportPageSnapshot | null)?.images || []).some((i) => i.role === 'checkout')) out.push('No checkout screenshot was saved.')
  return out
}

/** Email the team inbox (FEEDBACK_TO, else EMAIL_REPLY_TO) about a report that needs a human look. */
async function alertTeam(parent: ScanJob, problems: string[]): Promise<void> {
  const to = process.env.FEEDBACK_TO || process.env.EMAIL_REPLY_TO
  if (!to) return
  const paid = /^report_cs_live_/.test(parent.scan_id) ? 'PAID' : /^report_cs_test_/.test(parent.scan_id) ? 'sandbox order' : 'test report'
  let store = parent.url
  try { store = new URL(/^https?:/i.test(store) ? store : `https://${store}`).hostname.replace(/^www\./, '') } catch { /* keep */ }
  const link = `https://cxo.studio/scan/report?id=${parent.id}`
  const esc = (x: string) => x.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
  const res = await sendEmail({
    to, replyTo: parent.email,
    subject: `Report needs a look · ${store} · ${paid}`,
    text: [`${store} (${paid}) needs a human look:`, '', ...problems.map((p) => `- ${p}`), '', `Report: ${link}`, 'Reply to this email to write to the buyer.'].join('\n'),
    html: `<p><b>${esc(store)}</b> (${esc(paid)}) needs a human look:</p><ul>${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul><p><a href="${esc(link)}">Open the report</a><br>Reply to this email to write to the buyer.</p>`,
  }).catch((e) => ({ sent: false, error: String(e) }))
  if (!res.sent) console.error('[report] alert not sent', res)
}

function reportEmailFor(job: ScanJob, snap: ReportSnapshot) {
  return resultsEmailFor(job, { ...snap, scanUrl: job.url }, { report: true, link: `/scan/report?id=${job.id}` })
}
