// The order page asks: was this checkout paid? GET /scan/api/checkout/session?id=cs_…
// Returns only what the buyer's own page needs (never card or address details).
import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') || ''
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) return NextResponse.json({ error: 'Unknown order' }, { status: 400 })
  try {
    const s = await stripe().checkout.sessions.retrieve(id, { expand: ['invoice'] })
    const invoice = s.invoice && typeof s.invoice === 'object' ? s.invoice : null
    return NextResponse.json({
      paid: s.payment_status === 'paid',
      status: s.status,
      email: s.customer_details?.email || s.customer_email || null,
      storeUrl: s.metadata?.storeUrl || null,
      amount: s.amount_total,
      currency: s.currency,
      tax: s.total_details?.amount_tax ?? null,
      invoiceUrl: invoice?.hosted_invoice_url || null,
      invoicePdf: invoice?.invoice_pdf || null,
    })
  } catch {
    return NextResponse.json({ error: 'Unknown order' }, { status: 404 })
  }
}
