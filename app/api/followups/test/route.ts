import { NextRequest, NextResponse } from 'next/server'
import { getJob } from '@/lib/scanJobs/store'
import { isTestEmail } from '@/lib/conversionCheckpoints/filterByUrlPageType'
import { followupEmailFor, unsubscribeUrl } from '@/lib/followups/run'
import { sendEmail } from '@/lib/email/send'
import { previewCallEmail, previewNoLead, resendReminderFor } from '@/lib/calls/bookings'
import { latestFreeScan } from '@/lib/followups/run'
import { resultsEmailFor } from '@/lib/scanJobs/finish'
import { reportEmailFor } from '@/lib/fullReport/run'
import { reportEligibility } from '@/lib/fullReport/eligible'
import type { ScanSnapshot } from '@/lib/scanJobs/store'

export const runtime = 'nodejs'

/** Send one follow-up (or call reminder / booking alert) now, to the scan's own address, for CXO studio and +test scans only. POST { jobId, kind } */
export async function POST(request: NextRequest) {
  const { jobId, kind, email, to, revenue } = (await request.json().catch(() => ({}))) as { jobId?: string; kind?: string; email?: string; to?: string; revenue?: 'under' | 'over' }
  // { kind: 'results', email, to, revenue: under | over }: the free scan results email of a test address's latest scan,
  // as a store under €50k (pushes the report) or over €100k (pushes a call) would get it
  if (kind === 'results' && email && to) {
    if (!isTestEmail(email) || !isTestEmail(to)) return NextResponse.json({ error: 'Test addresses only' }, { status: 403 })
    const job = await latestFreeScan(email)
    if (!job?.snapshot) return NextResponse.json({ error: 'No finished free scan for this address' }, { status: 404 })
    const band = revenue === 'over' ? 'Over €100,000 / month' : '€10,000–€50,000 / month'
    const snap = { ...(job.snapshot as ScanSnapshot), revenue: band, aov: (job.snapshot as ScanSnapshot).aov || '40-80', cr: (job.snapshot as ScanSnapshot).cr || '1-2' }
    const eligible = await reportEligibility(snap.scanUrl || job.url).catch(() => ({ ok: true }))
    const mail = resultsEmailFor({ ...job, answers: { ...(job.answers || {}), revenue: band } }, snap, { reportOk: eligible.ok })
    const res = await sendEmail({ to, ...mail })
    return NextResponse.json({ sent: res.sent, subject: mail.subject, store: snap.scanUrl, reportOk: eligible.ok, error: res.error })
  }
  // { kind: 'report', jobId, to }: the "your full report is ready" email of a test report
  if (kind === 'report' && jobId && to) {
    const job = await getJob(jobId).catch(() => null)
    if (!job?.snapshot || !isTestEmail(job.email) || !isTestEmail(to)) return NextResponse.json({ error: 'Test reports only' }, { status: 403 })
    const mail = reportEmailFor(job, job.snapshot as Parameters<typeof reportEmailFor>[1])
    const res = await sendEmail({ to, ...mail })
    return NextResponse.json({ sent: res.sent, subject: mail.subject, error: res.error })
  }
  // { to, kind, nolead: true }: the emails for someone with no scan or report
  if (to && (kind === 'reminder24' || kind === 'reminder1' || kind === 'booked') && (jobId === 'nolead')) {
    if (!isTestEmail(to)) return NextResponse.json({ error: 'Test addresses only' }, { status: 403 })
    return NextResponse.json({ log: await previewNoLead(kind === 'reminder24' ? '24h' : kind === 'reminder1' ? '1h' : 'booked', to) })
  }
  // { email, kind: reminder24 | reminder1 }: the real stored booking of a test address
  if (email && (kind === 'reminder24' || kind === 'reminder1')) {
    if (!isTestEmail(email) || (to && !isTestEmail(to))) return NextResponse.json({ error: 'Test addresses only' }, { status: 403 })
    return NextResponse.json(await resendReminderFor(email, kind === 'reminder24' ? '24h' : '1h', to))
  }
  const CALL = ['reminder24', 'reminder1', 'booked']
  if (!jobId || !['offer', 'call1', 'call2', ...CALL].includes(kind || '')) return NextResponse.json({ error: 'jobId and kind (offer, call1, call2, reminder24, reminder1, booked) are required' }, { status: 400 })
  const job = await getJob(jobId).catch(() => null)
  if (job && CALL.includes(kind!)) {
    if (!isTestEmail(job.email)) return NextResponse.json({ error: 'Test scans only' }, { status: 403 })
    const log = await previewCallEmail(job, kind === 'reminder24' ? '24h' : kind === 'reminder1' ? '1h' : 'booked')
    return NextResponse.json({ log })
  }
  if (!job || !job.snapshot) return NextResponse.json({ error: 'Unknown or unfinished scan' }, { status: 404 })
  if (!isTestEmail(job.email)) return NextResponse.json({ error: 'Test scans only' }, { status: 403 })
  const mail = followupEmailFor(kind as 'offer' | 'call1' | 'call2', job)
  const u = unsubscribeUrl(job.id)
  const res = await sendEmail({ to: job.email, ...mail, headers: { 'List-Unsubscribe': `<${u}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } })
  return NextResponse.json({ sent: res.sent, subject: mail.subject, error: res.error })
}
