'use client'

/**
 * Pitch mockups for the free scan (results page, ?gate=b or ?gate=cd). Not the default yet.
 *  B  : the locked findings sit in the list where they rank by impact, title hidden.
 *  CD : every finding on the page is visible (title and what we saw); the fix of a locked one
 *       is in the full report, and the full report is sold as the rest of the store.
 */
import { useEffect, useState } from 'react'
import { api } from '@/lib/base'
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


/** After the free findings: the issues the free scan did not run, blurred, with the way to unlock them. */
export function LockedBlock({ count, buyUrl, price }: { count: number; pageName?: string; buyUrl: string; price: string }) {
  const widths = ['72%', '58%', '84%']
  return (
    <div className="relative overflow-hidden rounded-[16px] border border-dashed border-[var(--border-strong)] bg-[var(--surface)]">
      <div className="flex flex-col gap-3 px-4 py-4 blur-[2px]" aria-hidden="true">
        {widths.map((w, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="h-[26px] w-[26px] shrink-0 rounded-full bg-[var(--surface-muted)]" />
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="h-3.5 rounded-full bg-[var(--surface-muted)]" style={{ width: w }} />
              <span className="h-2.5 w-1/2 rounded-full bg-[var(--surface-muted)]" />
            </span>
          </div>
        ))}
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[var(--surface)]/70 px-5 text-center">
        <p className="inline-flex items-center gap-2 font-[family-name:var(--font-display)] text-[17px] font-bold text-[var(--text)]">
          <LockIcon /> {count} more checks on your whole store
        </p>
        <a href={buyUrl} className="cxo-btn cxo-btn-primary !px-5 !py-2 text-sm">
          Unlock the full report, {price} <Arrow />
        </a>
      </div>
    </div>
  )
}

type Coverage = {
  total: number
  stores: number
  accuracy: number | null
  examples: number
  siteIds: string[]
  pages: { key: string; label: string; hint?: string; checks: number; expectedIssues: number }[]
}

const Stat = ({ value, label }: { value: string; label: string }) => (
  <div className="flex min-w-0 flex-col gap-0.5 rounded-[12px] bg-[var(--surface-muted)] px-3 py-3">
    <span className="font-[family-name:var(--font-display)] text-[length:var(--text-xl)] font-bold leading-none tracking-[-0.02em] text-[var(--text)]">{value}</span>
    <span className="text-[12px] leading-snug text-[var(--text-muted)]">{label}</span>
  </div>
)

const WHAT_YOU_GET = [
  'Every check on your homepage, collections, product pages, cart and checkout',
  'Each issue ranked by its impact on revenue, so you know what to fix first',
  'The fix, step by step, and why it matters, backed by research and A/B tests',
  'Real examples from stores that get it right',
  'A PDF to hand to your developer or agency',
]

/**
 * The full report offer under the free results. A free scan runs only some checks of the page it scanned:
 * the scanned areas show issues found and checks run; the others show their number of checks (never guessed issues).
 */
