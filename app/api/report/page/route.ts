import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { getJob } from '@/lib/scanJobs/store'
import { internalKey, runPage } from '@/lib/fullReport/run'

export const runtime = 'nodejs'
// one page of a full report: the scan (up to ~3 min) runs after the reply, in this invocation
export const maxDuration = 300

/** Internal: started by lib/fullReport kickoff, one call per page. */
export async function POST(request: NextRequest) {
  if (request.headers.get('x-report-key') !== internalKey()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = (await request.json().catch(() => ({}))) as { id?: string }
  const job = id ? await getJob(id).catch(() => null) : null
  if (!job || !job.scan_id.startsWith('report_') || !job.scan_id.includes('__')) return NextResponse.json({ error: 'Unknown page' }, { status: 404 })
  if (job.status === 'done') return NextResponse.json({ ok: true, already: true })
  waitUntil(runPage(job))
  return NextResponse.json({ ok: true })
}
