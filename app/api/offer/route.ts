// GET /scan/api/offer?email= → the 48-hour offer for this email (price and end time).
import { NextRequest, NextResponse } from 'next/server'
import { offerFor } from '@/lib/offer'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const offer = await offerFor((req.nextUrl.searchParams.get('email') || '').slice(0, 200))
  return NextResponse.json(offer, { headers: { 'Cache-Control': 'no-store' } })
}