export function FullStoreOffer({ variant, pageKey, toFix, lockedCount, qualified, buyUrl, callUrl, price, estimated = false, ran = [] }: { variant: 'b' | 'cd'; pageKey: string; toFix: number; fixesShown?: number; lockedCount: number; qualified: boolean; buyUrl: string; callUrl: string; price: string; estimated?: boolean; freeRun?: number; ran?: { id: string; failed: boolean }[] }) {
  const [cov, setCov] = useState<Coverage | null>(null)
  useEffect(() => {
    fetch(api('/report-coverage'))
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Coverage | null) => d && Array.isArray(d.pages) && setCov(d))
      .catch(() => {})
  }, [])
  // which areas the free scan touched: the scanned page and, with it, the checks that apply on every page
  const site = new Set(cov?.siteIds || [])
  const areaOf = (id: string) => (site.has(id) ? 'site' : pageKey)
  const scanned = new Map<string, { run: number; found: number }>()
  for (const r of ran) {
    const k = areaOf(r.id)
    const a = scanned.get(k) || { run: 0, found: 0 }
    a.run++
    if (r.failed) a.found++
    scanned.set(k, a)
  }
  // one count everywhere: every Live check on the store, minus the ones the free scan ran
  const left = cov ? Math.max(0, cov.total - ran.length) : 0
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
      <div className="flex flex-col gap-4 p-[var(--card-padding)]">
        <p className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--text-muted)]">
          <LockIcon /> Full report, {price} one-off
        </p>
        {variant === 'cd' ? (
          <>
            <h3 className="font-[family-name:var(--font-display)] text-[length:var(--text-2xl)] font-bold leading-[1.15] tracking-[-0.02em] text-[var(--text)]">
              {estimated && cov ? `${left} more checks are waiting on your store` : `${lockedCount} more ${lockedCount === 1 ? 'issue' : 'issues'} to fix on this page`}
            </h3>
            <p className="text-[15px] leading-[1.6] text-[var(--text-muted)]">
              The free scan ran {ran.length || 'a few'}{cov ? ` of our ${cov.total}` : ''} checks, on one page. The full report is our complete e-commerce conversion audit: every page a shopper goes through, from your homepage to the payment step, checked against what we have seen work on hundreds of stores and in 200+ A/B tests.
            </p>
            {cov && (
              <div className="grid grid-cols-4 gap-2 max-[810px]:grid-cols-2">
                <Stat value={String(cov.total)} label="conversion checks" />
                <Stat value={`${cov.stores}`} label="stores benchmarked" />
                {cov.accuracy ? <Stat value={`${Math.floor(cov.accuracy)}%`} label="match with our experts' review" /> : <Stat value="6" label="areas of your store" />}
                <Stat value={cov.examples > 50 ? `${Math.floor(cov.examples / 10) * 10}+` : String(cov.examples)} label="example screenshots" />
              </div>
            )}
            {cov && (
              <ul className="flex flex-col overflow-hidden rounded-[12px] border border-[var(--border)]">
                {cov.pages
                  .filter((p) => p.checks > 0)
                  .map((p) => {
                    const sc = estimated ? scanned.get(p.key) : p.key === pageKey ? { run: 0, found: toFix } : undefined
                    return (
                      <li key={p.key} className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3 last:border-b-0">
                        {sc ? (
                          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--result-pass-bg)] text-[var(--result-pass-fg)]"><Check /></span>
                        ) : (
                          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--surface-muted)] text-[var(--text-muted)]"><LockIcon size={11} /></span>
                        )}
                        <span className="flex min-w-0 flex-1 items-center justify-between gap-3 max-[560px]:flex-col max-[560px]:items-start max-[560px]:gap-0.5">
                          <span className="min-w-0 text-sm font-semibold text-[var(--text)]">
                            {p.label}{' '}
                            <span className="font-normal text-[var(--text-muted)]">· {sc && estimated ? <span className="text-[var(--result-fail-fg)]">{sc.found} {sc.found === 1 ? 'issue' : 'issues'} in the free scan</span> : p.hint || 'not scanned yet'}</span>
                          </span>
                          <span className="shrink-0 text-right text-[13px] text-[var(--text-muted)] max-[560px]:text-left">
                            {sc && !estimated ? (
                              <>
                                <b className="text-[var(--result-fail-fg)]">{toFix} issues</b> · {lockedCount} fixes locked
                              </>
                            ) : (
                              <b className="text-[var(--text)]">{p.checks} checks</b>
                            )}
                          </span>
                        </span>
                      </li>
                    )
                  })}
              </ul>
            )}
            <ul className="flex flex-col gap-2 text-[14px] leading-snug text-[var(--text)]">
              {WHAT_YOU_GET.map((w) => (
                <li key={w} className="flex items-start gap-2">
                  <span className="mt-[3px] shrink-0 text-[var(--result-pass-fg)]"><Check /></span>
                  {w}
                </li>
              ))}
            </ul>
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
          {qualified ? 'On a call we go through your results and tell you honestly if working together is worth it.' : 'One-off payment, no subscription.'}
        </p>
      </div>
    </section>
  )
}
