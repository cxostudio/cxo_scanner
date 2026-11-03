'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { z } from 'zod'
import { CheckpointResultBody } from '../components/CheckpointResultBody'
import { NextStep } from '../components/NextStep'
import { api, asset } from '@/lib/base'
import { estimate, eur, type Estimate } from '@/lib/estimate'
import { isQualified, lever, scoreOf, effortLabel, LEVERS, type ScanResult } from '@/lib/report'

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

type Device = 'desktop' | 'mobile'
type Box = { x: number; y: number; w: number; h: number }
type Located = { screenshot: string; width: number; height: number; pins: { findingId: string; box: Box }[] }
type LocateState = Located | 'loading' | 'failed' | null

function hostOf(raw: string) {
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, '')
  } catch {
    return raw
  }
}

/** good / average / weak: green, orange, red. Used for the score and each area. */
const tone = (ratio: number) => (ratio >= 0.8 ? 'good' : ratio >= 0.5 ? 'mid' : 'weak')
const TONE = {
  good: { fg: 'var(--result-pass-fg)', bg: 'var(--result-pass-bg)', word: 'Good' },
  mid: { fg: 'var(--status-finding-fg)', bg: 'var(--status-finding-bg)', word: 'Room to grow' },
  weak: { fg: 'var(--result-fail-fg)', bg: 'var(--result-fail-bg)', word: 'Leaking sales' },
} as const

