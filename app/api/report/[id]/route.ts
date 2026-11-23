import { NextResponse } from 'next/server'
import { getJob, listJobsByPrefix } from '@/lib/scanJobs/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The full report for /report?id=: its pages with their results, or where it is while it runs. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const parent = await getJob(params.id).catch(() => null)
  if (!parent || !parent.scan_id.startsWith('report_') || parent.scan_id.includes('__')) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const pages = (await listJobsByPrefix(`${parent.scan_id}__`)).map((j) => ({
    key: j.answers?.page || 'product', how: j.answers?.how || '', url: j.url, status: j.status, snapshot: j.status === 'done' ? j.snapshot : null,
  }))
  return NextResponse.json({
    status: parent.status, url: parent.url, email: parent.email, locale: parent.locale, createdAt: parent.created_at,
    answers: { revenue: parent.answers?.revenue, aov: parent.answers?.aov, cr: parent.answers?.cr }, pages,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
