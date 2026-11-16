// Start the €49 full report purchase: GET /scan/api/checkout?url=&email=&lab=&back=<origin>
// Creates a Stripe Checkout session and sends the buyer to Stripe's payment page.
// After paying, Stripe sends them to /scan/order?session_id=…; a cancel goes back to the results.
import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { reportPrice, safeOrigin, stripe } from '@/lib/stripe'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const storeUrl = (q.get('url') || '').slice(0, 300)
  const email = (q.get('email') || '').trim().slice(0, 200)
  const lab = (q.get('lab') || '').slice(0, 80)
  const origin = safeOrigin(q.get('back'), req.nextUrl.origin)
  const results = `${origin}/scan/results`
  try {
    const price = await reportPrice()
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: 'payment',
      line_items: [{ price: price.id, quantity: 1 }],
      ...(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? { customer_email: email } : {}),
      customer_creation: 'always',
      billing_address_collection: 'required',
      tax_id_collection: { enabled: true }, // business buyers enter their VAT number: reverse charge
      invoice_creation: {
        enabled: true,
        invoice_data: { description: storeUrl ? `Full conversion report for ${storeUrl}` : 'Full conversion report', metadata: { storeUrl } },
      },
      allow_promotion_codes: true,
      automatic_tax: { enabled: true },
      metadata: { storeUrl, email, lab, product: 'full_report' },
      payment_intent_data: { description: storeUrl ? `Full conversion report: ${storeUrl}` : 'Full conversion report', metadata: { storeUrl } },
      success_url: `${origin}/scan/order?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: results,
      locale: 'auto',
    }
    let session: Stripe.Checkout.Session
    try {
      session = await stripe().checkout.sessions.create(params)
    } catch (e) {
      // Stripe Tax not set up yet (no origin address or registration): sell without automatic tax
      // rather than block the sale, and say so in the logs
      if (!/tax/i.test(String((e as Error).message))) throw e
      console.warn('[checkout] automatic tax unavailable, continuing without it:', (e as Error).message)
      session = await stripe().checkout.sessions.create({ ...params, automatic_tax: { enabled: false } })
    }
    return NextResponse.redirect(session.url!, 303)
  } catch (e) {
    console.error('[checkout]', e)
    return NextResponse.redirect(`${results}?checkout=error`, 303)
  }
}
