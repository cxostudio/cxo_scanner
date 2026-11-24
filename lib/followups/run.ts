// Follow-ups after a free scan, checked every 5 minutes (vercel.json cron → /api/followups/run):
//   offer  under €50k/month: 15 minutes before the 1-hour €69 offer ends, if they haven't bought
//   call1  €50k/month and up: 24 hours after the scan, "book a call" with their first fix
//   call2  €50k/month and up: day 5, one case study, then nothing more
// Nothing for an address with a call booked on Cal.com (lib/calls/bookings.ts).
// One of each per address, ever (public.scan_followups, written before sending). Unsubscribed
// addresses (public.email_optouts) get nothing. Tables: supabase/followups.sql.
import { createHmac } from 'crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { noStoreFetch } from '@/lib/supabaseFetch'
import type { ScanJob, ScanSnapshot } from '@/lib/scanJobs/store'
import { firstSentence, siteOrigin } from '@/lib/scanJobs/finish'
import { buildFollowupEmail, type FollowupKind } from '@/lib/email/followupEmail'
import { sendEmail } from '@/lib/email/send'
import { estimate, eur } from '@/lib/estimate'
import { isQualified, type ScanResult } from '@/lib/report'
import { offerFor } from '@/lib/offer'
import { reportEligibility } from '@/lib/fullReport/eligible'
import { bookedEmails } from '@/lib/calls/bookings'
import { callLink } from '@/lib/call'

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR

let client: SupabaseClient | null = null
function db(): SupabaseClient {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase is not configured')
  if (!client) client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: noStoreFetch } })
  return client
}

/** Signs a scan id for the unsubscribe link (no address in the URL). */
export function unsubscribeToken(jobId: string): string {
  return createHmac('sha256', `cxo-unsub:${process.env.SUPABASE_SERVICE_ROLE_KEY || ''}`).update(jobId).digest('hex').slice(0, 24)
}
export const unsubscribeUrl = (jobId: string) => `https://cxo.studio/scan/api/unsubscribe?j=${jobId}&t=${unsubscribeToken(jobId)}`

export async function optOut(email: string): Promise<void> {
  const { error } = await db().from('email_optouts').upsert({ email: email.trim().toLowerCase() }, { onConflict: 'email' })
  if (error) throw new Error(error.message)
}

/** The email for one follow-up of one scan. */
export function followupEmailFor(kind: FollowupKind, job: ScanJob) {
  const snap = (job.snapshot || {}) as ScanSnapshot
  const fr = (snap.locale || job.locale) === 'fr'
  const rows = (snap.results || []) as (ScanResult & { status?: string; coveredByShopify?: boolean })[]
  const failed = rows.filter((r) => r.status !== 'unknown' && r.status !== 'na' && !r.coveredByShopify && !r.passed)
  const pri = (r: ScanResult) => (r.checkpoint?.priority === 'High' ? 0 : r.checkpoint?.priority === 'Medium' ? 1 : 2)
  const eff = (r: ScanResult) => ({ Easy: 0, Moderate: 1, Difficult: 2 } as Record<string, number>)[r.checkpoint?.difficulty || ''] ?? 1
  const top = [...failed].sort((a, b) => pri(a) - pri(b) || eff(a) - eff(b))[0]
  const est = estimate(snap.revenue || job.answers?.revenue || '', snap.aov || job.answers?.aov || '', snap.cr || job.answers?.cr || '')
  const k = est ? (Math.round(est.lift10 / 100) / 10).toString().replace(/\.0$/, '') : ''
  let host = snap.scanUrl || job.url
  try { host = new URL(/^https?:/i.test(host) ? host : `https://${host}`).hostname.replace(/^www\./, '') } catch { /* keep */ }
  return buildFollowupEmail({
    kind, locale: fr ? 'fr' : 'en', host, toFix: failed.length,
    topIssue: top ? firstSentence(top.reason || '', 160) : undefined,
    topFix: top ? firstSentence(String(top.checkpoint?.requiredActions || ''), 160) : undefined,
    euroPerMonth: est ? (est.lift10 >= 1000 ? (fr ? `${k.replace('.', ',')} k€` : `€${k}k`) : eur(est.lift10)) : '',
    resultsUrl: `${siteOrigin(job.origin)}/scan/results?id=${job.id}`,
    callUrl: callLink({ source: kind === 'call2' ? 'email-call2' : 'email-call1', email: job.email, store: host, locale: fr ? 'fr' : 'en' }),
    unsubscribeUrl: unsubscribeUrl(job.id),
    logoUrl: 'https://audit.cxo.studio/scan/cxo_studio_logo.png',
    avatarUrl: 'https://audit.cxo.studio/scan/email/louis.jpg',
  })
}

