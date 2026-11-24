import { NextRequest, NextResponse } from 'next/server'
import { runFollowups } from '@/lib/followups/run'
import { sweepStuckReports } from '@/lib/fullReport/run'
import { runCallReminders } from '@/lib/calls/bookings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/** Vercel Cron, every 5 minutes (vercel.json). ?dry=1 lists what is due without sending. */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim()
  const ok = request.headers.get('x-vercel-cron') === '1' || (!!secret && request.headers.get('authorization') === `Bearer ${secret}`)
  if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    // reports whose page died without answering: close them (they alert the team)
    const swept = request.nextUrl.searchParams.get('dry') === '1' ? [] : await sweepStuckReports().catch((e) => [`sweep failed: ${e instanceof Error ? e.message : e}`])
    const dry = request.nextUrl.searchParams.get('dry') === '1'
    const reminders = await runCallReminders({ dry }).catch((e) => [`call reminders failed: ${e instanceof Error ? e.message : e}`])
    const log = [...swept, ...reminders, ...(await runFollowups({ dry }))]
    if (log.length) console.log('[followups]', log)
    return NextResponse.json({ ok: true, log })
  } catch (e) {
    console.error('[followups] run failed', e)
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 })
  }
}
