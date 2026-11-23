// Stripe for the full report: one product, one price (€89, VAT included), found by its lookup key
// so the code and the Stripe account always agree. The key only lives in Vercel (STRIPE_SECRET_KEY).
import Stripe from 'stripe'

export const REPORT_LOOKUP_KEY = 'cxo_full_report_eur89'
export const REPORT_PRICE_CENTS = 8900
/** the 1-hour offer after a free scan, same product */
export const OFFER_LOOKUP_KEY = 'cxo_full_report_eur69_1h'
export const OFFER_PRICE_CENTS = 6900
/** earlier prices: their product is reused, so Stripe keeps one product for the report */
const EARLIER_KEYS = ['cxo_full_report_eur49', 'cxo_full_report_eur39_48h']

let client: Stripe | null = null
export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set')
  if (!client) client = new Stripe(key)
  return client
}

export const stripeMode = () => (/^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY || '') ? 'live' : 'test')

/** The report's price, created on first use (product + price with the lookup key). */
export async function reportPrice(): Promise<Stripe.Price> {
  const s = stripe()
  const found = await s.prices.list({ lookup_keys: [REPORT_LOOKUP_KEY], active: true, limit: 1 })
  if (found.data[0]) return found.data[0]
  const earlier = await s.prices.list({ lookup_keys: EARLIER_KEYS, limit: 1 })
  const existing = earlier.data[0]?.product
  if (existing) {
    return s.prices.create({ product: typeof existing === 'string' ? existing : existing.id, currency: 'eur', unit_amount: REPORT_PRICE_CENTS, tax_behavior: 'inclusive', lookup_key: REPORT_LOOKUP_KEY, transfer_lookup_key: true })
  }
  const product = await s.products.create({
    name: 'Full conversion report',
    description: 'Your whole store scanned, from the homepage to the checkout: every issue we find, how to fix it, with examples. Online report and PDF.',
    tax_code: 'txcd_10103001', // software as a service, business use
    metadata: { source: 'cxo-scanner' },
  })
  return s.prices.create({
    product: product.id,
    currency: 'eur',
    unit_amount: REPORT_PRICE_CENTS,
    tax_behavior: 'inclusive',
    lookup_key: REPORT_LOOKUP_KEY,
    transfer_lookup_key: true,
  })
}

/** The 1-hour offer price (€69, VAT included) on the same product, created on first use. */
export async function offerPrice(): Promise<Stripe.Price> {
  const s = stripe()
  const found = await s.prices.list({ lookup_keys: [OFFER_LOOKUP_KEY], active: true, limit: 1 })
  if (found.data[0]) return found.data[0]
  const regular = await reportPrice()
  return s.prices.create({
    product: typeof regular.product === 'string' ? regular.product : regular.product.id,
    currency: 'eur',
    unit_amount: OFFER_PRICE_CENTS,
    tax_behavior: 'inclusive',
    lookup_key: OFFER_LOOKUP_KEY,
    transfer_lookup_key: true,
    nickname: '1-hour offer after the free scan',
  })
}

/** Where Stripe may send the buyer back to: our own hosts only. */
export function safeOrigin(candidate: string | null, fallback: string): string {
  try {
    const u = new URL(candidate || '')
    if (u.protocol === 'https:' && /(^|\.)cxo\.studio$|\.vercel\.app$/.test(u.hostname)) return u.origin
  } catch {}
  return fallback
}
