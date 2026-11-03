'use client'

import { useEffect, useState } from 'react'

/**
 * "What's next" after a scan: a three-step path, so the visitor sees the scan as step one of
 * a process rather than an end point.
 *   1. Today: this product page scan (done)
 *   2. Next: the full-store CRO checklist (self-serve, 300+ checkpoints)
 *   3. Then: the CRO Audit and continuous optimisation (call)
 * The primary button follows the revenue band from cxo.studio/start:
 *   - €10k+/month (or unknown): the call is the primary action
 *   - under €10k/month: an audit would not pay for itself yet, so the checklist leads
 */

// Calendly event link once available; until then the existing booking form.
const CALL_URL = process.env.NEXT_PUBLIC_CALL_URL || 'https://tally.so/r/w2dP9M'
const CHECKLIST_URL = process.env.NEXT_PUBLIC_CHECKLIST_URL || 'https://cxo.studio/checklist'
const LOW_REVENUE = 'Under €10,000 / month'

const Arrow = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m9 18 6-6-6-6" />
  </svg>
)
const Tick = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-[3px] shrink-0">
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
)

function Node({ state }: { state: 'done' | 'next' }) {
  if (state === 'done')
    return (
      <span className="relative z-[1] grid h-7 w-7 place-items-center rounded-full" style={{ background: 'var(--result-pass-fg)', color: 'var(--text-inverse)' }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
      </span>
    )
  return (
    <span className="relative z-[1] grid h-7 w-7 place-items-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text)]">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 10V7.5a5 5 0 0 1 10 0V10h.5A1.5 1.5 0 0 1 19 11.5v8a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-8A1.5 1.5 0 0 1 6.5 10H7zm2 0h6V7.5a3 3 0 0 0-6 0V10z" /></svg>
    </span>
  )
}

function Step({ state, title, last, children }: { state: 'done' | 'next'; title: string; last?: boolean; children: React.ReactNode }) {
  return (
    <li className="relative grid grid-cols-[28px_minmax(0,1fr)] gap-x-4">
      {!last && (
        <span
          aria-hidden="true"
          className="absolute left-[13px] top-7 bottom-0 w-[2px]"
          style={{ background: state === 'done' ? 'var(--text)' : 'var(--surface-muted)' }}
        />
      )}
      <Node state={state} />
      <div className={`min-w-0 ${last ? '' : 'pb-8'}`}>
        <p className="font-[family-name:var(--font-display)] text-[17px] font-bold leading-7 tracking-[-0.01em] text-[var(--text)]">{title}</p>
        <div className="mt-1 flex flex-col gap-3 text-[15px] leading-[1.6] text-[var(--text-muted)]">{children}</div>
      </div>
    </li>
  )
}

const List = ({ items }: { items: string[] }) => (
  <ul className="flex flex-col gap-1.5">
    {items.map((t) => (
      <li key={t} className="flex gap-2 font-semibold text-[var(--text)]">
        <Tick />
        {t}
      </li>
    ))}
  </ul>
)

export function NextStep() {
  const [revenue, setRevenue] = useState<string | null>(null)
  const [checked, setChecked] = useState<number | null>(null)

  useEffect(() => {
    try {
      setRevenue(localStorage.getItem('scanRevenue') || '')
      const raw = localStorage.getItem('scanResults')
      if (raw) {
        const list = JSON.parse(raw) as unknown[]
        if (Array.isArray(list) && list.length) setChecked(list.length)
      }
    } catch {
      setRevenue('')
    }
  }, [])

  if (revenue === null) return null
  const small = revenue === LOW_REVENUE

  return (
    <section className="cxo-card" aria-label="What's next">
      <span className="inline-block rounded-[var(--radius-sm)] border border-[var(--border)] px-[11px] py-[5px] text-[13px] font-semibold text-[var(--text)]">
        What’s next?
      </span>
      <h2 className="mb-8 mt-4 font-[family-name:var(--font-display)] text-[26px] font-bold leading-[1.2] tracking-[-0.03em] text-[var(--text)] sm:text-[32px]">
        You’ve started. Here’s what comes next
      </h2>

      <ol className="flex flex-col">
        <Step state="done" title="Today: your product page scan">
          <p>
            You checked your product page against <strong className="text-[var(--text)]">{checked ?? 'our'} conversion checkpoints</strong>.
          </p>
        </Step>

        <Step state="next" title="Next: the full-store CRO checklist">
          <p>300+ conversion checkpoints for your entire store:</p>
          <List items={['Homepage', 'Collection page', 'Product page', 'Cart', 'Checkout', 'Thank you page']} />
          <p>The same checklist we use on client projects.</p>
          <a href={CHECKLIST_URL} className={`cxo-btn ${small ? 'cxo-btn-primary' : 'cxo-btn-ghost'} self-start`}>
            Get the full checklist <Arrow />
          </a>
        </Step>

        <Step state="next" title="Then: CRO Audit and continuous optimisation" last>
          <p>For brands ready to invest, with strategy and execution:</p>
          <List
            items={[
              'Full-funnel CRO Audit, every leak priced in euros',
              'A/B testing of offers, UX and design',
              'Implementation by our in-house developers',
              'Weekly reports and a strategy call',
            ]}
          />
          <a href={CALL_URL} className={`cxo-btn ${small ? 'cxo-btn-ghost' : 'cxo-btn-primary'} self-start`}>
            {small ? 'Planning a redesign? Let’s talk' : 'Book my CRO Audit call'} <Arrow />
          </a>
          {!small && <p className="text-[13px]">30 minutes with Louis. We go through your results and tell you honestly if an audit is worth it.</p>}
        </Step>
      </ol>
    </section>
  )
}
