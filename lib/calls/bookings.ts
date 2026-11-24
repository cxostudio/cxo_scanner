// Calls booked on Cal.com: stored from its webhook (app/api/cal/webhook), used to
//   1. send our own reminders, 24 hours and 1 hour before (cron, every 5 minutes)
//   2. stop the "book a call" follow-ups for anyone who already booked (lib/followups/run.ts)
//   3. tell the team who booked, with their scan or report.
// Table: supabase/call_bookings.sql. If it doesn't exist yet, everything here does nothing.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { noStoreFetch } from '@/lib/supabaseFetch'
import { sendEmail } from '@/lib/email/send'
import { buildBookedAlert, buildReminderEmail } from '@/lib/email/callEmail'
import type { ScanJob } from '@/lib/scanJobs/store'

const MIN = 60_000, HOUR = 60 * MIN
let client: SupabaseClient | null = null
function db(): SupabaseClient {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase is not configured')
  if (!client) client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: noStoreFetch } })
  return client
}
const missingTable = (m?: string) => !!m && /call_bookings|does not exist|schema cache/i.test(m)

export type Booking = {
  uid: string; email: string; name: string | null; start_time: string; end_time: string | null; status: string
  meeting_url: string | null; timezone: string | null; locale: string | null; source: string | null; store: string | null
  responses: Record<string, unknown> | null; reminded_24h: string | null; reminded_1h: string | null; created_at: string
}

/* ---------- webhook ---------- */

type CalPayload = {
  uid?: string; rescheduleUid?: string; startTime?: string; endTime?: string; status?: string; location?: string
  attendees?: { name?: string; email?: string; timeZone?: string; language?: { locale?: string } }[]
  metadata?: Record<string, unknown>; responses?: Record<string, { value?: unknown; label?: string } | unknown>
}

const answerText = (v: unknown): string => {
  const x = v && typeof v === 'object' && 'value' in (v as object) ? (v as { value: unknown }).value : v
  if (x == null) return ''
  if (typeof x === 'string') return x
  if (Array.isArray(x)) return x.map(answerText).join(', ')
  if (typeof x === 'object') return Object.values(x as object).map(answerText).filter(Boolean).join(' ')
  return String(x)
}

/** Store or update a booking from one Cal.com webhook event. Returns what happened, for the log. */
export async function handleCalEvent(event: string, p: CalPayload): Promise<string> {
  if (!p.uid) return 'ignored (no booking uid)'
  if (event === 'BOOKING_CANCELLED' || event === 'BOOKING_REJECTED') {
    const { error } = await db().from('call_bookings').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('uid', p.uid)
    if (error) throw new Error(error.message)
    return `cancelled ${p.uid}`
  }
  if (event !== 'BOOKING_CREATED' && event !== 'BOOKING_RESCHEDULED') return `ignored (${event})`
  const a = p.attendees?.[0] || {}
  const email = String(a.email || '').trim().toLowerCase()
  if (!email || !p.startTime) return 'ignored (no attendee email or time)'
  const meta = (p.metadata || {}) as Record<string, unknown>
  const responses = Object.fromEntries(Object.entries(p.responses || {}).filter(([k]) => !['name', 'email', 'location', 'guests', 'rescheduleReason'].includes(k)).map(([k, v]) => [k, answerText(v)]).filter(([, v]) => v))
  const row = {
    uid: p.uid, email, name: a.name || null, start_time: p.startTime, end_time: p.endTime || null, status: 'booked',
    meeting_url: String(meta.videoCallUrl || (/^https?:/i.test(p.location || '') ? p.location : '') || '') || null,
    timezone: a.timeZone || null, locale: /^fr/i.test(a.language?.locale || '') ? 'fr' : 'en',
    source: typeof meta.source === 'string' ? meta.source : null, store: typeof meta.store === 'string' ? meta.store : null,
    responses, reminded_24h: null, reminded_1h: null, updated_at: new Date().toISOString(),
  }
  const { error } = await db().from('call_bookings').upsert(row, { onConflict: 'uid' })
  if (error) throw new Error(error.message)
  if (event === 'BOOKING_RESCHEDULED' && p.rescheduleUid && p.rescheduleUid !== p.uid) {
    await db().from('call_bookings').update({ status: 'rescheduled', updated_at: new Date().toISOString() }).eq('uid', p.rescheduleUid)
  }
  await alertTeam(row as unknown as Booking, event === 'BOOKING_RESCHEDULED').catch((e) => console.error('[calls] team alert failed', e))
  return `${event === 'BOOKING_RESCHEDULED' ? 'rescheduled' : 'booked'} ${p.uid} for ${email}`
}

/* ---------- what we know about this person ---------- */

async function leadOf(email: string): Promise<{ report?: ScanJob; scan?: ScanJob }> {
  const { data } = await db().from('scan_jobs').select('id,scan_id,url,status,created_at,answers,locale,origin').eq('email', email).order('created_at', { ascending: false }).limit(50)
  const jobs = (data || []) as ScanJob[]
  return {
    report: jobs.find((j) => j.scan_id?.startsWith('report_') && !j.scan_id.includes('__')),
    scan: jobs.find((j) => !j.scan_id?.startsWith('report_') && j.status === 'done'),
  }
}
const hostOf = (u?: string | null) => { try { return new URL(/^https?:/i.test(u || '') ? u! : `https://${u}`).hostname.replace(/^www\./, '') } catch { return u || '' } }
const reportUrl = (j: ScanJob) => `https://cxo.studio/scan/report?id=${j.id}`
const scanUrl = (j: ScanJob) => `https://cxo.studio/scan/results?id=${j.id}`

