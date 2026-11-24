// POST /api/scan/start/<id> : the later steps of a background scan (lib/scanJobs/background).
//   { action: 'answers', answers }        a one-tap answer (revenue, order value, conversion rate)
//   { action: 'judge' }                   the visitor reached the email step: the AI judging starts
//   { action: 'email', email, answers }   the email step: limits, then the email and answers on the job
import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { attachEmail, requestJudge } from '@/lib/scanJobs/background'
import { getJob, mergeAnswers } from '@/lib/scanJobs/store'
import { checkScanLimit } from '@/lib/usage/scanLimit'
import { checkDomainLimit, domainLimitMessage } from '@/lib/usage/domainLimit'
import { isBypass, isInternalEmail } from '@/lib/usage/bypass'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// the judge can run after the answer (waitUntil)
export const maxDuration = 300

const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '')

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const job = await getJob(params.id).catch(() => null)
  if (!job || !job.scan_id.startsWith('bg_')) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const b = (await req.json().catch(() => ({}))) as { action?: string; email?: string; answers?: Record<string, unknown> }
  const a = b.answers || {}
  const answers = { revenue: str(a.revenue, 60), aov: str(a.aov, 20), cr: str(a.cr, 20), role: str(a.role, 60) }

  if (b.action === 'answers') {
    await mergeAnswers(job.id, Object.fromEntries(Object.entries(answers).filter(([, v]) => v)))
    return NextResponse.json({ ok: true })
  }
  if (b.action === 'judge') {
    waitUntil(requestJudge(job))
    return NextResponse.json({ ok: true, status: job.status })
  }
  if (b.action === 'email') {
    const email = str(b.email, 200).toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Enter a valid email address', code: 'invalid_email' }, { status: 400 })
    if (job.status === 'failed') return NextResponse.json({ error: 'scan failed', code: 'scan_failed' }, { status: 409 })
    if (!isBypass(req) && !isInternalEmail(email)) {
      const limit = await checkScanLimit(email)
      if (!limit.allowed) return NextResponse.json({ error: `You've reached today's limit of ${limit.limit} scans. Please try again tomorrow.`, code: 'daily_limit_reached' }, { status: 429 })
      const store = await checkDomainLimit(email, job.answers?.scanUrl || job.url, job.scan_id)
      if (!store.allowed) return NextResponse.json({ error: domainLimitMessage(store.host), code: 'store_limit_reached' }, { status: 429 })
    }
    waitUntil(attachEmail(job, { email, answers }))
    return NextResponse.json({ ok: true, id: job.id, status: job.status })
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
