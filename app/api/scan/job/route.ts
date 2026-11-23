import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createJob } from '@/lib/scanJobs/store'
import { watch } from '@/lib/scanJobs/takeover'

export const runtime = 'nodejs'
// the watch (2 min) plus a server-run scan (up to ~3 min) fit in one invocation
export const maxDuration = 300

/** The browser registers a scan as it starts it. Returns the job id (the private results link). */
export async function POST(request: NextRequest) {
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const str = (v: unknown, n = 500) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : '')
  const scanId = str(b.scanId, 100)
  const email = str(b.email, 200).toLowerCase()
  const url = str(b.url, 1000)
  if (!scanId || !url || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'scanId, email and url are required' }, { status: 400 })
  const a = (b.answers || {}) as Record<string, unknown>
  try {
    const job = await createJob({
      scanId, email, url, locale: str(b.locale, 5) === 'fr' ? 'fr' : 'en',
      answers: { revenue: str(a.revenue, 60), aov: str(a.aov, 20), cr: str(a.cr, 20) },
      origin: str(b.origin, 200) || null,
    })
    waitUntil(watch(job.id))
    return NextResponse.json({ id: job.id })
  } catch (e) {
    // scans never fail because of this: the browser carries on without a job
    console.error('[scan-job] create failed', e)
    return NextResponse.json({ error: 'job not stored' }, { status: 503 })
  }
}
