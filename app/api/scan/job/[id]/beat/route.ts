import { NextRequest, NextResponse } from 'next/server'
import { heartbeat } from '@/lib/scanJobs/store'

export const runtime = 'nodejs'

/** The scan page is still open and scanning. */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ ok: false }, { status: 404 })
  await heartbeat(params.id).catch(() => {})
  return NextResponse.json({ ok: true })
}
