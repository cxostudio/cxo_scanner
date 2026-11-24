import { NextRequest, NextResponse } from 'next/server'
import { getJob } from '@/lib/scanJobs/store'
import { isTestEmail } from '@/lib/conversionCheckpoints/filterByUrlPageType'
import { followupEmailFor, unsubscribeUrl } from '@/lib/followups/run'
import { sendEmail } from '@/lib/email/send'
import { previewCallEmail, resendReminderFor } from '@/lib/calls/bookings'

export const runtime = 'nodejs'

/** Send one follow-up (or call reminder / booking alert) now, to the scan's own address, for CXO Studio and +test scans only. POST { jobId, kind } */
export async function POST(request: NextRequest) {
  const { jobId, kind, email } = (await request.json().catch(() => ({}))) as { jobId?: string; kind?: string; email?: string }
  // { email, kind: reminder24 | reminder1 }: the real stored booking of a test address
  if (email && (kind === 'reminder24' || kind === 'reminder1')) {
    if (!isTestEmail(email)) return NextResponse.json({ error: 'Test addresses only' }, { status: 403 })
    return NextResponse.json(await resendReminderFor(email, kind === 'reminder24' ? '24h' : '1h'))
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