const shortEur = (n: number) => (n >= 1000 ? `€${(Math.round(n / 100) / 10).toString().replace(/\.0$/, '')}k` : eur(n))

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
  const [preview, setPreview] = useState<{ desktop: string | null; mobile: string | null }>({ desktop: null, mobile: null })
  const [located, setLocated] = useState<Record<Device, LocateState>>({ desktop: null, mobile: null })
  const [device, setDevice] = useState<Device>('desktop')
  const [selected, setSelected] = useState<string | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [visible, setVisible] = useState(10)
  const shotRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    try {
      const rev = localStorage.getItem('scanRevenue') || ''
      setRevenueBand(rev)
      setNumbers(estimate(rev, localStorage.getItem('scanAov') || '', localStorage.getItem('scanCr') || ''))
      setUrl(localStorage.getItem('scanUrl') || '')
      const raw = localStorage.getItem('scanResults')
      if (raw) {
        const parsed = ResultSchema.parse(JSON.parse(raw))
        // findings first, high priority then easiest first; passed checks after
        const eff = (r: ScanResult) => ({ Easy: 0, Moderate: 1, Difficult: 2 })[r.checkpoint?.difficulty || ''] ?? 1
        const rank = (r: ScanResult) => (r.passed ? 100 : 0) + (r.checkpoint?.priority === 'High' ? 0 : 10) + eff(r)
        setResults([...parsed].sort((a, b) => rank(a) - rank(b)))
      }
      const s = (k: string) => sessionStorage.getItem(k) ?? localStorage.getItem(k)
      setPreview({ desktop: s('scanPreviewDesktop') || sessionStorage.getItem('lastScreenshot'), mobile: s('scanPreviewMobile') })
      if (window.matchMedia('(max-width: 810px)').matches) setDevice('mobile')
    } catch (e) {
      console.error('Error loading scan results:', e)
      setResults(null)
    }
  }, [])

  // place the findings on the page (app/api/locate), desktop and phone in parallel, cached per URL
  useEffect(() => {
    if (!results || !url) return
    const failed = results.filter((r) => !r.passed)
    if (!failed.length) return
    const ctrls: AbortController[] = []
    ;(['desktop', 'mobile'] as Device[]).forEach((d) => {
      const key = `scanLocate:${d}`
      try {
        const cached = JSON.parse(localStorage.getItem(key) || 'null') as { url: string; data: Located } | null
        if (cached?.url === url && cached.data?.screenshot) {
          setLocated((p) => ({ ...p, [d]: cached.data }))
          return
        }
      } catch {}
      setLocated((p) => ({ ...p, [d]: 'loading' }))
      const ctrl = new AbortController()
      ctrls.push(ctrl)
      fetch(api('/locate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, device: d, findings: failed.map((r) => ({ id: r.ruleId, title: r.ruleTitle, reason: r.reason })) }),
        signal: ctrl.signal,
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((data: Located) => {
          setLocated((p) => ({ ...p, [d]: data }))
          try {
            localStorage.setItem(key, JSON.stringify({ url, data }))
          } catch {}
        })
        .catch((e) => {
          if ((e as Error).name !== 'AbortError') setLocated((p) => ({ ...p, [d]: 'failed' }))
        })
    })
    return () => ctrls.forEach((c) => c.abort())
  }, [results, url])

  const report = useMemo(() => {
    if (!results) return null
    const failed = results.filter((r) => !r.passed)
    const areas = LEVERS.map((l) => {
      const items = results.filter((r) => lever(r) === l.id)
      return { ...l, total: items.length, passed: items.filter((r) => r.passed).length }
    }).filter((l) => l.total > 0)
    const num = new Map(failed.map((r, i) => [r.ruleId, i + 1])) // one number per finding, in list order
    const easyHigh = failed.filter((r) => r.checkpoint?.priority === 'High' && r.checkpoint?.difficulty === 'Easy').length
    return { failed, passed: results.length - failed.length, total: results.length, score: scoreOf(results), areas, num, easyHigh }
  }, [results])

  const host = hostOf(url)
  const qualified = isQualified(revenueBand)
  const view = located[device]
  const shot = view && typeof view === 'object' ? view : null

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // a pin opens its check; a check scrolls the page view to its pin
  const pick = (id: string, from: 'pin' | 'list') => {
    setSelected(id)
    if (!results) return
    if (from === 'pin') {
      const idx = results.findIndex((r) => r.ruleId === id)
      if (idx >= visible) setVisible(idx + 1)
      setOpen((prev) => new Set(prev).add(id))
      requestAnimationFrame(() => document.getElementById(`f-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
    } else if (shot && shotRef.current) {
      const pin = shot.pins.find((p) => p.findingId === id)
      if (pin) {
        const el = shotRef.current
        const y = (pin.box.y / shot.height) * el.scrollHeight - el.clientHeight / 3
        el.scrollTo({ top: Math.max(0, y), behavior: 'smooth' })
      }
    }
  }

  if (!results || !report) {
    return (
      <main className="cxo-page">
        <a className="cxo-logo" href="https://cxo.studio" aria-label="CXO studio">
          <img src={asset('/cxo-logo.png')} alt="CXO studio" />
        </a>
        <div className="cxo-head">
          <h1 className="cxo-reveal">No scan yet</h1>
          <p className="cxo-reveal cxo-reveal-1">Start from the questions and we’ll scan your product page.</p>
        </div>
        <div className="mx-auto max-w-[420px]">
          <a className="cxo-btn cxo-btn-primary cxo-btn-block" href="https://cxo.studio/start">
            Find my revenue leaks
          </a>
        </div>
      </main>
    )
  }

  const scoreTone = TONE[tone(report.score / 100)]
  const deskImg = (located.desktop && typeof located.desktop === 'object' ? located.desktop.screenshot : null) || preview.desktop
  const phoneImg = (located.mobile && typeof located.mobile === 'object' ? located.mobile.screenshot : null) || preview.mobile

  return (
    <main className="min-h-screen">
      {/* ── top: on the brand wash ───────────────────────────────────────── */}
      <div className="px-[var(--gutter)] pt-[34px] max-[560px]:pt-[26px]">
        <a className="cxo-logo !mb-10" href="https://cxo.studio" aria-label="CXO studio">
          <img src={asset('/cxo-logo.png')} alt="CXO studio" />
        </a>

        <section className="mx-auto grid max-w-[1120px] items-center gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]" aria-label="Verdict">
          <div className="cxo-reveal flex min-w-0 flex-col gap-5">
            <p className="text-sm font-semibold text-[var(--text-muted)]">
              {host} · Product page · {report.total} checkpoints
            </p>
            <h1 className="font-[family-name:var(--font-display)] text-[clamp(30px,4.2vw,48px)] font-bold leading-[1.1] tracking-[-0.035em] text-[var(--text)]">
              {numbers ? (
                <>
                  Your product page leaves about <span style={{ color: 'var(--result-fail-fg)' }}>{shortEur(numbers.lift10)} a month</span> on the table
                </>
              ) : (
                <>Your product page has {report.failed.length} things to fix</>
              )}
            </h1>
            <p className="text-[17px] leading-[1.6] text-[var(--text-muted)]">
              {report.failed.length} of {report.total} checks failed
              {report.easyHigh > 0 ? `, ${report.easyHigh} of them high-impact and easy. Start there.` : '.'}
              {numbers && ' That figure is what a 10% lift in conversion is worth to you.'}
            </p>

            {/* score + the four areas, compact */}
            <div className="flex flex-wrap items-center gap-6 border-y border-[var(--border)] py-5">
              <div className="flex items-center gap-4">
                <Ring score={report.score} color={scoreTone.fg} />
                <div>
                  <p className="text-[13px] font-semibold text-[var(--text-muted)]">Conversion score</p>
                  <p className="font-[family-name:var(--font-display)] text-[20px] font-bold" style={{ color: scoreTone.fg }}>
                    {scoreTone.word}
                  </p>
                </div>
              </div>
              <div className="grid min-w-[240px] flex-1 grid-cols-2 gap-x-5 gap-y-3">
                {report.areas.map((a) => {
                  const t = TONE[tone(a.passed / a.total)]
                  return (
                    <div key={a.id} className="min-w-0">
                      <div className="flex items-baseline justify-between gap-2 text-[13px]">
                        <span className="truncate font-semibold text-[var(--text)]">{a.label}</span>
                        <span className="tabular-nums font-semibold" style={{ color: t.fg }}>
                          {a.passed}/{a.total}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--surface-muted)]">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ background: t.fg }}
                          initial={{ width: 0 }}
                          animate={{ width: `${(a.passed / a.total) * 100}%` }}
                          transition={{ duration: 1.2, ease: [0.4, 0, 0.2, 1] }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <a href="#checks" className="cxo-btn cxo-btn-primary">
                See what to fix <Arrow />
              </a>
              {qualified && (
                <a href={CALL_URL} className="cxo-btn cxo-btn-ghost">
                  Book my CRO Audit call
                </a>
              )}
            </div>
          </div>

          <Devices desktop={deskImg} mobile={phoneImg} />
        </section>
      </div>

      {/* ── the rest: plain white, like the website ─────────────────────── */}
      <div className="relative mt-14 bg-[var(--surface)]">
        <div aria-hidden="true" className="absolute inset-x-0 -top-24 h-24 bg-gradient-to-b from-transparent to-[var(--surface)]" />
        <div className="relative mx-auto flex max-w-[1120px] flex-col gap-[var(--space-20)] px-[var(--gutter)] pb-[var(--section-y)] pt-8 max-[560px]:gap-14">
          {/* fix these first: the top 3 of the list, same numbers */}
          {report.failed.length > 0 && (
            <section aria-label="Fix these first">
              <h2 className="mb-6 font-[family-name:var(--font-display)] text-[28px] font-bold tracking-[-0.03em] text-[var(--text)]">Fix these first</h2>
              <div className="grid gap-x-8 gap-y-6 md:grid-cols-3">
                {report.failed.slice(0, 3).map((r) => (
                  <button key={r.ruleId} type="button" onClick={() => pick(r.ruleId, 'pin')} className="flex flex-col gap-3 border-t-2 border-[var(--text)] pt-5 text-left">
                    <span className="flex items-center gap-2.5">
                      <Num n={report.num.get(r.ruleId)!} />
                      <span className="text-xs font-semibold text-[var(--text-muted)]">
                        {effortLabel(r)} · moves {LEVERS.find((l) => l.id === lever(r))?.moves}
                      </span>
                    </span>
                    <span className="font-[family-name:var(--font-display)] text-[18px] font-bold leading-[1.3] tracking-[-0.02em] text-[var(--text)]">{r.ruleTitle}</span>
                    <span className="line-clamp-3 text-[15px] leading-[1.55] text-[var(--text-muted)]">{r.reason}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* every check, next to the page it was checked on */}
          <section id="checks" className="scroll-mt-6" aria-label="Your page, check by check">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="font-[family-name:var(--font-display)] text-[28px] font-bold tracking-[-0.03em] text-[var(--text)]">Your page, check by check</h2>
                <p className="mt-1 text-sm text-[var(--text-muted)]">
                  <span className="font-semibold" style={{ color: 'var(--result-fail-fg)' }}>
                    {report.failed.length} to fix
                  </span>{' '}
                  ·{' '}
                  <span className="font-semibold" style={{ color: 'var(--result-pass-fg)' }}>
                    {report.passed} passed
                  </span>
                  {shot && shot.pins.length > 0 && ` · ${shot.pins.length} pinned on your page`}
                </p>
              </div>
              <div role="group" aria-label="Device" className="inline-flex gap-0.5 rounded-full bg-[var(--surface-muted)] p-[3px]">
                {(['desktop', 'mobile'] as Device[]).map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDevice(d)}
                    aria-pressed={device === d}
                    className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors ${device === d ? 'bg-[var(--surface)] text-[var(--text)] shadow-[0_1px_2px_rgba(9,9,11,.12)]' : 'text-[var(--text-muted)]'}`}
                  >
                    {d === 'desktop' ? <MonitorIcon /> : <PhoneIcon />}
                    {d === 'desktop' ? 'Desktop' : 'Mobile'}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              {/* the page with pins: first on phones, sticky on desktop */}
              <div className="lg:sticky lg:top-6 lg:order-2">
                <PageView
                  device={device}
                  state={view}
                  fallback={device === 'desktop' ? preview.desktop : preview.mobile}
                  url={url}
                  num={report.num}
                  selected={selected}
                  onPin={(id) => pick(id, 'pin')}
                  scrollRef={shotRef}
                />
              </div>

              <div className="relative min-w-0 lg:order-1">
                <div className="flex flex-col gap-2">
                  {results.slice(0, visible).map((r) => {
                    const isOpen = open.has(r.ruleId)
                    const t = r.passed ? 'pass' : 'fail'
                    const n = report.num.get(r.ruleId)
                    const active = selected === r.ruleId
                    return (
                      <div
                        key={r.ruleId}
                        id={`f-${r.ruleId}`}
                        className={`scroll-mt-6 overflow-hidden rounded-[var(--radius-md)] border transition-colors ${active || isOpen ? 'border-[var(--text)]' : 'border-[var(--border)]'}`}
                        style={{ ['--result-fg' as string]: `var(--result-${t}-fg)`, ['--result-bg' as string]: `var(--result-${t}-bg)` }}
                      >
                        <button
                          type="button"
                          className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
                          onClick={() => {
                            toggle(r.ruleId)
                            if (!r.passed) pick(r.ruleId, 'list')
                          }}
                          aria-expanded={isOpen}
                        >
                          {r.passed ? <Pass /> : <Num n={n!} />}
                          <span className="min-w-0 flex-1 text-[15px] font-semibold leading-[1.4] text-[var(--text)]">{r.ruleTitle}</span>
                          {!r.passed && r.checkpoint?.priority && (
                            <span className="shrink-0 text-xs text-[var(--text-muted)] max-[560px]:hidden">{effortLabel(r)}</span>
                          )}
                          <ChevronDown className={`h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden />
                        </button>
                        {isOpen && (
                          <div className="px-3 pb-3">
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
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-36 items-end justify-center bg-gradient-to-b from-transparent to-[var(--surface)]">
                    <button type="button" onClick={() => setVisible((v) => v + 12)} className="cxo-btn cxo-btn-primary pointer-events-auto !px-7">
                      Load more results
                    </button>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* what fixing it is worth, and the one next step that fits */}
          {numbers && (
            <section className="grid items-center gap-8 rounded-[var(--radius-xl)] bg-[var(--bg-subtle)] p-6 sm:p-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]" aria-label="What fixing this is worth">
              <div className="flex min-w-0 flex-col gap-3">
                <p className="text-sm font-semibold text-[var(--text-muted)]">What fixing this is worth</p>
                <h2 className="font-[family-name:var(--font-display)] text-[clamp(24px,3vw,32px)] font-bold leading-[1.2] tracking-[-0.03em] text-[var(--text)]">
                  A 10% lift in conversion is about {eur(numbers.lift10)} more a month. {eur(numbers.lift10 * 12)} a year.
                </h2>
                <p className="text-sm leading-[1.6] text-[var(--text-muted)]">
                  From your answers: about {eur(numbers.revenue)} a month
                  {numbers.aov ? `, ${eur(numbers.aov)} orders` : ''}
                  {numbers.cr ? `, ${(numbers.cr * 100).toFixed(1)}% conversion${numbers.crIsBenchmark ? ' (average)' : ''}` : ''}. A rough estimate, not a promise.
                </p>
              </div>
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-3 gap-2">
                  {[0.05, 0.1, 0.15].map((k) => (
                    <div
                      key={k}
                      className="rounded-[var(--radius-md)] border p-3.5 text-center"
                      style={k === 0.1 ? { background: 'var(--result-pass-bg)', borderColor: 'var(--result-pass-fg)' } : { background: 'var(--surface)', borderColor: 'var(--border)' }}
                    >
                      <p className="text-xs text-[var(--text-muted)]">+{k * 100}% conversion</p>
                      <p className="mt-1 text-[18px] font-bold" style={{ color: k === 0.1 ? 'var(--result-pass-fg)' : 'var(--text)' }}>
                        +{shortEur(numbers.revenue * k)}
                      </p>
                    </div>
                  ))}
                </div>
                {qualified ? (
                  <>
                    <a href={CALL_URL} className="cxo-btn cxo-btn-primary cxo-btn-block">
                      Book my CRO Audit call <Arrow />
                    </a>
                    <p className="text-center text-[13px] text-[var(--text-muted)]">30 minutes with Louis. We price every leak with you.</p>
                  </>
                ) : (
                  <>
                    <a href={CHECKLIST_URL} className="cxo-btn cxo-btn-primary cxo-btn-block">
                      Get the full CRO checklist <Arrow />
                    </a>
                    <p className="text-center text-[13px] text-[var(--text-muted)]">At your size, an audit wouldn’t pay for itself yet. Fix the quick wins yourself first.</p>
                  </>
                )}
              </div>
            </section>
          )}

          <NextStep plain />
        </div>
      </div>
    </main>
  )
}

/* ── pieces ──────────────────────────────────────────────────────────── */

function Ring({ score, color }: { score: number; color: string }) {
  const r = 30
  const c = 2 * Math.PI * r
  return (
    <div className="relative h-[76px] w-[76px] shrink-0">
      <svg width="76" height="76" viewBox="0 0 76 76" role="img" aria-label={`Conversion score ${score} out of 100`}>
        <circle cx="38" cy="38" r={r} fill="none" strokeWidth="7" style={{ stroke: 'var(--surface-muted)' }} />
        <motion.circle
          cx="38"
          cy="38"
          r={r}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          transform="rotate(-90 38 38)"
          style={{ stroke: color }}
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - score / 100) }}
          transition={{ duration: 1.4, ease: [0.4, 0, 0.2, 1] }}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center font-[family-name:var(--font-display)] text-[24px] font-extrabold tracking-[-0.03em] text-[var(--text)]">{score}</span>
    </div>
  )
}

/** The scanned page in a laptop and a phone, both cut off with a fade at the bottom. */
function Devices({ desktop, mobile }: { desktop: string | null; mobile: string | null }) {
  const fade = { WebkitMaskImage: 'linear-gradient(180deg, #000 62%, transparent 100%)', maskImage: 'linear-gradient(180deg, #000 62%, transparent 100%)' }
  return (
    <div className="cxo-reveal cxo-reveal-1 relative mx-auto w-full max-w-[560px] pb-4 pr-[12%]" aria-hidden={!desktop && !mobile}>
      <div style={fade}>
        <div className="overflow-hidden rounded-t-[18px] border-[10px] border-b-0 border-[var(--text)] bg-[var(--text)]">
          <div className="h-[340px] overflow-hidden rounded-t-[6px] bg-[var(--surface-muted)] max-[560px]:h-[220px]">
            {desktop ? <img src={desktop} alt="Your product page on desktop" className="block w-full object-cover object-top" /> : null}
          </div>
        </div>
      </div>
      {mobile && (
        <div className="absolute bottom-0 right-0 w-[30%] min-w-[110px]" style={fade}>
          <div className="overflow-hidden rounded-[26px] border-[7px] border-[var(--text)] bg-[var(--text)] shadow-[0_24px_48px_-18px_rgba(9,9,11,.35)]">
            <div className="h-[300px] overflow-hidden rounded-[18px] bg-[var(--surface)] max-[560px]:h-[210px]">
              <img src={mobile} alt="Your product page on a phone" className="block w-full object-cover object-top" />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PageView({
  device,
  state,
  fallback,
  url,
  num,
  selected,
  onPin,
  scrollRef,
}: {
  device: Device
  state: LocateState
  fallback: string | null
  url: string
  num: Map<string, number>
  selected: string | null
  onPin: (id: string) => void
  scrollRef: React.MutableRefObject<HTMLDivElement | null>
}) {
  const shot = state && typeof state === 'object' ? state : null
  const frame =
    device === 'desktop'
      ? 'rounded-[var(--radius-lg)] border border-[var(--border-strong)]'
      : 'mx-auto max-w-[340px] rounded-[30px] border-[8px] border-[var(--text)]'
  return (
    <div className={`overflow-hidden bg-[var(--surface)] ${frame}`}>
      {device === 'desktop' && (
        <div className="flex items-center gap-1.5 border-b border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2">
          <span className="h-2 w-2 rounded-full bg-[var(--border-strong)]" />
          <span className="h-2 w-2 rounded-full bg-[var(--border-strong)]" />
          <span className="h-2 w-2 rounded-full bg-[var(--border-strong)]" />
          <span className="ml-2 min-w-0 truncate text-xs text-[var(--text-muted)]">{url}</span>
        </div>
      )}
      <div ref={scrollRef} className={`relative overflow-y-auto ${device === 'desktop' ? 'max-h-[640px]' : 'max-h-[600px]'} max-[560px]:max-h-[460px]`}>
        {shot ? (
          <div className="relative">
            <img src={shot.screenshot} alt={`Your product page on ${device}, with the findings pinned`} className="block w-full" />
            {shot.pins.map((p) => {
              const n = num.get(p.findingId)
              if (!n) return null
              const same = shot.pins.filter((q) => q.box.x === p.box.x && q.box.y === p.box.y)
              const k = same.indexOf(p)
              const on = selected === p.findingId
              return (
                <span key={p.findingId}>
                  {(k === 0 || on) && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute rounded-[6px] transition-all"
                      style={{
                        left: `${(p.box.x / shot.width) * 100}%`,
                        top: `${(p.box.y / shot.height) * 100}%`,
                        width: `${(p.box.w / shot.width) * 100}%`,
                        height: `${(p.box.h / shot.height) * 100}%`,
                        border: `${on ? 3 : 2}px solid var(--result-fail-fg)`,
                        background: on ? 'color-mix(in srgb, var(--result-fail-fg) 10%, transparent)' : 'transparent',
                      }}
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => onPin(p.findingId)}
                    aria-label={`Finding ${n}`}
                    className="absolute grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-[3px] font-bold shadow-[var(--shadow-raised)] transition-transform hover:scale-110"
                    style={{
                      left: `min(calc(${((p.box.x + p.box.w) / shot.width) * 100}% - ${k * 24}px), calc(100% - 16px))`,
                      top: `max(${(p.box.y / shot.height) * 100}%, 14px)`,
                      width: on ? 34 : 28,
                      height: on ? 34 : 28,
                      fontSize: on ? 14 : 13,
                      background: 'var(--result-fail-fg)',
                      color: 'var(--text-inverse)',
                      borderColor: 'var(--surface)',
                      zIndex: on ? 3 : 2,
                    }}
                  >
                    {n}
                  </button>
                </span>
              )
            })}
          </div>
        ) : (
          <div className="relative">
            {fallback ? (
              <img src={fallback} alt={`Your product page on ${device}`} className={`block w-full ${state === 'loading' ? 'opacity-60' : ''}`} />
            ) : (
              <div className="grid aspect-[4/3] place-items-center text-sm text-[var(--text-muted)]">{state === 'loading' ? '' : 'Preview unavailable'}</div>
            )}
            {state === 'loading' && (
              <span className="absolute left-1/2 top-24 -translate-x-1/2 whitespace-nowrap rounded-full bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--text)] shadow-[var(--shadow-raised)]">
                Pinning the findings on your page…
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Num({ n }: { n: number }) {
  return (
    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold" style={{ background: 'var(--result-fail-fg)', color: 'var(--text-inverse)' }} aria-label={`To fix, number ${n}`} role="img">
      {n}
    </span>
  )
}

function Pass() {
  return (
    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full" style={{ background: 'var(--result-pass-fg)', color: 'var(--text-inverse)' }} aria-label="Passed" role="img">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m5 12.5 4.5 4.5L19 7.5" />
      </svg>
    </span>
  )
}

const MonitorIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="12" rx="1.5" />
    <path d="M8 20h8M12 16v4" />
  </svg>
)
const PhoneIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="7" y="2.5" width="10" height="19" rx="2" />
    <path d="M11 18.5h2" />
  </svg>
)