async function send(kind: FollowupKind, job: ScanJob, dry: boolean): Promise<string> {
  const email = job.email.trim().toLowerCase()
  if (dry) return `${kind} → ${job.id} (dry run)`
  // claim first: the unique (email, kind) row means a second run, or a second scan by the same person, sends nothing
  const { error } = await db().from('scan_followups').insert({ email, kind, scan_job_id: job.id })
  if (error) return `${kind} skipped (${/duplicate|unique/i.test(error.message) ? 'already sent' : error.message})`
  const mail = followupEmailFor(kind, job)
  const u = unsubscribeUrl(job.id)
  const res = await sendEmail({ to: email, ...mail, headers: { 'List-Unsubscribe': `<${u}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } })
  return `${kind} → ${job.id} ${res.sent ? 'sent' : `not sent (${res.error})`}`
}

/** Everything due now. dry: list what would go out, send nothing, record nothing. */
export async function runFollowups(opts: { dry?: boolean; now?: number } = {}): Promise<string[]> {
  const now = opts.now ?? Date.now()
  const dry = !!opts.dry
  const out: string[] = []
  const since = new Date(now - 7 * DAY).toISOString()
  const { data, error } = await db().from('scan_jobs').select('*').eq('status', 'done').gte('created_at', since).not('scan_id', 'like', 'report_%').order('created_at', { ascending: true }).limit(2000)
  if (error) throw new Error(error.message)
  const jobs = (data as ScanJob[]).filter((j) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(j.email || '') && j.snapshot)
  if (!jobs.length) return out
  const emails = Array.from(new Set(jobs.map((j) => j.email.trim().toLowerCase())))
  const [opt, sent, bought, booked] = await Promise.all([
    db().from('email_optouts').select('email').in('email', emails),
    db().from('scan_followups').select('email,kind').in('email', emails),
    db().from('scan_jobs').select('email').like('scan_id', 'report_cs_%').in('email', emails),
    bookedEmails(emails).catch(() => new Set<string>()),
  ])
  if (opt.error || sent.error) throw new Error(opt.error?.message || sent.error?.message)
  const out_ = new Set((opt.data || []).map((r) => r.email))
  const had = new Set((sent.data || []).map((r) => `${r.email}|${r.kind}`))
  const buyers = new Set((bought.data || []).map((r) => String(r.email).toLowerCase()))
  // one candidate per address and kind: the latest scan in the window
  const latest = new Map<string, ScanJob>()
  const age = (j: ScanJob) => now - new Date(j.created_at).getTime()

  for (const j of jobs) {
    const email = j.email.trim().toLowerCase()
    if (out_.has(email)) continue
    // a call is already booked: no more sales follow-ups (the call reminders take over)
    if (booked.has(email)) continue
    const qualified = isQualified(j.answers?.revenue || (j.snapshot as ScanSnapshot).revenue || '')
    const a = age(j)
    if (!qualified && a >= 44 * MIN && a <= 60 * MIN && !had.has(`${email}|offer`) && !buyers.has(email)) latest.set(`${email}|offer`, j)
    if (qualified && a >= DAY && a <= 2 * DAY && !had.has(`${email}|call1`)) latest.set(`${email}|call1`, j)
    if (qualified && a >= 5 * DAY && a <= 7 * DAY && had.has(`${email}|call1`) && !had.has(`${email}|call2`)) latest.set(`${email}|call2`, j)
  }
  for (const [key, j] of Array.from(latest)) {
    const kind = key.split('|')[1] as FollowupKind
    if (kind === 'offer') {
      // only while the €69 offer of this address really runs, 2 to 16 minutes before it ends
      const offer = await offerFor(j.email).catch(() => null)
      const left = offer?.active && offer.endsAt ? new Date(offer.endsAt).getTime() - now : 0
      if (!offer?.active || left < 2 * MIN || left > 16 * MIN) { out.push(`offer → ${j.id} not due (offer ${offer?.active ? `ends in ${Math.round(left / MIN)} min` : 'not running'})`); continue }
      const eligible = await reportEligibility((j.snapshot as ScanSnapshot).scanUrl || j.url).catch(() => ({ ok: true }))
      if (!eligible.ok) { out.push(`offer → ${j.id} skipped (report can't be delivered for this store)`); continue }
    }
    out.push(await send(kind, j, dry))
  }
  return out
}

/** Test only: the latest finished free scan of an address. */
export async function latestFreeScan(email: string): Promise<ScanJob | null> {
  const { data } = await db().from('scan_jobs').select('*').eq('email', email.trim().toLowerCase()).eq('status', 'done').not('scan_id', 'like', 'report_%').order('created_at', { ascending: false }).limit(1)
  return ((data || [])[0] as ScanJob) || null
}
