// Background free scans, for the URL-first /start (cxo-studio Onboarding.astro):
//   URL step     → startBackgroundScan: a job without an email, the page capture starts (no AI)
//   email step   → requestJudge: the AI judges the kept capture (starts as soon as the capture is in)
//   email given  → attachEmail: limits, the email and answers on the job; the results email goes
//                  out when both the results and the email are there, whichever comes last
// The visitor then lands on /scan/results?id=…, which waits by itself while the scan finishes.
// Test emails (CXO studio, +test) don't use this: /start sends them through the classic scan so
// the lab keeps getting full test scans with Draft checkpoints.
import { randomUUID } from 'crypto'
import { selfOrigin } from './runServer'
import { createJob, completeJob, failJob, getJob, markEmailed, mergeAnswers, moveStatus, setJobEmail, updateDoneSnapshot, type ScanJob, type ScanSnapshot } from './store'
import { resultsEmailFor } from './finish'
import { deleteEvidence } from './evidence'
import { detectPageTypeFromUrl } from '@/lib/conversionCheckpoints/pageType'
import { reportEligibility } from '@/lib/fullReport/eligible'
import { sendEmail } from '@/lib/email/send'
import { registerScan } from '@/lib/usage/scanLimit'

const api = (p: string) => `${selfOrigin()}/scan/api${p}`
const CART = 'recdyiscpsbfrbbha'
const abs = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`)
type Rule = { id: string; pageTypeIds?: string[] } & Record<string, unknown>

async function rulesFor(url: string): Promise<Rule[]> {
  const r = await fetch(api(`/conversion-checkpoints?pageType=${encodeURIComponent(detectPageTypeFromUrl(url))}`))
  if (!r.ok) throw new Error(`checkpoints ${r.status}`)
  const d = (await r.json()) as { rules?: Rule[] }
  if (!Array.isArray(d.rules) || !d.rules.length) throw new Error('no checkpoints for this page')
  return d.rules
}

export async function startBackgroundScan(input: { url: string; locale: 'en' | 'fr'; origin: string | null; ip: string }): Promise<ScanJob> {
  return createJob({
    scanId: `bg_${randomUUID()}`, email: '', url: input.url, locale: input.locale, origin: input.origin,
    answers: { bg: true, ip: input.ip },
  }).then(async (job) => (await moveStatus(job.id, 'running', 'capturing'), { ...job, status: 'capturing' as const }))
}

/** Step 1, at the URL: find the product page, take it and keep it. Then judge if the visitor is already at the email. */
export async function captureInBackground(job: ScanJob): Promise<void> {
  try {
    let url = abs(job.url)
    let resolvedFrom: string | undefined
    let resolvedHow: string | undefined
    // the free scan is a product-page scan: a homepage or collection becomes the best seller
    if (detectPageTypeFromUrl(url) !== 'product') {
      try {
        const r = await fetch(api(`/resolve-product?url=${encodeURIComponent(url)}`))
        const d = (await r.json().catch(() => null)) as { url?: string; resolved?: boolean; how?: string } | null
        if (r.ok && d?.resolved && d.url) { resolvedFrom = url; resolvedHow = d.how || ''; url = d.url }
      } catch (e) { console.warn('[bg-scan] resolve-product failed', e) }
    }
    await mergeAnswers(job.id, { scanUrl: url, resolvedFrom, resolvedHow })
    const rules = await rulesFor(url)
    let lastErr = ''
    for (let attempt = 1; attempt <= 2; attempt++) {
      const res = await fetch(api('/scan'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, rules, scanId: job.scan_id, phase: 'capture' }) })
      const d = (await res.json().catch(() => ({}))) as { captured?: boolean; error?: string }
      if (res.ok && d.captured) { lastErr = ''; break }
      lastErr = d.error || `capture ${res.status}`
      if (res.status === 422) break // the page can't be scanned: retrying won't help
    }
    if (lastErr) return failJob(job.id, lastErr)
    await moveStatus(job.id, 'capturing', 'captured')
    const fresh = await getJob(job.id)
    if (fresh?.answers?.judge) await judgeInBackground(fresh)
  } catch (e) {
    console.error('[bg-scan] capture failed', job.id, e)
    await failJob(job.id, e instanceof Error ? e.message : String(e))
  }
}

/** The visitor reached the email step: judge now if the capture is in, else as soon as it is. */
export async function requestJudge(job: ScanJob): Promise<void> {
  const fresh = (await mergeAnswers(job.id, { judge: true })) || job
  if (fresh.status === 'captured') await judgeInBackground(fresh)
}

/** Step 2: the AI judges the kept capture; the scan is stored, and emailed if the email is in. */
export async function judgeInBackground(job: ScanJob): Promise<void> {
  if (!(await moveStatus(job.id, 'captured', 'judging'))) return // not captured yet, or already judging
  try {
    const url = job.answers?.scanUrl || abs(job.url)
    const rules = await rulesFor(url)
    const pageOnly = rules.filter((r) => { const ids = (r.pageTypeIds || []).map((x) => x.toLowerCase()); return !(ids.length && ids.every((x) => x === CART)) }).length
    let data: { results?: unknown[]; previews?: { desktop: string | null; mobile: string | null }; error?: string } = {}
    for (let attempt = 1; attempt <= 2; attempt++) {
      const res = await fetch(api('/scan'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, rules, scanId: job.scan_id, phase: 'judge' }) })
      data = await res.json().catch(() => ({}))
      if (res.ok && Array.isArray(data.results)) break
      if (res.status === 409 || res.status === 422) break
    }
    if (!Array.isArray(data.results) || !data.results.length) return failJob(job.id, data.error || 'judge failed')
    let results = data.results
    try {
      const c = await fetch(api('/scan/combine'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ results }) })
      if (c.ok) { const d = (await c.json()) as { results?: unknown[] }; if (Array.isArray(d.results)) results = d.results }
    } catch (e) { console.warn('[bg-scan] combine failed, keeping raw results', e) }
    const latest = (await getJob(job.id)) || job
    const a = latest.answers || {}
    const snap: ScanSnapshot = {
      results, scanUrl: url, revenue: a.revenue, aov: a.aov, cr: a.cr, locale: latest.locale,
      pageChecks: pageOnly || rules.length, resolvedFrom: a.resolvedFrom, resolvedHow: a.resolvedHow, labId: null,
      previewDesktop: data.previews?.desktop ?? null, previewMobile: data.previews?.mobile ?? null,
    }
    await completeJob(job.id, snap)
    await deleteEvidence(job.scan_id)
    const done = await getJob(job.id)
    if (done && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(done.email)) await sendResultsOnce(done)
  } catch (e) {
    console.error('[bg-scan] judge failed', job.id, e)
    await failJob(job.id, e instanceof Error ? e.message : String(e))
  }
}

/** The results email, once per job, whichever of "results in" and "email in" comes last. */
async function sendResultsOnce(job: ScanJob): Promise<void> {
  if (job.status !== 'done' || !job.snapshot || !job.email) return
  if (!(await markEmailed(job.id))) return
  const eligible = await reportEligibility(job.snapshot.scanUrl || job.url).catch(() => ({ ok: true }))
  const mail = resultsEmailFor(job, job.snapshot, { reportOk: eligible.ok })
  await sendEmail({ to: job.email, ...mail }).catch((e) => console.error('[bg-scan] results email failed', job.id, e))
}

/** The email step: the email and answers on the job; the email goes out now if the scan is done. */
export async function attachEmail(job: ScanJob, input: { email: string; answers: { revenue?: string; aov?: string; cr?: string; role?: string } }): Promise<ScanJob | null> {
  await mergeAnswers(job.id, { ...input.answers, judge: true })
  const withEmail = await setJobEmail(job.id, input.email)
  if (!withEmail) return getJob(job.id) // an email was already given: keep the first
  await registerScan(input.email, job.scan_id).catch(() => {})
  // answers given after the scan finished: the results page and the email need them
  if (withEmail.status === 'done' && withEmail.snapshot) {
    const snap = { ...withEmail.snapshot, revenue: input.answers.revenue, aov: input.answers.aov, cr: input.answers.cr }
    await updateDoneSnapshot(job.id, snap)
    await sendResultsOnce({ ...withEmail, snapshot: snap })
  } else if (withEmail.status === 'captured') {
    await judgeInBackground(withEmail)
  }
  return getJob(job.id)
}

