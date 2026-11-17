'use client'

// After paying for the full report: Stripe sends the buyer here with ?session_id=.
// The page checks the payment with our server (never trusts the URL alone) and says what happens next.
import { useEffect, useState } from 'react'
import { api } from '@/lib/base'

type Order = { paid: boolean; status: string; email: string | null; storeUrl: string | null; amount: number | null; currency: string | null; tax: number | null; invoiceUrl: string | null; invoicePdf: string | null }

const CALL_URL = process.env.NEXT_PUBLIC_CALL_URL || 'https://tally.so/r/w2dP9M'
const money = (cents: number | null, cur: string | null) => (cents == null ? '' : new Intl.NumberFormat('en-IE', { style: 'currency', currency: (cur || 'eur').toUpperCase() }).format(cents / 100))
const host = (u: string | null) => {
  if (!u) return ''
  try {
    return new URL(/^https?:\/\//.test(u) ? u : `https://${u}`).host.replace(/^www\./, '')
  } catch {
    return u
  }
}

const Check = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
)

export default function OrderPage() {
  const [order, setOrder] = useState<Order | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('session_id') || ''
    if (!id) {
      setError('missing')
      return
    }
    // a card can take a few seconds to confirm: ask again a few times before giving up
    let tries = 0
    const ask = () =>
      fetch(api(`/checkout/session?id=${encodeURIComponent(id)}`))
        .then((r) => r.json())
        .then((o: Order & { error?: string }) => {
          if (o.error) return setError(o.error)
          if (!o.paid && tries++ < 5) return void setTimeout(ask, 2000)
          setOrder(o)
        })
        .catch(() => setError('network'))
    ask()
  }, [])

  return (
    <main className="min-h-dvh bg-[var(--bg)]">
      <div className="mx-auto flex max-w-[640px] flex-col gap-6 px-[var(--gutter)] py-16 max-[560px]:py-10">
        {!order && !error && <p className="text-[var(--text-muted)]">Checking your payment…</p>}

        {error && (
          <div className="flex flex-col gap-3">
            <h1 className="font-[family-name:var(--font-display)] text-[length:var(--text-2xl)] font-bold text-[var(--text)]">We could not find this order</h1>
            <p className="text-[15px] leading-[1.6] text-[var(--text-muted)]">If you paid, your receipt is in your inbox and we have your order. Reply to that email and we will sort it out.</p>
          </div>
        )}

        {order && !order.paid && (
          <div className="flex flex-col gap-3">
            <h1 className="font-[family-name:var(--font-display)] text-[length:var(--text-2xl)] font-bold text-[var(--text)]">Your payment is still processing</h1>
            <p className="text-[15px] leading-[1.6] text-[var(--text-muted)]">Some payment methods take a little longer. As soon as it is confirmed, you get a receipt by email and we start on your report.</p>
          </div>
        )}

        {order?.paid && (
          <>
            <div className="flex flex-col gap-4">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-[var(--result-pass-bg)] text-[var(--result-pass-fg)]">
                <Check />
              </span>
              <h1 className="font-[family-name:var(--font-display)] text-[length:var(--text-3xl)] font-bold leading-[1.15] tracking-[-0.02em] text-[var(--text)]">Thank you, your full report is on its way</h1>
              <p className="text-[16px] leading-[1.6] text-[var(--text-muted)]">
                We are scanning {order.storeUrl ? <b className="text-[var(--text)]">{host(order.storeUrl)}</b> : 'your store'} from the homepage to the checkout. You will get the report by email{order.email ? <> at <b className="text-[var(--text)]">{order.email}</b></> : ''} within 24 hours: every issue we find, how to fix it, with examples, online and as a PDF.
              </p>
            </div>

            <section className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--card-padding)]">
              <h2 className="text-sm font-semibold text-[var(--text)]">Your order</h2>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
                <dt className="text-[var(--text-muted)]">Full conversion report{order.storeUrl ? `, ${host(order.storeUrl)}` : ''}</dt>
                <dd className="text-right font-semibold text-[var(--text)]">{money(order.amount, order.currency)}</dd>
                {order.tax ? (
                  <>
                    <dt className="text-[var(--text-muted)]">Of which VAT</dt>
                    <dd className="text-right text-[var(--text-muted)]">{money(order.tax, order.currency)}</dd>
                  </>
                ) : null}
              </dl>
              {(order.invoicePdf || order.invoiceUrl) && (
                <a href={order.invoicePdf || order.invoiceUrl || '#'} target="_blank" rel="noreferrer" className="self-start text-sm font-semibold text-[var(--text)] underline">
                  Download your invoice
                </a>
              )}
            </section>

            <section className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-muted)] p-[var(--card-padding)]">
              <h2 className="font-[family-name:var(--font-display)] text-[length:var(--text-lg)] font-bold text-[var(--text)]">Want us to go through it with you?</h2>
              <p className="text-[15px] leading-[1.6] text-[var(--text-muted)]">On a 30-minute call we walk through your report, tell you what to fix first, and whether working together would pay off.</p>
              <a href={CALL_URL} className="cxo-btn cxo-btn-ghost self-start">
                Book a call
              </a>
            </section>
          </>
        )}
      </div>
    </main>
  )
}
