import { NextRequest, NextResponse } from 'next/server'
import { checkScanLimit } from '@/lib/usage/scanLimit'

/** Puppeteer-free, but keep on Node runtime for consistency with the other scan routes. */
export const runtime = 'nodejs'

/**
 * Daily scan-limit gate. The browser calls this ONCE before starting a scan.
 * READ-ONLY: checks whether the email is under its daily limit — it does NOT
 * count the scan. The scan is counted only when it completes (see /api/scan).
 * Returns 429 when the limit is already reached.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    email?: string
  }
  const email = (body.email ?? '').trim().toLowerCase()

  if (!email) {
    return NextResponse.json({ error: 'email is required' }, { status: 400 })
  }

  const result = await checkScanLimit(email)

  if (!result.allowed) {
    return NextResponse.json(
      {
        allowed: false,
        code: 'daily_limit_reached',
        used: result.used,
        limit: result.limit,
        error: `You've reached today's limit of ${result.limit} scans. Please try again tomorrow.`,
      },
      { status: 429 },
    )
  }

  return NextResponse.json({
    allowed: true,
    used: result.used,
    limit: result.limit,
    remaining: Math.max(0, result.limit - result.used),
  })
}
