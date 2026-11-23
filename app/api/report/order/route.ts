import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { stripe } from '@/lib/stripe'
import { claimStart } from '@/lib/scanJobs/store'
import { kickoff, startReport } from '@/lib/fullReport/run'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * A paid order becomes a report: POST { sessionId } from the order page (and later the Stripe webhook).
 * Stripe is asked whether the session is paid; one session = one report, whoever calls first starts it.
 */
export async function POST(request: NextRequest) {
  const { sessionId } = (await request.json().catch(() => ({}))) as { sessionId?: string }
  if (!sessionId || !/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) return NextResponse.json({ error: 'Unknown order' }, { status: 400 })
  let s
  try { s = await stripe().checkout.sessions.retrieve(sessionId) } catch { return NextResponse.json({ error: 'Unknown order' }, { status: 404 }) }
  if (s.payment_status !== 'paid' || s.metadata?.product !== 'full_report') return NextResponse.json({ error: 'Not paid' }, { status: 402 })
  const m = s.metadata || {}
  const email = (s.customer_details?.email || s.customer_email || m.email || '').toLowerCase()
  const url = m.storeUrl || ''
  if (!email || !url) return NextResponse.json({ error: 'Order without a store or email' }, { status: 422 })
  const job = await startReport({
    orderId: sessionId, email, url, locale: m.locale || 'en',
    answers: { revenue: m.revenue || undefined, aov: m.aov || undefined, cr: m.cr || undefined },
    origin: 'https://cxo.studio',
  })
  if (await claimStart(job.id)) waitUntil(kickoff(job))
  return NextResponse.json({ id: job.id })
}
