'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { z } from 'zod'
import { CheckpointResultBody } from '../components/CheckpointResultBody'
import { NextStep } from '../components/NextStep'
import { api, asset } from '@/lib/base'
import { estimate, eur, type Estimate } from '@/lib/estimate'
import { isQualified, lever, scoreOf, effortLabel, LEVERS, type Lever, type ScanResult } from '@/lib/report'

// Calendly once available; until then the existing booking form (same as NextStep)
const CALL_URL = process.env.NEXT_PUBLIC_CALL_URL || 'https://tally.so/r/w2dP9M'
const CHECKLIST_URL = process.env.NEXT_PUBLIC_CHECKLIST_URL || 'https://cxo.studio/checklist'

const ResultSchema = z.array(
  z.object({
    ruleId: z.string(),
    ruleTitle: z.string(),
    passed: z.boolean(),
    reason: z.string(),
    checkpoint: z
      .object({
        requiredActions: z.string(),
        justificationsBenefits: z.string(),
        examples: z.array(z.object({ url: z.string(), filename: z.string(), thumbnailUrl: z.string() })),
        priority: z.string().optional(),
        difficulty: z.string().optional(),
        metrics: z.array(z.string()).optional(),
      })
      .optional(),
  }),
)

function hostOf(raw: string) {
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, '')
  } catch {
    return raw
  }
}

const Arrow = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m9 18 6-6-6-6" />
  </svg>
)

