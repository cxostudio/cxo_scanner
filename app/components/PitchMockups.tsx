'use client'

/**
 * Pitch mockups for the free scan (results page, ?gate=b or ?gate=cd). Not the default yet.
 *  B  : the locked findings sit in the list where they rank by impact, title hidden.
 *  CD : every finding on the page is visible (title and what we saw); the fix of a locked one
 *       is in the full report, and the full report is sold as the rest of the store.
 */
import { LEVERS, lever, type ScanResult } from '@/lib/report'

const LockIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M7 10V7.5a5 5 0 0 1 10 0V10h.5A1.5 1.5 0 0 1 19 11.5v8a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-8A1.5 1.5 0 0 1 6.5 10H7zm2 0h6V7.5a3 3 0 0 0-6 0V10z" />
  </svg>
)
const Arrow = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m9 18 6-6-6-6" />
  </svg>
)
const Check = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
)

const leverLabel = (r: ScanResult) => LEVERS.find((l) => l.id === lever(r))?.short || 'Conversion'

/** The lock badge in place of the finding number. */
function LockBadge() {
  return (
    <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full bg-[var(--surface-muted)] text-[var(--text-muted)]" role="img" aria-label="In the full report">
      <LockIcon size={12} />
    </span>
  )
}

export function LockedRow({ r, variant, open, onToggle, buyUrl, price }: { r: ScanResult; variant: 'b' | 'cd'; open: boolean; onToggle: () => void; buyUrl: string; price: string }) {
  const high = r.checkpoint?.priority === 'High'
  return (
    <div className={`rounded-[16px] border px-4 transition-colors ${open ? 'border-[var(--border-strong)] bg-[var(--bg-subtle)]' : 'border-dashed border-[var(--border-strong)] bg-[var(--surface)] hover:bg-[var(--bg-subtle)]'}`}>
      <button type="button" className="flex w-full items-center gap-3 py-4 text-left" onClick={onToggle} aria-expanded={open}>
        <LockBadge />
        {variant === 'b' ? (
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <span className="shrink-0 rounded-full bg-[var(--result-fail-bg)] px-2 py-0.5 text-[12px] font-semibold text-[var(--result-fail-fg)]">{leverLabel(r)}</span>
            <span className="h-3 min-w-0 flex-1 rounded-full bg-[var(--surface-muted)] blur-[2px]" aria-hidden="true" />
          </span>
        ) : (
          <span className="min-w-0 flex-1 font-[family-name:var(--font-display)] text-[16px] font-bold leading-[1.35] tracking-[-0.01em] text-[var(--text)]">{r.ruleTitle}</span>
        )}
        {high && <span className="shrink-0 text-[12px] font-semibold text-[var(--text-muted)] max-[560px]:hidden">High impact</span>}
      </button>
      {open && (
        <div className="border-t border-[var(--border)] pb-4 pt-4">
          <div className="flex flex-col gap-4 rounded-[12px] bg-[var(--result-fail-bg)] p-5">
            {variant === 'cd' && (
              <div className="flex flex-col gap-1.5">
                <p className="font-[family-name:var(--font-display)] text-[17px] font-bold text-[var(--result-fail-fg)]">What we saw:</p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text)]">{r.reason}</p>
              </div>
            )}
            {/* the fix, locked: placeholder lines under a blur, never the real text */}
            <div className="relative overflow-hidden rounded-[10px] bg-[var(--surface)] p-4">
              <div className="flex flex-col gap-2 blur-[3px]" aria-hidden="true">
                <span className="h-3 w-[38%] rounded-full bg-[var(--surface-muted)]" />
                <span className="h-2.5 w-[92%] rounded-full bg-[var(--surface-muted)]" />
                <span className="h-2.5 w-[84%] rounded-full bg-[var(--surface-muted)]" />
                <span className="h-2.5 w-[70%] rounded-full bg-[var(--surface-muted)]" />
              </div>
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[var(--surface)]/60 px-4 text-center">
                <p className="text-sm font-semibold text-[var(--text)]">{variant === 'cd' ? 'How to fix it, with examples, is in the full report' : 'This finding and its fix are in the full report'}</p>
                <a href={buyUrl} className="cxo-btn cxo-btn-primary !px-4 !py-1.5 text-sm">
                  Unlock for {price} <Arrow />
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const STOPS = ['Homepage', 'Collections', 'Product page', 'Cart', 'Checkout']

export function FullStoreOffer({ variant, lockedCount, qualified, buyUrl, callUrl, price }: { variant: 'b' | 'cd'; lockedCount: number; qualified: boolean; buyUrl: string; callUrl: string; price: string }) {
  const buy = (
    <a key="buy" href={buyUrl} className={`cxo-btn ${qualified ? 'cxo-btn-ghost' : 'cxo-btn-primary'}`}>
      Get the full report, {price} <Arrow />
    </a>
  )
  const call = (
    <a key="call" href={callUrl} className={`cxo-btn ${qualified ? 'cxo-btn-primary' : 'cxo-btn-ghost'}`}>
      Book a call <Arrow />
    </a>
  )
  return (
    <section className="mt-6 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]" aria-label="Full report">
      <div className="flex flex-col gap-3 p-[var(--card-padding)]">
        <p className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-muted)]">
          <LockIcon /> Full report, {price} one-off
        </p>
        {variant === 'cd' ? (
          <>
            <h3 className="font-[family-name:var(--font-display)] text-[length:var(--text-xl)] font-bold leading-[1.25] tracking-[-0.02em] text-[var(--text)]">You saw one page. Shoppers go through five.</h3>
            <p className="text-[15px] leading-[1.6] text-[var(--text-muted)]">
              The full report checks your whole store the same way, from the homepage to the checkout: 300+ checks, every fix with examples, and a PDF to share with your developer.
            </p>
            <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 py-1">
              {STOPS.map((s, i) => {
                const done = s === 'Product page'
                return (
                  <li key={s} className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-semibold ${done ? 'border-[var(--result-pass-fg)] bg-[var(--result-pass-bg)] text-[var(--result-pass-fg)]' : 'border-[var(--border)] text-[var(--text)]'}`}>
                      {done ? <Check /> : <LockIcon size={11} />} {s}
                    </span>
                    {i < STOPS.length - 1 && <span className="text-[var(--text-muted)]" aria-hidden="true">→</span>}
                  </li>
                )
              })}
            </ol>
          </>
        ) : (
          <>
            <h3 className="font-[family-name:var(--font-display)] text-[length:var(--text-xl)] font-bold leading-[1.25] tracking-[-0.02em] text-[var(--text)]">
              Unlock the {lockedCount} locked {lockedCount === 1 ? 'finding' : 'findings'} on this page
            </h3>
            <p className="text-[15px] leading-[1.6] text-[var(--text-muted)]">Each one with where it is on your page, how to fix it and examples from stores that get it right. Plus the rest of your store, from the homepage to the checkout.</p>
          </>
        )}
      </div>
      <div className="flex flex-col gap-3 border-t border-[var(--border)] bg-[var(--surface-muted)] p-[var(--card-padding)]">
        <div className="flex flex-wrap items-center gap-3">{qualified ? [call, buy] : [buy, call]}</div>
        <p className="text-[13px] leading-[1.6] text-[var(--text-muted)]">
          {qualified ? 'On a call we go through your results and tell you honestly if working together is worth it.' : 'The €49 is deducted from a CRO audit if you go further with us.'}
        </p>
      </div>
    </section>
  )
}
