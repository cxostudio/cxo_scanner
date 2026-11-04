'use client'

import { useEffect, useRef, useState } from 'react'
import { SalesProjection, projection } from './SalesProjection'

/**
 * End of the results page: what fixing the leaks is worth, and the path from today's scan.
 *   1. Today: this product page scan (done, ticked)
 *   2. Next: scan the full website (self-serve)
 *   3. Then: working together (CRO Audit + optimisation), or a redesign talk for small stores
 * When the section scrolls into view the line draws from today's tick down to the next step,
 * which then lights up (same motion as the process timeline on cxo.studio). Static with
 * reduced motion.
 */

const Arrow = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m9 18 6-6-6-6" />
  </svg>
)
const Tick = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
)
const Lock = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M7 10V7.5a5 5 0 0 1 10 0V10h.5A1.5 1.5 0 0 1 19 11.5v8a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-8A1.5 1.5 0 0 1 6.5 10H7zm2 0h6V7.5a3 3 0 0 0-6 0V10z" />
  </svg>
)

const List = ({ items }: { items: string[] }) => (
  <ul className="flex flex-col gap-1.5">
    {items.map((t) => (
      <li key={t} className="flex items-start gap-2 font-semibold text-[var(--text)]">
        <span className="mt-[4px] shrink-0">
          <Tick size={14} />
        </span>
        {t}
      </li>
    ))}
  </ul>
)

type Money = { revenue: number; lift10: number; aov?: number; cr?: number; crIsBenchmark?: boolean }