export default function ResultsPage() {
  const [results, setResults] = useState<ScanResult[] | null>(null)
  const [url, setUrl] = useState('')
  const [numbers, setNumbers] = useState<Estimate | null>(null)
  const [revenueBand, setRevenueBand] = useState('')
  const [desktop, setDesktop] = useState<string | null>(null)
  const [mobile, setMobile] = useState<string | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [visible, setVisible] = useState(8)
  const [located, setLocated] = useState<Located | 'loading' | 'failed' | null>(null)

  useEffect(() => {
    try {
      const rev = localStorage.getItem('scanRevenue') || ''
      setRevenueBand(rev)
      setNumbers(estimate(rev, localStorage.getItem('scanAov') || '', localStorage.getItem('scanCr') || ''))
      setUrl(localStorage.getItem('scanUrl') || '')
      const raw = localStorage.getItem('scanResults')
      if (raw) {
        const parsed = ResultSchema.parse(JSON.parse(raw))
        // findings first, high priority first: that's what the visitor came for
        const rank = (r: ScanResult) => (r.passed ? 2 : 0) + (r.checkpoint?.priority === 'High' ? 0 : 1)
        setResults([...parsed].sort((a, b) => rank(a) - rank(b)))
      }
      const s = (k: string) => sessionStorage.getItem(k) ?? localStorage.getItem(k)
      setDesktop(s('scanPreviewDesktop') || sessionStorage.getItem('lastScreenshot'))
      setMobile(s('scanPreviewMobile'))
    } catch (e) {
      console.error('Error loading scan results:', e)
      setResults(null)
    }
  }, [])

  // pin the findings on the page (app/api/locate): one page load + one AI call, cached per URL
  useEffect(() => {
    if (!results || !url) return
    const failed = results.filter((r) => !r.passed)
    if (!failed.length) return
    try {
      const cached = JSON.parse(localStorage.getItem('scanLocate') || 'null') as { url: string; data: Located } | null
      if (cached?.url === url && cached.data?.screenshot) {
        setLocated(cached.data)
        return
      }
    } catch {}
    setLocated('loading')
    const ctrl = new AbortController()
    fetch(api('/locate'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, findings: failed.map((r) => ({ id: r.ruleId, title: r.ruleTitle, reason: r.reason })) }),
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: Located) => {
        setLocated(data)
        try {
          localStorage.setItem('scanLocate', JSON.stringify({ url, data }))
        } catch {}
      })
      .catch((e) => {
        if ((e as Error).name !== 'AbortError') setLocated('failed')
      })
    return () => ctrl.abort()
  }, [results, url])

  // pin numbers, top to bottom on the page; several findings on one element stack up
  const pinNo = useMemo(() => {
    const m = new Map<string, number>()
    if (located && typeof located === 'object') {
      ;[...located.pins].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x).forEach((p, i) => m.set(p.findingId, i + 1))
    }
    return m
  }, [located])

  const openFinding = (id: string) => {
    if (!results) return
    const idx = results.findIndex((r) => r.ruleId === id)
    if (idx >= visible) setVisible(idx + 1)
    setOpen((prev) => new Set(prev).add(id))
    requestAnimationFrame(() => document.getElementById(`f-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  }

  const report = useMemo(() => {
    if (!results) return null
    const failed = results.filter((r) => !r.passed)
    const byLever = LEVERS.map((l) => {
      const items = results.filter((r) => lever(r) === l.id)
      return { ...l, total: items.length, passed: items.filter((r) => r.passed).length }
    }).filter((l) => l.total > 0)
    const weakest = [...byLever].sort((a, b) => a.passed / a.total - b.passed / b.total)[0]?.id
    // fix these first: failed, high priority, easiest first
    const effortRank = (r: ScanResult) => ({ Easy: 0, Moderate: 1, Difficult: 2 })[r.checkpoint?.difficulty || ''] ?? 1
    const quick = [...failed]
      .sort((a, b) => (a.checkpoint?.priority === 'High' ? 0 : 1) - (b.checkpoint?.priority === 'High' ? 0 : 1) || effortRank(a) - effortRank(b))
      .slice(0, 3)
    const easyHigh = failed.filter((r) => r.checkpoint?.priority === 'High' && r.checkpoint?.difficulty === 'Easy').length
    return { failed, passed: results.length - failed.length, total: results.length, score: scoreOf(results), byLever, weakest, quick, easyHigh }
  }, [results])

  const host = hostOf(url)
  const qualified = isQualified(revenueBand)
  const low = numbers ? numbers.revenue * 0.05 : 0
  const high = numbers ? numbers.revenue * 0.15 : 0
  const shortEur = (n: number) => (n >= 1000 ? `€${(Math.round(n / 100) / 10).toString().replace(/\.0$/, '')}k` : eur(n))

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <main className="cxo-page">
      <a className="cxo-logo" href="https://cxo.studio" aria-label="CXO studio">
        <img src={asset('/cxo-logo.png')} alt="CXO studio" />
      </a>

      {!results || !report ? (
        <>
          <div className="cxo-head">
            <h1 className="cxo-reveal">No scan yet</h1>
            <p className="cxo-reveal cxo-reveal-1">Start from the questions and we’ll scan your product page.</p>
          </div>
          <div className="cxo-card mx-auto max-w-[720px]">
            <a className="cxo-btn cxo-btn-primary cxo-btn-block" href="https://cxo.studio/start">Find my revenue leaks</a>
          </div>
        </>
      ) : (
        <div className="mx-auto flex w-full min-w-0 max-w-[1120px] flex-col gap-6">
          {/* 1. the verdict */}
          <section className="cxo-card cxo-reveal flex flex-wrap items-center gap-10" aria-label="Verdict">
            <div className="flex min-w-0 flex-[999_1_480px] flex-col gap-4">
              <p className="text-sm font-semibold text-[var(--text-muted)]">
                {host} · Product page · {report.total} checkpoints
              </p>
              <h1 className="font-[family-name:var(--font-display)] text-[clamp(28px,4vw,44px)] font-bold leading-[1.12] tracking-[-0.035em] text-[var(--text)]">
                {numbers ? (
                  <>
                    Your product page leaves about{' '}
                    <span className="whitespace-nowrap rounded-[var(--radius-md)] bg-[var(--result-fail-bg)] px-2 text-[var(--result-fail-fg)]">
                      {shortEur(low)} to {shortEur(high)}
                    </span>{' '}
                    a month on the table
                  </>
                ) : (
                  <>Your product page has {report.failed.length} things to fix</>
                )}
              </h1>
              <p className="text-[18px] leading-[1.6] text-[var(--text-muted)]">
                {report.failed.length} of {report.total} checks failed.
                {report.easyHigh > 0 && ` ${report.easyHigh} of them are high-impact and easy, so start there.`}
              </p>
              <div className="flex flex-wrap gap-3 pt-2">
                <a href="#fixes" className="cxo-btn cxo-btn-primary">
                  See what to fix first <Arrow />
                </a>
                {qualified && (
                  <a href={CALL_URL} className="cxo-btn cxo-btn-ghost">
                    Book my CRO Audit call
                  </a>
                )}
              </div>
            </div>
            <ScoreRing score={report.score} />
          </section>

          {/* 2. where the score is lost */}
          <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4" aria-label="Areas">
            {report.byLever.map((l) => {
              const weak = l.id === report.weakest
              return (
                <div key={l.id} className="cxo-card flex flex-col gap-2.5 !p-[22px]">
                  <p className="text-[15px] font-semibold text-[var(--text)]">{l.label}</p>
                  <p className={`font-[family-name:var(--font-display)] text-[28px] font-bold tracking-[-0.03em] ${weak ? 'text-[var(--result-fail-fg)]' : 'text-[var(--text)]'}`}>
                    {l.passed}
                    <span className="text-[18px] text-[var(--text-subtle)]">/{l.total} passed</span>
                  </p>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-muted)]">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: weak ? 'var(--result-fail-fg)' : 'var(--text)' }}
                      initial={{ width: 0 }}
                      animate={{ width: `${(l.passed / l.total) * 100}%` }}
                      transition={{ duration: 1.2, ease: [0.4, 0, 0.2, 1] }}
                    />
                  </div>
                  <p className="text-[13px] text-[var(--text-muted)]">
                    Moves {l.moves}
                    {weak && ' · weakest area'}
                  </p>
                </div>
              )
            })}
          </section>

          {/* 3. fix these first */}
          {report.quick.length > 0 && (
            <section id="fixes" className="cxo-card flex scroll-mt-6 flex-col gap-5" aria-label="Fix these first">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-[family-name:var(--font-display)] text-[28px] font-bold tracking-[-0.03em] text-[var(--text)]">Fix these first</h2>
                <p className="text-sm text-[var(--text-muted)]">Highest impact, least effort</p>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {report.quick.map((r, i) => (
                  <article key={r.ruleId} className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] p-[22px]">
                    <div className="flex items-center gap-2.5">
                      <span className="grid h-[26px] w-[26px] place-items-center rounded-full text-sm font-bold" style={{ background: 'var(--result-fail-fg)', color: 'var(--text-inverse)' }}>
                        {i + 1}
                      </span>
                      <span className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: 'var(--result-pass-bg)', color: 'var(--result-pass-fg)' }}>
                        {effortLabel(r)}
                      </span>
                    </div>
                    <h3 className="font-[family-name:var(--font-display)] text-[18px] font-bold leading-[1.3] tracking-[-0.02em] text-[var(--text)]">{r.ruleTitle}</h3>
                    <p className="line-clamp-4 text-[15px] leading-[1.55] text-[var(--text-muted)]">{r.reason}</p>
                    <p className="mt-auto border-t border-[var(--surface-muted)] pt-3 text-[13px] font-semibold text-[var(--text)]">
                      Moves: {LEVERS.find((l) => l.id === lever(r))?.moves}
                    </p>
                  </article>
                ))}
              </div>
            </section>
          )}

          {/* 4. what it is worth, and the one next step that fits */}
          {numbers && (
            <section
              className="flex flex-wrap items-center gap-8 rounded-[var(--radius-xl)] p-6 sm:p-10"
              style={{ background: 'var(--cta-bg)', color: 'var(--cta-text)' }}
              aria-label="What fixing this is worth"
            >
              <div className="flex min-w-0 flex-[999_1_420px] flex-col gap-3">
                <p className="text-sm font-semibold opacity-70">What fixing this is worth</p>
                <h2 className="font-[family-name:var(--font-display)] text-[clamp(24px,3vw,32px)] font-bold leading-[1.2] tracking-[-0.03em]" style={{ color: 'inherit' }}>
                  A 10% lift in conversion is about {eur(numbers.lift10)} more a month. {eur(numbers.lift10 * 12)} a year.
                </h2>
                <p className="text-sm leading-[1.6] opacity-70">
                  From your answers: about {eur(numbers.revenue)} a month
                  {numbers.aov ? `, ${eur(numbers.aov)} orders` : ''}
                  {numbers.cr ? `, ${(numbers.cr * 100).toFixed(1)}% conversion${numbers.crIsBenchmark ? ' (average)' : ''}` : ''}. A rough estimate, not a promise.
                </p>
              </div>
              <div className="flex flex-[1_1_300px] flex-col gap-3">
                <div className="grid grid-cols-3 gap-2">
                  {[0.05, 0.1, 0.15].map((k) => (
                    <div
                      key={k}
                      className="rounded-[var(--radius-md)] p-3.5 text-center"
                      style={k === 0.1 ? { background: 'var(--cta-text)', color: 'var(--cta-bg)' } : { border: '1px solid color-mix(in srgb, var(--cta-text) 18%, transparent)' }}
                    >
                      <p className="text-xs opacity-70">+{k * 100}%</p>
                      <p className="mt-1 text-[18px] font-bold">{shortEur(numbers.revenue * k)}</p>
                    </div>
                  ))}
                </div>
                {qualified ? (
                  <>
                    <a href={CALL_URL} className="cxo-btn cxo-btn-block" style={{ background: 'var(--cta-text)', color: 'var(--cta-bg)' }}>
                      Book my CRO Audit call <Arrow />
                    </a>
                    <p className="text-center text-[13px] opacity-70">30 minutes with Louis. We price every leak with you.</p>
                  </>
                ) : (
                  <>
                    <a href={CHECKLIST_URL} className="cxo-btn cxo-btn-block" style={{ background: 'var(--cta-text)', color: 'var(--cta-bg)' }}>
                      Get the full CRO checklist <Arrow />
                    </a>
                    <p className="text-center text-[13px] opacity-70">At your size, an audit wouldn’t pay for itself yet. Fix the quick wins yourself first.</p>
                  </>
                )}
              </div>
            </section>
          )}

          {/* 5. the page, with every finding pinned where it happens */}
          <section className="cxo-card flex flex-col gap-4 !p-5 sm:!p-6" aria-label="Your page, annotated">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
              <h2 className="font-[family-name:var(--font-display)] text-[24px] font-bold tracking-[-0.03em] text-[var(--text)]">Where the problems are</h2>
              <p className="text-sm text-[var(--text-muted)]">
                {located === 'loading'
                  ? 'Placing the findings on your page…'
                  : typeof located === 'object' && located && pinNo.size
                    ? `${pinNo.size} findings pinned. Click a pin to open it.`
                    : 'Desktop and mobile, as we scanned them'}
              </p>
            </div>
            <div className="flex flex-wrap items-start justify-center gap-4">
              <div className="min-w-0 flex-[1_1_480px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-strong)] bg-[var(--surface)]">
                <div className="flex items-center gap-1.5 border-b border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2">
                  <span className="h-2 w-2 rounded-full bg-[var(--border-strong)]" />
                  <span className="h-2 w-2 rounded-full bg-[var(--border-strong)]" />
                  <span className="h-2 w-2 rounded-full bg-[var(--border-strong)]" />
                  <span className="ml-2 min-w-0 truncate text-xs text-[var(--text-muted)]">{url}</span>
                </div>
                {typeof located === 'object' && located ? (
                  <div className="max-h-[640px] overflow-y-auto max-[560px]:max-h-[420px]">
                    <div className="relative">
                      <img src={located.screenshot} alt="Your product page with the findings pinned" className="block w-full" />
                      {located.pins.map((p) => {
                        const n = pinNo.get(p.findingId)!
                        const same = located.pins.filter((q) => q.box.x === p.box.x && q.box.y === p.box.y)
                        const k = same.indexOf(p)
                        return (
                          <span key={p.findingId}>
                            {k === 0 && (
                              <span
                                aria-hidden="true"
                                className="pointer-events-none absolute rounded-[6px] border-2"
                                style={{
                                  left: `${(p.box.x / located.width) * 100}%`,
                                  top: `${(p.box.y / located.height) * 100}%`,
                                  width: `${(p.box.w / located.width) * 100}%`,
                                  height: `${(p.box.h / located.height) * 100}%`,
                                  borderColor: 'var(--result-fail-fg)',
                                  background: 'color-mix(in srgb, var(--result-fail-fg) 7%, transparent)',
                                }}
                              />
                            )}
                            <button
                              type="button"
                              onClick={() => openFinding(p.findingId)}
                              aria-label={`Finding ${n}`}
                              className="absolute grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-[3px] text-[13px] font-bold shadow-[var(--shadow-raised)] transition-transform hover:scale-110"
                              style={{
                                left: `min(calc(${((p.box.x + p.box.w) / located.width) * 100}% - ${k * 24}px), calc(100% - 16px))`,
                                top: `${(p.box.y / located.height) * 100}%`,
                                background: 'var(--result-fail-fg)',
                                color: 'var(--text-inverse)',
                                borderColor: 'var(--surface)',
                              }}
                            >
                              {n}
                            </button>
                          </span>
                        )
                      })}
                    </div>
                  </div>
                ) : desktop ? (
                  <div className="relative">
                    <img src={desktop} alt="Desktop view of the scanned page" className={`block aspect-[16/10] w-full object-cover object-top ${located === 'loading' ? 'opacity-60' : ''}`} />
                    {located === 'loading' && (
                      <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--cta-bg)] px-4 py-2 text-sm font-semibold text-[var(--cta-text)]">
                        Placing the findings on your page…
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="grid aspect-[16/10] place-items-center text-sm text-[var(--text-muted)]">Preview unavailable</div>
                )}
              </div>
              {mobile && (
                <div className="w-[150px] flex-none overflow-hidden rounded-[26px] border-[6px] border-[var(--text)] bg-[var(--surface)] max-[810px]:hidden">
                  <img src={mobile} alt="Mobile view of the scanned page" className="block h-[300px] w-full object-cover object-top" loading="lazy" />
                </div>
              )}
            </div>
          </section>

          {/* 6. every check */}
          <section className="cxo-card min-w-0" aria-label="All checks">
            <h2 className="cxo-q">All {report.total} checks</h2>
            <div className="relative">
              <div className="cxo-rows">
                {results.slice(0, visible).map((r) => {
                  const isOpen = open.has(r.ruleId)
                  const tone = r.passed ? 'pass' : 'fail'
                  return (
                    <div
                      key={r.ruleId}
                      id={`f-${r.ruleId}`}
                      className={`scroll-mt-6 overflow-hidden rounded-[var(--radius-md)] border bg-[var(--surface)] ${isOpen ? 'border-[var(--border-strong)]' : 'border-[var(--border)]'}`}
                      style={{ ['--result-fg' as string]: `var(--result-${tone}-fg)`, ['--result-bg' as string]: `var(--result-${tone}-bg)` }}
                    >
                      <button type="button" className="cxo-row !rounded-none !border-0 !bg-transparent" onClick={() => toggle(r.ruleId)} aria-expanded={isOpen}>
                        <Verdict passed={r.passed} n={pinNo.get(r.ruleId)} />
                        <span className="cxo-row-text">
                          <span className="cxo-row-label text-[15px] leading-[1.4]">{r.ruleTitle}</span>
                        </span>
                        {r.checkpoint?.priority && (
                          <span className="shrink-0 text-xs text-[var(--text-muted)] max-[560px]:hidden">
                            {r.checkpoint.priority} · {effortLabel(r)}
                          </span>
                        )}
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-[var(--border)]">
                          <ChevronDown className={`h-4 w-4 text-[var(--text)] transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden />
                        </span>
                      </button>
                      {isOpen && (
                        <div className="px-3 pb-3 sm:px-4 sm:pb-4">
                          <div className="flex flex-col gap-4 rounded-[var(--radius-md)] bg-[var(--result-bg)] p-4 sm:p-5">
                            <div className="flex flex-col gap-1.5">
                              <p className="font-[family-name:var(--font-display)] text-[17px] font-bold text-[var(--result-fg)]">What we saw:</p>
                              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text)]">{r.reason}</p>
                            </div>
                            {r.checkpoint && <CheckpointResultBody checkpoint={r.checkpoint} passed={r.passed} />}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              {visible < results.length && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-40 items-end justify-center bg-gradient-to-b from-transparent to-[var(--surface)] pb-1">
                  <button type="button" onClick={() => setVisible((v) => v + 10)} className="cxo-btn cxo-btn-primary pointer-events-auto !px-7">
                    Load more results
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* 7. the path from here */}
          <NextStep />
        </div>
      )}
    </main>
  )
}

