import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import { startPaidReport } from '@/lib/fullReport/order'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Stripe → a paid order starts its report even if the buyer never reaches the thank-you page.
 * Endpoint in Stripe (sandbox and live, each with its own signing secret):
 *   https://audit.cxo.studio/scan/api/stripe/webhook
 *   events: checkout.session.completed, checkout.session.async_payment_succeeded
 * Signing secret in Vercel: STRIPE_WEBHOOK_SECRET.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 })
  const body = await request.text()
  let event: Stripe.Event
  try {
    event = stripe().webhooks.constructEvent(body, request.headers.get('stripe-signature') || '', secret)
  } catch {
    return NextResponse.json({ error: 'Bad signature' }, { status: 400 })
  }
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const s = event.data.object as Stripe.Checkout.Session
    // completed but not yet paid (bank transfer, some local methods): async_payment_succeeded comes later
    if (s.payment_status === 'paid' && s.metadata?.product === 'full_report') {
      const r = await startPaidReport(s)
      if (!('id' in r)) console.error('[stripe webhook] report not started', s.id, r.error)
    }
  }
  return NextResponse.json({ received: true })
}
