import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { internalKey, locatePage } from '@/lib/fullReport/run'

export const runtime = 'nodejs'
// two page loads (desktop, mobile) and one AI call each, side by side
export const maxDuration = 300

/** Internal: the second step of a full-report page, after its scan. */
export async function POST(request: NextRequest) {
  if (request.headers.get('x-report-key') !== internalKey()) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id } = (await request.json().catch(() => ({}))) as { id?: string }
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })
  waitUntil(locatePage(id))
  return NextResponse.json({ ok: true })
}
