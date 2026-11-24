// POST /api/scan/start { url, locale, origin }: the URL step of cxo.studio/start. Creates a background
// scan job (no email yet) and starts the page capture (lib/scanJobs/background). Limits here: per
// visitor (IP) and per store; the per-email limit comes at the email step. Louis's browsers (bypass
// cookie) skip them. Any refusal or error: /start carries on with the classic scan, nobody is blocked.
import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { captureInBackground, startBackgroundScan } from '@/lib/scanJobs/background'
import { countRecentBackground } from '@/lib/scanJobs/store'
import { checkDomainLimit, domainLimitMessage } from '@/lib/usage/domainLimit'
import { isBypass } from '@/lib/usage/bypass'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// the capture runs after the answer (waitUntil): product page lookup + capture call
export const maxDuration = 300

const PER_VISITOR_HOUR = Math.max(1, parseInt(process.env.BG_SCANS_PER_IP_HOUR || '', 10) || 6)

export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => ({}))) as { url?: string; locale?: string; origin?: string }
  let url: string
  try {
    const u = new URL(/^https?:\/\//i.test(b.url || '') ? b.url! : `https://${b.url || ''}`)
    if (!u.hostname.includes('.')) throw new Error('host')
    url = u.toString()
  } catch {
    return NextResponse.json({ error: 'Enter a valid URL', code: 'invalid_url' }, { status: 400 })
  }
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown'
  if (!isBypass(req)) {
    const recent = await countRecentBackground({ ip, sinceMs: 3600_000 }).catch(() => 0)
    if (recent >= PER_VISITOR_HOUR) return NextResponse.json({ error: 'Too many scans started from here. Please try again in an hour.', code: 'visitor_limit' }, { status: 429 })
    // per store: only scans that got an email count (lib/usage/domainLimit)
    const store = await checkDomainLimit('visitor@cxo.invalid', url)
    if (!store.allowed) return NextResponse.json({ error: domainLimitMessage(store.host), code: 'store_limit_reached' }, { status: 429 })
  }
  try {
    const job = await startBackgroundScan({ url, locale: b.locale === 'fr' ? 'fr' : 'en', origin: typeof b.origin === 'string' ? b.origin.slice(0, 200) : null, ip })
    waitUntil(captureInBackground(job))
    return NextResponse.json({ id: job.id })
  } catch (e) {
    console.error('[scan-start] failed', e)
    return NextResponse.json({ error: 'not started', code: 'not_started' }, { status: 503 })
  }
}
