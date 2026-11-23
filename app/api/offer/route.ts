// GET /scan/api/offer?email= → the 1-hour offer for this email (price and end time).
import { NextRequest, NextResponse } from 'next/server'
import { offerFor } from '@/lib/offer'
import { lastOfferLookupError } from '@/lib/leads/store'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const offer = await offerFor((req.nextUrl.searchParams.get('email') || '').slice(0, 200))
  const debug = req.nextUrl.searchParams.get('debug') === '1' ? { lookup: lastOfferLookupError } : {}
  return NextResponse.json({ ...offer, ...debug }, { headers: { 'Cache-Control': 'no-store' } })
}
