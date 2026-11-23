import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { getJob, type ScanSnapshot } from '@/lib/scanJobs/store'
import { finishJob } from '@/lib/scanJobs/finish'

export const runtime = 'nodejs'
export const maxDuration = 60

/** The browser finished the scan: store it (unless the server already did) and send the email. */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ ok: false }, { status: 404 })
  const snap = (await request.json().catch(() => null)) as ScanSnapshot | null
  if (!snap || !Array.isArray(snap.results) || !snap.scanUrl) return NextResponse.json({ error: 'results and scanUrl are required' }, { status: 400 })
  const job = await getJob(params.id).catch(() => null)
  if (!job) return NextResponse.json({ ok: false }, { status: 404 })
  waitUntil(finishJob(job, snap).catch((e) => console.error('[scan-job] finish failed', params.id, e)))
  return NextResponse.json({ ok: true })
}
