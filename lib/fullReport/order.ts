// A paid Stripe order becomes a full report. Called by the thank-you page (/api/report/order) and by
// the Stripe webhook (/api/stripe/webhook): whoever comes first starts it, the other gets the same report.
import { waitUntil } from '@vercel/functions'
import type Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import { claimStart } from '@/lib/scanJobs/store'
import { kickoff, startReport } from './run'

export type OrderStart = { id: string } | { error: string; status: number }

export async function startPaidReport(sessionOrId: string | Stripe.Checkout.Session): Promise<OrderStart> {
  let s: Stripe.Checkout.Session
  if (typeof sessionOrId === 'string') {
    if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionOrId)) return { error: 'Unknown order', status: 400 }
    try { s = await stripe().checkout.sessions.retrieve(sessionOrId) } catch { return { error: 'Unknown order', status: 404 } }
  } else s = sessionOrId
  if (s.payment_status !== 'paid' || s.metadata?.product !== 'full_report') return { error: 'Not paid', status: 402 }
  const m = s.metadata || {}
  const email = (s.customer_details?.email || s.customer_email || m.email || '').toLowerCase()
  const url = m.storeUrl || ''
  if (!email || !url) return { error: 'Order without a store or email', status: 422 }
  const job = await startReport({
    orderId: s.id, email, url, locale: m.locale || 'en',
    answers: { revenue: m.revenue || undefined, aov: m.aov || undefined, cr: m.cr || undefined },
    origin: 'https://cxo.studio',
  })
  if (await claimStart(job.id)) waitUntil(kickoff(job))
  return { id: job.id }
}
