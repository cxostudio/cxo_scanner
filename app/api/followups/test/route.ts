import { NextRequest, NextResponse } from 'next/server'
import { getJob } from '@/lib/scanJobs/store'
import { isTestEmail } from '@/lib/conversionCheckpoints/filterByUrlPageType'
import { followupEmailFor, unsubscribeUrl } from '@/lib/followups/run'
import { sendEmail } from '@/lib/email/send'

export const runtime = 'nodejs'

/** Send one follow-up now, to the scan's own address, for CXO Studio and +test scans only. POST { jobId, kind } */
export async function POST(request: NextRequest) {
  const { jobId, kind } = (await request.json().catch(() => ({}))) as { jobId?: string; kind?: string }
  if (!jobId || !['offer', 'call1', 'call2'].includes(kind || '')) return NextResponse.json({ error: 'jobId and kind (offer, call1, call2) are required' }, { status: 400 })
  const job = await getJob(jobId).catch(() => null)
  if (!job || !job.snapshot) return NextResponse.json({ error: 'Unknown or unfinished scan' }, { status: 404 })
  if (!isTestEmail(job.email)) return NextResponse.json({ error: 'Test scans only' }, { status: 403 })
  const mail = followupEmailFor(kind as 'offer' | 'call1' | 'call2', job)
  const u = unsubscribeUrl(job.id)
  const res = await sendEmail({ to: job.email, ...mail, headers: { 'List-Unsubscribe': `<${u}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } })
  return NextResponse.json({ sent: res.sent, subject: mail.subject, error: res.error })
}
