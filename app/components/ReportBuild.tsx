'use client'

// While a full report is being built: one line per tab of the report, and the order with its invoice.
// Shared by the thank-you page (app/order) and the report's loading screen (app/report).
import { Pass } from './PinnedPage'

export type BuildPage = { key: string; status: string; url?: string }
export type OrderInfo = { amount: number | null; currency: string | null; tax: number | null; invoiceUrl: string | null; invoicePdf: string | null; storeUrl?: string | null }

// the report's tabs; cart, checkout and store-wide checks come from the best seller's scan
const STEPS: { label: string; page: 'homepage' | 'category' | 'product'; hint?: string; path?: boolean }[] = [
  { label: 'Homepage', page: 'homepage', path: true },
  { label: 'Collection page', page: 'category', path: true },
  { label: 'Product page', page: 'product', path: true },
  { label: 'Cart', page: 'product', hint: 'with your best seller in it' },
  { label: 'Checkout', page: 'product', hint: 'first step, nothing typed' },
  { label: 'General elements', page: 'product', hint: 'header, menu, footer, speed' },
]

const pathOf = (u?: string) => { try { return u ? new URL(u).pathname.replace(/\/$/, '') || '/' : '' } catch { return '' } }

export function BuildSteps({ pages, done }: { pages: BuildPage[]; done?: boolean }) {
  return (
    <ul className="flex flex-col divide-y divide-[var(--border)]">
      {STEPS.map((s) => {
        const p = pages.find((x) => x.key === s.page)
        const st = done || p?.status === 'done' ? 'done' : p?.status === 'failed' ? 'failed' : p?.status === 'server' ? 'pinning' : 'scanning'
        const note = st === 'done' ? '' : st === 'failed' ? "Couldn't finish" : st === 'pinning' ? 'Pinning the findings…' : p ? 'Scanning…' : 'Finding the page…'
        const detail = s.path ? pathOf(p?.url) : s.hint
        return (
          <li key={s.label} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
            {st === 'done' ? <Pass /> : st === 'failed' ? (
              <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full border-2 border-dashed border-[var(--border-strong)] text-[12px] font-bold text-[var(--text-muted)]">!</span>
            ) : (
              <span className="grid h-[26px] w-[26px] shrink-0 place-items-center"><span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--text-muted)] border-t-transparent" /></span>
            )}
            <span className="min-w-0 flex-1">
              <span className={`block text-[15px] font-semibold ${st === 'done' ? 'text-[var(--text)]' : 'text-[var(--text)]'}`}>{s.label}</span>
              {detail && <span className="block truncate text-[13px] text-[var(--text-muted)]">{detail}</span>}
            </span>
            {note && <span className="shrink-0 text-[13px] text-[var(--text-muted)] max-[560px]:hidden">{note}</span>}
          </li>
        )
      })}
    </ul>
  )
}

const money = (cents: number | null, cur: string | null) => (cents == null ? '' : new Intl.NumberFormat('en-IE', { style: 'currency', currency: (cur || 'eur').toUpperCase() }).format(cents / 100))
const host = (u?: string | null) => { if (!u) return ''; try { return new URL(/^https?:\/\//.test(u) ? u : `https://${u}`).host.replace(/^www\./, '') } catch { return u } }

export function OrderCard({ order }: { order: OrderInfo }) {
  const invoice = order.invoicePdf || order.invoiceUrl
  return (
    <section className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--card-padding)]">
      <h2 className="text-sm font-semibold text-[var(--text)]">Your order</h2>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
        <dt className="text-[var(--text-muted)]">Full conversion report{order.storeUrl ? `, ${host(order.storeUrl)}` : ''}</dt>
        <dd className="text-right font-semibold text-[var(--text)]">{money(order.amount, order.currency)}</dd>
        {order.tax ? (<><dt className="text-[var(--text-muted)]">Of which VAT</dt><dd className="text-right text-[var(--text-muted)]">{money(order.tax, order.currency)}</dd></>) : null}
      </dl>
      {invoice ? (
        <a href={invoice} target="_blank" rel="noreferrer" className="self-start text-sm font-semibold text-[var(--text)] underline">Download your invoice</a>
      ) : (
        <p className="text-[13px] text-[var(--text-muted)]">Your invoice is being prepared. It also comes by email with your receipt.</p>
      )}
    </section>
  )
}
