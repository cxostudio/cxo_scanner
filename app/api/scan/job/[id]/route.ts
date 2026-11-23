import { NextRequest, NextResponse } from 'next/server'
import { getJob } from '@/lib/scanJobs/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The results page opened from the email (or another device): the stored scan, once it's done. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const job = await getJob(params.id).catch(() => null)
  if (!job) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json(
    { status: job.status, snapshot: job.status === 'done' ? job.snapshot : null, error: job.status === 'failed' ? job.error : null },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