function fmt(iso: string, tz: string | null, locale: 'en' | 'fr') {
  const d = new Date(iso), timeZone = tz || 'Europe/Brussels'
  const loc = locale === 'fr' ? 'fr-BE' : 'en-GB'
  try {
    const day = d.toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'long', timeZone })
    const time = d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit', timeZone })
    const ymd = (x: Date) => x.toLocaleDateString('en-CA', { timeZone })
    return { when: locale === 'fr' ? `${day} à ${time}` : `${day} at ${time}`, time, today: ymd(d) === ymd(new Date()) }
  } catch { return { when: d.toISOString(), time: '', today: false } }
}

async function alertTeam(b: Booking, rescheduled: boolean) {
  const to = process.env.FEEDBACK_TO || process.env.EMAIL_REPLY_TO
  if (!to) return
  const lead = await leadOf(b.email).catch(() => ({} as Awaited<ReturnType<typeof leadOf>>))
  const links: [string, string][] = []
  if (lead.report) links.push(['Their full report', reportUrl(lead.report)])
  if (lead.scan) links.push(['Their free scan', scanUrl(lead.scan)])
  const answers = Object.entries(b.responses || {}).map(([k, v]) => [k, String(v)] as [string, string])
  const mail = buildBookedAlert({
    name: b.name || '', email: b.email, when: fmt(b.start_time, 'Europe/Brussels', 'en').when, source: b.source || undefined, rescheduled,
    store: b.store || hostOf(lead.report?.url || lead.scan?.url) || undefined,
    revenue: (lead.scan?.answers?.revenue || lead.report?.answers?.revenue || '') as string, links, answers,
  })
  await sendEmail({ to, ...mail })
}

/* ---------- follow-ups ---------- */

/** Addresses with a call booked (now or coming): no "book a call" follow-ups for them. Empty if the table isn't there yet. */
export async function bookedEmails(emails: string[]): Promise<Set<string>> {
  if (!emails.length) return new Set()
  const { data, error } = await db().from('call_bookings').select('email').in('email', emails).eq('status', 'booked')
  if (error) { if (!missingTable(error.message)) console.error('[calls] booked lookup failed', error.message); return new Set() }
  return new Set((data || []).map((r) => String(r.email)))
}

/* ---------- reminders ---------- */

async function claim(uid: string, col: 'reminded_24h' | 'reminded_1h'): Promise<boolean> {
  const { data, error } = await db().from('call_bookings').update({ [col]: new Date().toISOString() }).eq('uid', uid).is(col, null).eq('status', 'booked').select('uid')
  return !error && !!data?.length
}

async function remind(b: Booking, kind: '24h' | '1h'): Promise<string> {
  const locale = (b.locale === 'fr' ? 'fr' : 'en') as 'en' | 'fr'
  const lead = await leadOf(b.email).catch(() => ({} as Awaited<ReturnType<typeof leadOf>>))
  const prep = lead.report ? reportUrl(lead.report) : lead.scan ? scanUrl(lead.scan) : undefined
  const { when, time, today } = fmt(b.start_time, b.timezone, locale)
  const mail = buildReminderEmail({
    kind, locale, firstName: (b.name || '').split(/\s+/)[0] || '', when, time, today,
    store: b.store || hostOf(lead.report?.url || lead.scan?.url) || undefined,
    joinUrl: b.meeting_url || undefined, prepUrl: prep, prepIsReport: !!lead.report,
    rescheduleUrl: `https://cal.com/reschedule/${b.uid}`, cancelUrl: `https://cal.com/booking/${b.uid}?cancel=true`,
    logoUrl: 'https://audit.cxo.studio/scan/cxo_studio_logo.png', avatarUrl: 'https://audit.cxo.studio/scan/email/louis.jpg',
  })
  const res = await sendEmail({ to: b.email, ...mail })
  return `reminder ${kind} → ${b.email} ${res.sent ? 'sent' : `not sent (${res.error})`}`
}

/** Reminders due now. 24h: sent once between 24h and 3h before, unless booked less than 6h ago.
 *  1h: sent once between 65 and 10 minutes before, unless booked less than 2h ago. */
export async function runCallReminders(opts: { dry?: boolean; now?: number } = {}): Promise<string[]> {
  const now = opts.now ?? Date.now()
  const { data, error } = await db().from('call_bookings').select('*').eq('status', 'booked')
    .gt('start_time', new Date(now).toISOString()).lt('start_time', new Date(now + 24 * HOUR + 5 * MIN).toISOString())
  if (error) { if (missingTable(error.message)) return []; throw new Error(error.message) }
  const out: string[] = []
  for (const b of (data || []) as Booking[]) {
    const left = new Date(b.start_time).getTime() - now
    const bookedAgo = now - new Date(b.created_at).getTime()
    const kind = !b.reminded_1h && left <= 65 * MIN && left > 10 * MIN && bookedAgo > 2 * HOUR ? '1h'
      : !b.reminded_24h && left <= 24 * HOUR && left > 3 * HOUR && bookedAgo > 6 * HOUR ? '24h' : null
    if (!kind) continue
    if (opts.dry) { out.push(`reminder ${kind} → ${b.email} (dry run)`); continue }
    if (!(await claim(b.uid, kind === '1h' ? 'reminded_1h' : 'reminded_24h'))) continue
    out.push(await remind(b, kind))
  }
  return out
}