export function YourPath({
  money,
  qualified,
  checked,
  toFix,
  eur,
  shortEur,
  callUrl,
  fullScanUrl,
  host = '',
}: {
  money: Money | null
  qualified: boolean
  checked: number
  toFix: number
  eur: (n: number) => string
  shortEur: (n: number) => string
  callUrl: string
  fullScanUrl: string
  host?: string
}) {
  const [lift, setLift] = useState(0.1)
  const ref = useRef<HTMLElement | null>(null)
  const [on, setOn] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
      setOn(true)
      return
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setOn(true)
          io.disconnect()
        }
      },
      { threshold: 0.35 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const ease = 'cubic-bezier(.22,1,.36,1)'

  return (
    <>
    <section ref={ref} className="rounded-[var(--radius-xl)] bg-[var(--bg-subtle)] p-6 sm:p-10" aria-label="What fixing this is worth">
      {/* what it is worth: pick a lift, watch the next 12 months */}
      {money && (() => {
        const p = projection(money.revenue, lift)
        const pct = Math.round(lift * 100)
        return (
          <div className="grid items-center gap-8 border-b border-[var(--border)] pb-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-12">
            <div className="flex min-w-0 flex-col gap-4">
              <p className="text-sm font-semibold text-[var(--text-muted)]">What fixing this is worth</p>
              <h2 className="font-[family-name:var(--font-display)] text-[clamp(24px,3vw,32px)] font-bold leading-[1.2] tracking-[-0.03em] text-[var(--text)]">
                A {pct}% lift is about {eur(money.revenue * lift)} more a month, once your fixes are live.
              </h2>
              <p className="text-[15px] leading-[1.6] text-[var(--text-muted)]">
                Revenue is visitors × conversion rate × order value. Lift conversion <em>or</em> average order value by {pct}% and revenue follows. Do both and it compounds.
              </p>
              <div className="grid grid-cols-3 gap-2" role="group" aria-label="Lift">
                {[0.05, 0.1, 0.15].map((k) => {
                  const on = k === lift
                  return (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setLift(k)}
                      className="rounded-[var(--radius-md)] border p-3.5 text-center transition-colors"
                      style={on ? { background: 'var(--result-pass-bg)', borderColor: 'var(--result-pass-fg)' } : { background: 'var(--surface)', borderColor: 'var(--border)' }}
                    >
                      <span className="block text-xs text-[var(--text-muted)]">+{Math.round(k * 100)}% lift</span>
                      <span className="mt-1 block whitespace-nowrap text-[18px] font-bold max-[560px]:text-[15px]" style={{ color: on ? 'var(--result-pass-fg)' : 'var(--text)' }}>
                        +{shortEur(money.revenue * k)}<span className="text-[12px] font-semibold text-[var(--text-muted)]">/mo</span>
                      </span>
                    </button>
                  )
                })}
              </div>
              <p className="text-[13px] leading-[1.6] text-[var(--text-muted)]">
                From your answers: about {eur(money.revenue)} a month
                {money.aov ? `, ${eur(money.aov)} orders` : ''}
                {money.cr ? `, ${(money.cr * 100).toFixed(1)}% conversion${money.crIsBenchmark ? ' (average)' : ''}` : ''}. A rough estimate, not a promise.
              </p>
            </div>
            <div className="min-w-0 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-[13px] font-semibold text-[var(--text-muted)]">Extra sales, next 12 months</p>
                  <p className="mt-1 font-[family-name:var(--font-display)] text-[26px] font-bold tracking-[-0.03em]" style={{ color: 'var(--result-pass-fg)' }}>+{eur(p.total)}</p>
                </div>
                <span className="rounded-full px-2.5 py-1 text-[13px] font-semibold" style={{ background: 'var(--result-pass-bg)', color: 'var(--result-pass-fg)' }}>
                  +{pct}% lift
                </span>
              </div>
              <SalesProjection monthly={money.revenue} lift={lift} shortEur={shortEur} />
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-[var(--text-muted)]">
                <span className="inline-flex items-center gap-2"><span className="h-[3px] w-4 rounded-full" style={{ background: 'var(--result-pass-fg)' }} />With a {pct}% lift</span>
                <span className="inline-flex items-center gap-2"><span className="w-4 border-t-2 border-dashed" style={{ borderColor: 'var(--border-strong)' }} />Other options</span>
                <span>Fixes go live over 3 months</span>
              </div>
            </div>
          </div>
        )
      })()}

      {/* the path */}
      <div className={`grid gap-6 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:gap-10 ${money ? 'pt-8' : ''}`}>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[var(--text-muted)]">What’s next</p>
          <p className="mt-2 font-[family-name:var(--font-display)] text-[22px] font-bold leading-[1.25] tracking-[-0.02em] text-[var(--text)] sm:text-[26px]">One page scanned. Your whole store is next.</p>
          <p className="mt-3 text-[15px] leading-[1.6] text-[var(--text-muted)]">
            This was a snapshot: one product page, {checked} checkpoints. If the findings ring true, the full scan does the same on every page your shoppers go through.
          </p>
        </div>
        <ol className="flex min-w-0 flex-col">
          {/* 1. today */}
          <li className="relative grid grid-cols-[28px_minmax(0,1fr)] gap-x-4 pb-8">
            <span aria-hidden="true" className="absolute left-[13px] top-7 bottom-0 w-[2px] bg-[var(--border)]" />
            <span
              aria-hidden="true"
              className="absolute left-[13px] top-7 bottom-0 w-[2px] origin-top bg-[var(--text)]"
              style={{ transform: on ? 'scaleY(1)' : 'scaleY(0)', transition: `transform 1.1s ${ease} 0.35s` }}
            />
            <span
              className="relative z-[1] grid h-7 w-7 place-items-center rounded-full"
              style={{
                background: 'var(--result-pass-fg)',
                color: 'var(--text-inverse)',
                transform: on ? 'scale(1)' : 'scale(.6)',
                opacity: on ? 1 : 0,
                transition: `transform .5s ${ease}, opacity .4s ${ease}`,
              }}
            >
              <Tick />
            </span>
            <div className="min-w-0">
              <p className="font-[family-name:var(--font-display)] text-[17px] font-bold leading-7 tracking-[-0.01em] text-[var(--text)]">Today: your product page scan</p>
              <p className="mt-1 text-[15px] leading-[1.6] text-[var(--text-muted)]">
                {checked} checkpoints checked, <strong className="text-[var(--text)]">{toFix} to fix</strong>. Start with the high-impact, easy ones above.
              </p>
            </div>
          </li>

          {/* 2. next */}
          <li className="relative grid grid-cols-[28px_minmax(0,1fr)] gap-x-4 pb-8">
            <span aria-hidden="true" className="absolute left-[13px] top-7 bottom-0 w-[2px] bg-[var(--border)]" />
            <span
              className="relative z-[1] grid h-7 w-7 place-items-center rounded-full border text-[13px] font-bold"
              style={{
                background: on ? 'var(--text)' : 'var(--surface)',
                borderColor: on ? 'var(--text)' : 'var(--border)',
                color: on ? 'var(--text-inverse)' : 'var(--text-muted)',
                boxShadow: on ? '0 0 0 6px color-mix(in srgb, var(--text) 10%, transparent)' : 'none',
                transition: `all .45s ${ease} 1.35s`,
              }}
            >
              2
            </span>
            <div
              className="flex min-w-0 flex-col gap-3"
              style={{ opacity: on ? 1 : 0.55, transform: on ? 'none' : 'translateY(6px)', transition: `opacity .5s ${ease} 1.35s, transform .5s ${ease} 1.35s` }}
            >
              <p className="font-[family-name:var(--font-display)] text-[17px] font-bold leading-7 tracking-[-0.01em] text-[var(--text)]">Next: scan your full website</p>
              <p className="text-[15px] leading-[1.6] text-[var(--text-muted)]">300+ checkpoints, the same way you just saw:</p>
              <List items={['Homepage', 'Collection pages', 'Product pages', 'Cart', 'Checkout', 'Thank you page']} />
              <a href={fullScanUrl} className={`cxo-btn ${qualified ? 'cxo-btn-ghost' : 'cxo-btn-primary'} self-start`}>
                Scan the full website <Arrow />
              </a>
            </div>
          </li>

          {/* 3. then */}
          <li className="relative grid grid-cols-[28px_minmax(0,1fr)] gap-x-4">
            <span className="relative z-[1] grid h-7 w-7 place-items-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]">
              <Lock />
            </span>
            <div className="flex min-w-0 flex-col gap-3">
              <p className="font-[family-name:var(--font-display)] text-[17px] font-bold leading-7 tracking-[-0.01em] text-[var(--text)]">Then: CRO Audit and continuous optimisation</p>
              {qualified ? (
                <>
                  <p className="text-[15px] leading-[1.6] text-[var(--text-muted)]">For brands ready to invest, with strategy and execution:</p>
                  <List items={['Full-funnel CRO Audit, every leak priced in euros', 'A/B testing of offers, UX and design', 'Implementation by our in-house developers', 'Weekly reports and a strategy call']} />
                  <a href={callUrl} className="cxo-btn cxo-btn-primary self-start">
                    Book my CRO Audit call <Arrow />
                  </a>
                  <p className="text-[13px] text-[var(--text-muted)]">We go through your results and tell you honestly if working together is worth it.</p>
                </>
              ) : (
                <>
                  <p className="text-[15px] leading-[1.6] text-[var(--text-muted)]">At your size, working together wouldn’t pay for itself yet. Fix the quick wins yourself first.</p>
                  <a href={callUrl} className="cxo-btn cxo-btn-ghost self-start">
                    Planning a redesign? Let’s talk <Arrow />
                  </a>
                </>
              )}
            </div>
          </li>
        </ol>
      </div>
    </section>
    <p className="mx-auto mt-6 max-w-[640px] text-center text-[13px] leading-[1.6] text-[var(--text-muted)]">
      This scan is done by AI against our CRO checklist. In our tests it agrees with a CRO specialist on about 9 checks in 10, so it can get one wrong.
      Spot a mistake?{' '}
      <a className="font-semibold text-[var(--text)] underline underline-offset-2" href={`mailto:info@cxo.studio?subject=${encodeURIComponent(`Scan feedback${host ? `: ${host}` : ''}`)}`}>
        Tell us
      </a>{' '}
      and we’ll check it by hand.
    </p>
    </>
  )
}
