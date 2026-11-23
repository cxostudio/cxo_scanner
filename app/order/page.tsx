'use client'

// After paying for the full report: Stripe sends the buyer here with ?session_id=.
// The page checks the payment with our server (never trusts the URL alone) and says what happens next.
import { useEffect, useState } from 'react'
import { api, asset } from '@/lib/base'
import { BuildSteps, OrderCard } from '../components/ReportBuild'

type Order = { paid: boolean; status: string; email: string | null; storeUrl: string | null; amount: number | null; currency: string | null; tax: number | null; invoiceUrl: string | null; invoicePdf: string | null }

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
  // the report this order starts, and how far it is
  const [report, setReport] = useState<{ id: string; status: string; pages: { key: string; status: string; url?: string }[] } | null>(null)

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
          if (o.paid) { start(id); if (!o.invoiceUrl && !o.invoicePdf) invoiceLater(id) }
        })
        .catch(() => setError('network'))
    // the invoice is finalised a few seconds after the payment: ask again until it is there (about a minute)
    const invoiceLater = (sessionId: string, n = 0) => {
      if (n > 12) return
      setTimeout(() => fetch(api(`/checkout/session?id=${encodeURIComponent(sessionId)}`)).then((r) => r.json()).then((o: Order) => {
        if (o.invoiceUrl || o.invoicePdf) setOrder(o)
        else invoiceLater(sessionId, n + 1)
      }).catch(() => invoiceLater(sessionId, n + 1)), 5000)
    }
    // paid: start the report (once per order, however often this page loads), then follow it
    const start = async (sessionId: string) => {
      const r = await fetch(api('/report/order'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) }).catch(() => null)
      const d = r && r.ok ? ((await r.json()) as { id?: string }) : null
      if (!d?.id) return
      const follow = async () => {
        const x = await fetch(api(`/report/${d.id}`), { cache: 'no-store' }).then((y) => y.json()).catch(() => null)
        if (!x) return void setTimeout(follow, 5000)
        setReport({ id: d.id!, status: x.status, pages: (x.pages || []).map((p: { key: string; status: string; url?: string }) => ({ key: p.key, status: p.status, url: p.url })) })
        if (x.status !== 'done' && x.status !== 'failed') setTimeout(follow, 5000)
      }
      follow()
    }
    ask()
  }, [])
  const reportUrl = report ? `/scan/report?id=${report.id}` : null

  return (
    <main className="min-h-dvh bg-[var(--bg)]">
      <div className="mx-auto flex max-w-[640px] flex-col gap-6 px-[var(--gutter)] pb-16 pt-[34px] max-[560px]:pb-10">
        <a className="cxo-logo !mb-4" href="https://cxo.studio" aria-label="CXO studio"><img src={asset('/cxo-logo.png')} alt="CXO studio" /></a>
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
              <h1 className="font-[family-name:var(--font-display)] text-[length:var(--text-3xl)] font-bold leading-[1.15] tracking-[-0.02em] text-[var(--text)]">{report?.status === 'done' ? 'Thank you, your full report is ready' : 'Thank you, we are building your report'}</h1>
              <p className="text-[16px] leading-[1.6] text-[var(--text-muted)]">
                We are scanning {order.storeUrl ? <b className="text-[var(--text)]">{host(order.storeUrl)}</b> : 'your store'} from the homepage to the checkout, on desktop and mobile. It takes a few minutes. You can stay here, or close this page: the link also comes by email{order.email ? <> to <b className="text-[var(--text)]">{order.email}</b></> : ''}.
              </p>
            </div>

            <section className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--card-padding)]">
              <h2 className="text-sm font-semibold text-[var(--text)]">Your report</h2>
              <BuildSteps pages={report?.pages || []} done={report?.status === 'done'} />
              {report?.status === 'done' && reportUrl ? (
                <a href={reportUrl} className="cxo-btn cxo-btn-primary mt-2 self-start">Open your report</a>
              ) : report?.status === 'failed' ? (
                <p className="text-[14px] text-[var(--text-muted)]">Something stopped our scan. We have been notified and will email you.</p>
              ) : reportUrl ? (
                <a href={reportUrl} className="mt-1 self-start text-sm font-semibold text-[var(--text)] underline">Follow it on the report page</a>
              ) : null}
            </section>

            <OrderCard order={order} />

          </>
        )}
      </div>
    </main>
  )
}
