// GET /scan/api/bypass?key=LAB_KEY : this browser skips the scan limits (lib/usage/bypass).
// ?off=1 removes it again.
import { NextRequest, NextResponse } from 'next/server'
import { BYPASS_COOKIE, bypassToken } from '@/lib/usage/bypass'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const key = process.env.LAB_KEY?.trim()
  if (!key || req.nextUrl.searchParams.get('key') !== key) return NextResponse.json({ error: 'Unknown key' }, { status: 403 })
  const off = req.nextUrl.searchParams.get('off') === '1'
  const res = new NextResponse(
    `<!doctype html><meta name="viewport" content="width=device-width"><body style="font:16px system-ui;padding:40px">${off ? 'Bypass removed from this browser.' : 'Done: scans from this browser skip the limits. Do this once per browser and device.'}</body>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  )
  // .cxo.studio covers cxo.studio/scan and audit.cxo.studio; previews (vercel.app) set it on their own host
  const host = req.headers.get('x-forwarded-host') || req.nextUrl.hostname
  const domain = /(^|\.)cxo\.studio$/.test(host) ? '.cxo.studio' : undefined
  res.cookies.set(BYPASS_COOKIE, off ? '' : bypassToken()!, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', domain, maxAge: off ? 0 : 60 * 60 * 24 * 365 })
  return res
}
