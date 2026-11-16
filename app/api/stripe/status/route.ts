// Is Stripe connected? Never returns the key: only the mode and the account's country and name.
import { NextResponse } from 'next/server'
import Stripe from 'stripe'

export const dynamic = 'force-dynamic'

export async function GET() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return NextResponse.json({ configured: false })
  try {
    const stripe = new Stripe(key)
    const acct = await stripe.accounts.retrieve()
    return NextResponse.json({
      configured: true,
      mode: key.startsWith('sk_live_') || key.startsWith('rk_live_') ? 'live' : 'test',
      country: acct.country,
      name: acct.settings?.dashboard?.display_name || acct.business_profile?.name || null,
      chargesEnabled: acct.charges_enabled,
      webhookSecret: !!process.env.STRIPE_WEBHOOK_SECRET,
    })
  } catch (e) {
    return NextResponse.json({ configured: true, error: String((e as Error).message).slice(0, 200) }, { status: 502 })
  }
}