function ScoreRing({ score }: { score: number }) {
  const r = 84
  const c = 2 * Math.PI * r
  return (
    <div className="flex flex-[1_1_220px] flex-col items-center gap-2.5">
      <div className="relative h-[200px] w-[200px]">
        <svg width="200" height="200" viewBox="0 0 200 200" role="img" aria-label={`Conversion score ${score} out of 100`}>
          <circle cx="100" cy="100" r={r} fill="none" strokeWidth="16" style={{ stroke: 'var(--surface-muted)' }} />
          <motion.circle
            cx="100"
            cy="100"
            r={r}
            fill="none"
            strokeWidth="16"
            strokeLinecap="round"
            transform="rotate(-90 100 100)"
            style={{ stroke: 'var(--text)' }}
            strokeDasharray={c}
            initial={{ strokeDashoffset: c }}
            animate={{ strokeDashoffset: c * (1 - score / 100) }}
            transition={{ duration: 1.4, ease: [0.4, 0, 0.2, 1] }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-[family-name:var(--font-display)] text-[56px] font-extrabold leading-none tracking-[-0.04em] text-[var(--text)]">{score}</span>
          <span className="text-sm font-semibold text-[var(--text-muted)]">out of 100</span>
        </div>
      </div>
      <p className="max-w-[230px] text-center text-[13px] leading-[1.5] text-[var(--text-muted)]">Conversion score. High-priority checks count double.</p>
    </div>
  )
}

function Verdict({ passed, n }: { passed: boolean; n?: number }) {
  if (!passed && n)
    return (
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold" style={{ background: 'var(--result-fail-fg)', color: 'var(--text-inverse)' }} aria-label={`To fix, pin ${n}`} role="img">
        {n}
      </span>
    )
  return (
    <span
      className="grid h-6 w-6 shrink-0 place-items-center rounded-full"
      style={{ background: `var(--result-${passed ? 'pass' : 'fail'}-fg)`, color: 'var(--text-inverse)' }}
      aria-label={passed ? 'Passed' : 'To fix'}
      role="img"
    >
      {passed ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m5 12.5 4.5 4.5L19 7.5" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
          <path d="M12 6v8M12 18.5h.01" />
        </svg>
      )}
    </span>
  )
}

type Located = { screenshot: string; width: number; height: number; pins: { findingId: string; box: { x: number; y: number; w: number; h: number } }[] }

export type { Lever }
