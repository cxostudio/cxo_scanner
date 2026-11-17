'use client'

import { LEVERS, lever, type ScanResult } from '@/lib/report'

/**
 * Free scan gate: the findings that are not in the free 40 stay locked. Each one shows its area
 * and impact, never its title or fix (the row text is a placeholder, not the real finding).
 * Two ways in, both always visible:
 *   - buy the full report (self-serve; first for stores under the revenue threshold)
 *   - book a call (first for qualified stores)
 */

const Lock = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M7 10V7.5a5 5 0 0 1 10 0V10h.5A1.5 1.5 0 0 1 19 11.5v8a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-8A1.5 1.5 0 0 1 6.5 10H7zm2 0h6V7.5a3 3 0 0 0-6 0V10z" />
  </svg>
)
const Arrow = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m9 18 6-6-6-6" />
  </svg>
)

// placeholder line lengths, so the blurred rows look like real findings of different lengths
const WIDTHS = ['78%', '62%', '86%', '55%', '70%']
const SHOWN = 5

export function LockedFindings({
  locked,
  qualified,
  monthlyAtStake,
  shortEur,
  buyUrl,
  callUrl,
  price,
}: {
  locked: ScanResult[]
  qualified: boolean
  /** about what a 10% lift is worth a month, from the onboarding answers */
  monthlyAtStake: number | null
  shortEur: (n: number) => string
  buyUrl: string
  callUrl: string
  /** shown under the buy button when set (e.g. "€49, one-off") */
  price?: string
}) {
  if (!locked.length) return null
  const high = locked.filter((r) => r.checkpoint?.priority === 'High').length
  const label = (r: ScanResult) => LEVERS.find((l) => l.id === lever(r))?.short || 'Conversion'
  const buy = (
    <a key="buy" href={buyUrl} className={`cxo-btn ${qualified ? 'cxo-btn-ghost' : 'cxo-btn-primary'}`}>
      Unlock the full report <Arrow />
    </a>
  )
  const call = (
    <a key="call" href={callUrl} className={`cxo-btn ${qualified ? 'cxo-btn-primary' : 'cxo-btn-ghost'}`}>
      Book a call <Arrow />
    </a>
  )

  return (
    <section className="mt-6 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]" aria-label="Locked findings">
      <div className="flex flex-col gap-2 p-[var(--card-padding)] pb-4">
        <p className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-muted)]">
          <Lock /> In the full report
        </p>
        <h3 className="font-[family-name:var(--font-display)] text-[length:var(--text-xl)] font-bold leading-[1.25] tracking-[-0.02em] text-[var(--text)]">
          {locked.length} more {locked.length === 1 ? 'issue' : 'issues'} found on this page
          {high > 0 ? `, ${high} with high impact` : ''}
        </h3>
        {monthlyAtStake ? (
          <p className="text-[15px] leading-[1.6] text-[var(--text-muted)]">
            They are part of the <strong className="text-[var(--text)]">{shortEur(monthlyAtStake)} a month</strong> your page leaves on the table. The full report shows each issue, where it is and how to fix it.
          </p>
        ) : (
          <p className="text-[15px] leading-[1.6] text-[var(--text-muted)]">The full report shows each issue, where it is and how to fix it.</p>
        )}
      </div>

      {/* the locked rows: real area and impact, placeholder text */}
      <ul className="relative flex flex-col border-t border-[var(--border)]" aria-hidden="true">
        {locked.slice(0, SHOWN).map((r, i) => (
          <li key={r.ruleId} className="flex items-center gap-3 border-b border-[var(--border)] px-[var(--card-padding)] py-3 last:border-b-0">
            <span className="shrink-0 rounded-full bg-[var(--result-fail-bg)] px-2 py-0.5 text-[12px] font-semibold text-[var(--result-fail-fg)]">{label(r)}</span>
            <span className="h-3 min-w-0 rounded-full bg-[var(--surface-muted)] blur-[2px]" style={{ width: WIDTHS[i % WIDTHS.length] }} />
            {r.checkpoint?.priority === 'High' && (
              <span className="ml-auto shrink-0 text-[12px] font-semibold text-[var(--text-muted)] max-[560px]:hidden">High impact</span>
            )}
          </li>
        ))}
        {locked.length > SHOWN && (
          <li className="px-[var(--card-padding)] py-3 text-[13px] font-semibold text-[var(--text-muted)]">+ {locked.length - SHOWN} more</li>
        )}
      </ul>

      <div className="flex flex-col gap-4 border-t border-[var(--border)] bg-[var(--surface-muted)] p-[var(--card-padding)]">
        <div className="flex flex-wrap items-center gap-3">{qualified ? [call, buy] : [buy, call]}</div>
        <p className="text-[13px] leading-[1.6] text-[var(--text-muted)]">
          {price ? <><strong className="text-[var(--text)]">Full report: {price}.</strong> </> : null}
          {qualified
            ? 'On a call we go through your results and tell you honestly if working together is worth it.'
            : 'Fix them yourself with the full report, or book a call if you want a hand.'}
        </p>
      </div>
    </section>
  )
}
