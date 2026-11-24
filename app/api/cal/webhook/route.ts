import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { handleCalEvent } from '@/lib/calls/bookings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Cal.com webhook (booking created, rescheduled, cancelled). Signed with CAL_WEBHOOK_SECRET, the same
 *  value set in Cal.com → Settings → Developer → Webhooks and in Vercel. Unsigned calls are refused. */
export async function POST(request: NextRequest) {
  const secret = process.env.CAL_WEBHOOK_SECRET?.trim()
  if (!secret) return NextResponse.json({ error: 'Not configured' }, { status: 503 })
  const raw = await request.text()
  const got = request.headers.get('x-cal-signature-256') || ''
  const want = createHmac('sha256', secret).update(raw).digest('hex')
  if (got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) return NextResponse.json({ error: 'Bad signature' }, { status: 401 })
  let body: { triggerEvent?: string; payload?: Record<string, unknown> }
  try { body = JSON.parse(raw) } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }
  if (body.triggerEvent === 'PING') return NextResponse.json({ ok: true, ping: true })
  try {
    const log = await handleCalEvent(String(body.triggerEvent || ''), (body.payload || {}) as Parameters<typeof handleCalEvent>[1])
    console.log('[cal]', log)
    return NextResponse.json({ ok: true, log })
  } catch (e) {
    console.error('[cal] webhook failed', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 })
  }
}
