import { NextRequest, NextResponse } from 'next/server'
import { startPaidReport } from '@/lib/fullReport/order'

export const runtime = 'nodejs'
export const maxDuration = 60

/** The thank-you page: start the report of a paid order (once per session) and return its id. POST { sessionId } */
export async function POST(request: NextRequest) {
  const { sessionId } = (await request.json().catch(() => ({}))) as { sessionId?: string }
  const r = await startPaidReport(sessionId || '')
  return 'id' in r ? NextResponse.json({ id: r.id }) : NextResponse.json({ error: r.error }, { status: r.status })
}
