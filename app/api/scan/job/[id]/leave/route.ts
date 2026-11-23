import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { sleep, takeOver } from '@/lib/scanJobs/takeover'

export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * The scan page was hidden or closed (sendBeacon). Give the visitor 20 seconds to come back
 * (their heartbeat would resume); if they don't, the server finishes the scan.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ ok: false }, { status: 404 })
  waitUntil((async () => { await sleep(20_000); await takeOver(params.id, 15) })())
  return NextResponse.json({ ok: true }, { status: 202 })
}
