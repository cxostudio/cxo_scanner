// Start the full report purchase (€89, or €69 in the first hour): GET /scan/api/checkout?url=&email=&lab=&back=<origin>
// Creates a Stripe Checkout session and sends the buyer to Stripe's payment page.
// After paying, Stripe sends them to /scan/order?session_id=…; a cancel goes back to the results.
import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { offerPrice, reportPrice, safeOrigin, stripe } from '@/lib/stripe'
import { offerFor } from '@/lib/offer'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const storeUrl = (q.get('url') || '').slice(0, 300)
  const email = (q.get('email') || '').trim().slice(0, 200)
  const lab = (q.get('lab') || '').slice(0, 80)
  // the /start answers, so the report shows the money at stake and offers a call to stores that qualify
  const answer = (k: string) => (q.get(k) || '').slice(0, 60)
  const origin = safeOrigin(q.get('back'), req.nextUrl.origin)
  const results = `${origin}/scan/results`
  try {
    // within 1 hour of the email's first free scan: the offer price, checked here, not trusted from the page
    const offer = await offerFor(email)
    const price = offer.active ? await offerPrice() : await reportPrice()
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
      metadata: { storeUrl, email, lab, product: 'full_report', offer: offer.active ? '1h' : '', revenue: answer('revenue'), aov: answer('aov'), cr: answer('cr'), locale: answer('locale') === 'fr' ? 'fr' : 'en' },
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
