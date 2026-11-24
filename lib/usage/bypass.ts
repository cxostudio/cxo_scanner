// Louis's own browsers skip the scan limits, from any network (NL, BE, mobile data): no IP list to
// keep up to date. Opening /scan/api/bypass?key=LAB_KEY once per browser sets a signed cookie on
// cxo.studio. The cookie holds an HMAC of LAB_KEY, never the key itself; changing LAB_KEY revokes it.
import { createHmac, timingSafeEqual } from 'crypto'
import type { NextRequest } from 'next/server'

export const BYPASS_COOKIE = 'cxo_bypass'

export function bypassToken(): string | null {
  const key = process.env.LAB_KEY?.trim()
  return key ? createHmac('sha256', key).update('scan-limit-bypass').digest('hex') : null
}

/** CXO studio's own addresses (QA, the lab) never hit the scan limits. */
export function isInternalEmail(email: string | null | undefined): boolean {
  return /@cxo\.studio$/i.test((email || '').trim())
}

export function isBypass(req: NextRequest): boolean {
  const expected = bypassToken()
  const got = req.cookies.get(BYPASS_COOKIE)?.value || ''
  if (!expected || got.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(got), Buffer.from(expected))
}
