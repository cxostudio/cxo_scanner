import { NextRequest, NextResponse } from 'next/server'
import { reportEligibility } from '@/lib/fullReport/eligible'

export const runtime = 'nodejs'
export const maxDuration = 20

/** GET ?url= → { ok, reason }: can the full report check this store's cart and checkout? */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url') || ''
  if (!url) return NextResponse.json({ error: 'url is required' }, { status: 400 })
  const r = await reportEligibility(url)
  return NextResponse.json({ ok: r.ok, reason: r.reason }, { headers: { 'Cache-Control': 'private, max-age=600' } })
}
