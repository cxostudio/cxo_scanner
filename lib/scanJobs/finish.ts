// A scan just finished (in the browser or on the server): store it, then send the results email once.
import { completeJob, markEmailed, type ScanJob, type ScanSnapshot } from './store'
import { reportEligibility } from '@/lib/fullReport/eligible'
import { buildResultsEmail } from '@/lib/email/resultsEmail'
import { sendEmail } from '@/lib/email/send'
import { estimate, eur } from '@/lib/estimate'
import { isQualified, scoreOf, type ScanResult } from '@/lib/report'

const CALL_URL = process.env.NEXT_PUBLIC_CALL_URL || 'https://tally.so/r/w2dP9M'
// links in the email may only point at our own sites
const SITES = [/^https:\/\/(www\.)?cxo\.studio$/, /^https:\/\/cxo-studio-[a-z0-9-]+\.vercel\.app$/, /^https:\/\/audit\.cxo\.studio$/, /^https:\/\/cxo-scanner-[a-z0-9-]+\.vercel\.app$/]
export const siteOrigin = (o: string | null | undefined) => (o && SITES.some((r) => r.test(o)) ? o : 'https://cxo.studio')

const shortEur = (n: number, fr: boolean) => {
  if (n < 1000) return eur(n)
  const k = (Math.round(n / 100) / 10).toString().replace(/\.0$/, '')
  return fr ? `${k.replace('.', ',')} k€` : `€${k}k`
}
export const firstSentence = (s: string, max = 120) => {
  const t = (s || '').replace(/\*\*/g, '').split('\n').map((l) => l.trim()).find(Boolean) || ''
  const one = (t.match(/^.*?[.!?](\s|$)/)?.[0] || t).trim()
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one
}

export function resultsEmailFor(job: ScanJob, snap: ScanSnapshot, opts: { report?: boolean; link?: string; reportOk?: boolean } = {}) {
  const fr = (snap.locale || job.locale) === 'fr'
  const rows = (snap.results || []) as (ScanResult & { status?: string; coveredByShopify?: boolean; reason?: string })[]
  const scored = rows.filter((r) => r.status !== 'unknown')
  const base = scored.filter((r) => r.status !== 'na' && !r.coveredByShopify)
  const failed = base.filter((r) => !r.passed)
  const pri = (r: ScanResult) => (r.checkpoint?.priority === 'High' ? 0 : r.checkpoint?.priority === 'Medium' ? 1 : 2)
  const eff = (r: ScanResult) => ({ Easy: 0, Moderate: 1, Difficult: 2 } as Record<string, number>)[r.checkpoint?.difficulty || ''] ?? 1
  const top = [...failed].sort((a, b) => pri(a) - pri(b) || eff(a) - eff(b)).slice(0, 3).map((r) => ({
    title: firstSentence(r.reason || r.ruleTitle),
    fix: firstSentence(String(r.checkpoint?.requiredActions || ''), 150),
  }))
  const est = estimate(snap.revenue || '', snap.aov || '', snap.cr || '')
  const origin = siteOrigin(job.origin)
  let host = snap.scanUrl
  try { host = new URL(snap.scanUrl).hostname.replace(/^www\./, '') } catch { /* keep */ }
  return buildResultsEmail({
    locale: fr ? 'fr' : 'en', host,
    euroPerMonth: est ? shortEur(est.lift10, fr) : '',
    score: scoreOf(scored), toFix: failed.length, checked: base.length,
    easyHigh: failed.filter((r) => r.checkpoint?.priority === 'High' && r.checkpoint?.difficulty === 'Easy').length,
    top,
    resultsUrl: `${origin}${opts.link || `/scan/results?id=${job.id}`}`,
    report: opts.report,
    reportOk: opts.reportOk,
    callUrl: CALL_URL,
    qualified: isQualified(snap.revenue || ''),
    logoUrl: 'https://audit.cxo.studio/scan/cxo_studio_logo.png',
    avatarUrl: 'https://audit.cxo.studio/scan/email/louis.jpg',
    privacyUrl: `${origin === 'https://cxo.studio' ? 'https://cxo.studio' : origin}${fr ? '/fr' : ''}/privacy`,
  })
}

/** Store the finished scan and send the email; a second finisher (browser after server, or the reverse) does nothing. */
export async function finishJob(job: ScanJob, snap: ScanSnapshot): Promise<{ stored: boolean; emailed: boolean }> {
  const done = await completeJob(job.id, snap)
  if (!done) return { stored: false, emailed: false }
  if (!(await markEmailed(job.id))) return { stored: true, emailed: false }
  const eligible = await reportEligibility(snap.scanUrl || done.url).catch(() => ({ ok: true }))
  const mail = resultsEmailFor(done, snap, { reportOk: eligible.ok })
  const r = await sendEmail({ to: done.email, ...mail })
  return { stored: true, emailed: r.sent }
}
