'use client'

import { useEffect, useState } from 'react'

/**
 * The one next step after a scan, chosen from the revenue band the visitor gave
 * (cxo.studio/start or the scan form). Styled with the shared CXO tokens (app/tokens.css).
 *
 *  - €10k+/month (or unknown): book a CRO Audit call. This is where the paid entry offer is sold.
 *  - Under €10k/month: an audit would not pay for itself yet, so no call is pushed.
 *    Self-serve CRO checklist instead, with a quiet way out for brands planning a redesign.
 */

// Calendly event link once available; until then the existing booking form.
const CALL_URL = process.env.NEXT_PUBLIC_CALL_URL || 'https://tally.so/r/w2dP9M'
const CHECKLIST_URL = process.env.NEXT_PUBLIC_CHECKLIST_URL || 'https://cxo.studio/checklist'
const LOW_REVENUE = 'Under €10,000 / month'

const Check = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="mt-[2px] shrink-0">
    <circle cx="12" cy="12" r="11" fill="currentColor" />
    <path d="m8 12 2.5 2.5L16 9" stroke="var(--surface)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
const Arrow = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m9 18 6-6-6-6" />
  </svg>
)

export function NextStep() {
  const [revenue, setRevenue] = useState<string | null>(null)
  const [issues, setIssues] = useState<number | null>(null)

  useEffect(() => {
    try {
      setRevenue(localStorage.getItem('scanRevenue') || '')
      const raw = localStorage.getItem('scanResults')
      if (raw) {
        const list = JSON.parse(raw) as { passed?: boolean }[]
        if (Array.isArray(list) && list.length) setIssues(list.filter((r) => r && r.passed === false).length)
      }
    } catch {
      setRevenue('')
    }
  }, [])

  if (revenue === null) return null
  const small = revenue === LOW_REVENUE

  return (
    <section className="pb-[60px] pt-8 sm:pt-10" style={{ background: 'var(--bg)' }}>
      <div className="mx-auto w-full max-w-[640px] px-4">
        <div
          className="flex flex-col gap-6 p-6 sm:p-10"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-xl)',
            boxShadow: 'var(--shadow-raised), var(--shadow-card)',
          }}
        >
          <span
            className="self-start px-[11px] py-[5px] text-[13px] font-semibold"
            style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)' }}
          >
            What’s next
          </span>

          {small ? (
            <>
              <div className="flex flex-col gap-3">
                <h2 className="text-[28px] sm:text-[36px] leading-[1.2] font-bold tracking-[-0.03em]" style={{ fontFamily: 'var(--font-display)', color: 'var(--text)' }}>
                  Fix the essentials yourself first
                </h2>
                <p className="text-[16px] leading-[1.6]" style={{ color: 'var(--text-muted)' }}>
                  At your current revenue, a full audit wouldn’t pay for itself yet. Our checklist covers every page of your store with 300+ conversion checkpoints, so you can fix the biggest leaks on your own.
                </p>
              </div>
              <a href={CHECKLIST_URL} className="flex items-center justify-center gap-1 px-5 py-[15px] font-semibold text-[15px]" style={{ background: 'var(--cta-bg)', color: 'var(--cta-text)', borderRadius: 'var(--radius-md)' }}>
                Get the CRO checklist <Arrow />
              </a>
              <p className="text-center text-[14px]" style={{ color: 'var(--text-muted)' }}>
                Planning a full redesign?{' '}
                <a href={CALL_URL} className="font-semibold underline underline-offset-2" style={{ color: 'var(--text)' }}>
                  Let’s talk
                </a>
              </p>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-3">
                <h2 className="text-[28px] sm:text-[36px] leading-[1.2] font-bold tracking-[-0.03em]" style={{ fontFamily: 'var(--font-display)', color: 'var(--text)' }}>
                  Turn these findings into revenue
                </h2>
                <p className="text-[16px] leading-[1.6]" style={{ color: 'var(--text-muted)' }}>
                  {issues ? `This scan found ${issues} issue${issues > 1 ? 's' : ''} on a single product page. ` : 'This scan checked a single product page. '}
                  The CRO Audit covers your whole store, puts a euro figure on every leak, and ships the first fixes live.
                </p>
              </div>
              <ul className="flex flex-col gap-3" style={{ color: 'var(--text)' }}>
                {[
                  'Full-funnel analysis: GA4, session recordings, heatmaps',
                  'Every leak priced in euros, in a prioritised roadmap',
                  '3 quick wins designed, built and live during the audit',
                ].map((t) => (
                  <li key={t} className="flex gap-3 text-[15px] font-medium leading-[1.5]">
                    <Check />
                    {t}
                  </li>
                ))}
              </ul>
              <a href={CALL_URL} className="flex items-center justify-center gap-1 px-5 py-[15px] font-semibold text-[15px]" style={{ background: 'var(--cta-bg)', color: 'var(--cta-text)', borderRadius: 'var(--radius-md)' }}>
                Book my CRO Audit call <Arrow />
              </a>
              <p className="-mt-2 text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
                30 minutes with Louis. We go through your results and tell you honestly if an audit is worth it.
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
