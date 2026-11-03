'use client'

import { useState, useEffect, useMemo, useSyncExternalStore } from 'react'
import { motion } from 'framer-motion'
import { X, ChevronDown } from 'lucide-react'
import { z } from 'zod'
import { CheckpointResultBody } from '../components/CheckpointResultBody'
import { NextStep } from '../components/NextStep'
import type { CheckpointPresentation } from '../components/CheckpointResultBody'
import { asset } from '@/lib/base'
import { estimate, eur, num, type Estimate } from '@/lib/estimate'

const barEase = [0.4, 0, 0.2, 1] as const
const previewEase = [0.4, 0, 0.2, 1] as const

/** Tailwind `sm` = 640px — no motion / CSS transitions on results UI below this width. */
const MOBILE_MAX_WIDTH_QUERY = '(max-width: 639px)'

function subscribeMobileLayout(callback: () => void) {
  const mq = window.matchMedia(MOBILE_MAX_WIDTH_QUERY)
  mq.addEventListener('change', callback)
  return () => mq.removeEventListener('change', callback)
}

function getMobileLayoutSnapshot() {
  return window.matchMedia(MOBILE_MAX_WIDTH_QUERY).matches
}

function useIsMobileLayoutNoTransitions() {
  return useSyncExternalStore(subscribeMobileLayout, getMobileLayoutSnapshot, () => false)
}

interface ScanResult {
  ruleId: string
  ruleTitle: string
  passed: boolean
  reason: string
  checkpoint?: CheckpointPresentation
}

function hostnameFromUrl(raw: string): string {
  if (!raw.trim()) return ''
  try {
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    return new URL(href).hostname.replace(/^www\./, '')
  } catch {
    return raw.replace(/^https?:\/\//i, '').split('/')[0] ?? raw
  }
}

export default function ScannerPage() {
  const [results, setResults] = useState<ScanResult[] | null>(null)
  const [url, setUrl] = useState('')
  const [expandedRules, setExpandedRules] = useState<Set<string>>(new Set())
  const [visibleCount, setVisibleCount] = useState(8)
  const [desktopPreview, setDesktopPreview] = useState<string | null>(null)
  const [mobilePreview, setMobilePreview] = useState<string | null>(null)
  /** true when the capture was blocked/errored → show the static placeholder image */
  const [previewUnavailable, setPreviewUnavailable] = useState<boolean>(false)
  const [showScrollToggle, setShowScrollToggle] = useState(false)
  const [isAtTop, setIsAtTop] = useState(true)
  const [numbers, setNumbers] = useState<Estimate | null>(null)

  const mobileNoTx = useIsMobileLayoutNoTransitions()

  const previewContainerVariants = useMemo(
    () => ({
      hidden: {},
      show: {
        transition: mobileNoTx
          ? { staggerChildren: 0, delayChildren: 0 }
          : { staggerChildren: 0.16, delayChildren: 0.08 },
      },
    }),
    [mobileNoTx],
  )

  const previewItemVariants = useMemo(
    () => ({
      hidden: mobileNoTx ? { opacity: 1, y: 0 } : { opacity: 0, y: 22 },
      show: {
        opacity: 1,
        y: 0,
        transition: mobileNoTx
          ? { duration: 0 }
          : { duration: 0.75, ease: previewEase },
      },
    }),
    [mobileNoTx],
  )

  const greenBarTransition = mobileNoTx ? { duration: 0 } : { duration: 1.75, ease: barEase }
  const redBarTransition = mobileNoTx
    ? { duration: 0 }
    : { duration: 1.55, ease: barEase, delay: 0.45 }

  useEffect(() => {
    loadResults()
  }, [])

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY
      setShowScrollToggle(y > 20)
      setIsAtTop(y < 80)
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()

    return () => {
      window.removeEventListener('scroll', onScroll)
    }
  }, [])

  const loadResults = () => {
    try {
      setNumbers(
        estimate(
          localStorage.getItem('scanRevenue') || '',
          localStorage.getItem('scanAov') || '',
          localStorage.getItem('scanCr') || '',
        ),
      )
      const storedUrl = localStorage.getItem('scanUrl')
      if (storedUrl) {
        setUrl(storedUrl)
      }

      const storedResults = localStorage.getItem('scanResults')
      if (storedResults) {
        const parsed = z
          .array(
            z.object({
              ruleId: z.string(),
              ruleTitle: z.string(),
              passed: z.boolean(),
              reason: z.string(),
              checkpoint: z
                .object({
                  requiredActions: z.string(),
                  justificationsBenefits: z.string(),
                  examples: z.array(
                    z.object({
                      url: z.string(),
                      filename: z.string(),
                      thumbnailUrl: z.string(),
                    }),
                  ),
                })
                .optional(),
            }),
          )
          .parse(JSON.parse(storedResults))
        // findings first: that's what the visitor came for
        setResults([...parsed.filter((r) => !r.passed), ...parsed.filter((r) => r.passed)])
      }

      const lastScreenshot = sessionStorage.getItem('lastScreenshot')
      const scanDesktop =
        sessionStorage.getItem('scanPreviewDesktop') ?? localStorage.getItem('scanPreviewDesktop')
      const scanMobile =
        sessionStorage.getItem('scanPreviewMobile') ?? localStorage.getItem('scanPreviewMobile')
      // Prefer analyze-step preview (top-of-page viewport); batch AI screenshots are often mid-page.
      setDesktopPreview(scanDesktop || lastScreenshot || null)
      setMobilePreview(scanMobile && scanMobile.length > 0 ? scanMobile : null)
      setPreviewUnavailable(sessionStorage.getItem('previewUnavailable') === '1')
    } catch (error) {
      console.error('Error loading scanner data:', error)
      setResults(null)
    }
  }


  const toggleRule = (ruleId: string) => {
    setExpandedRules(prev => {
      const newSet = new Set(prev)
      if (newSet.has(ruleId)) {
        newSet.delete(ruleId)
      } else {
        newSet.add(ruleId)
      }
      return newSet
    })
  }

  const loadMore = () => {
    setVisibleCount(prev => prev + 8)
  }

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const scrollToBottom = () => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' })
  }

  const visibleResults = results ? results.slice(0, visibleCount) : []
  const hasMore = results ? visibleCount < results.length : false
  const passedCount = results ? results.filter(r => r.passed).length : 0
  const failedCount = results ? results.filter(r => !r.passed).length : 0
  const totalCount = results ? results.length : 0
  const failRatio = totalCount > 0 ? failedCount / totalCount : 0
  const passRatio = totalCount > 0 ? passedCount / totalCount : 0
  const remainingRatio = totalCount > 0 ? Math.max(0, 1 - passRatio) : 0
  const scanHost = hostnameFromUrl(url)
  const mobilePreviewSrc = mobilePreview || desktopPreview

  const score = totalCount ? Math.round(passRatio * 100) : 0
  void showScrollToggle; void isAtTop; void scrollToTop; void scrollToBottom; void failRatio; void remainingRatio
  void greenBarTransition; void redBarTransition

  return (
    <main className="cxo-page">
      <a className="cxo-logo" href="https://cxo.studio" aria-label="CXO studio">
        <img src={asset('/cxo-logo.png')} alt="CXO studio" />
      </a>

      <div className="cxo-head">
        <h1 className="cxo-reveal">{results ? 'Your scan results' : 'No scan yet'}</h1>
        <p className="cxo-reveal cxo-reveal-1">
          {results ? (
            <>
              {scanHost && <strong className="font-semibold text-[var(--text)]">{scanHost}</strong>}
              {scanHost && ' · '}
              {failedCount} finding{failedCount === 1 ? '' : 's'} on {totalCount} conversion checkpoints
            </>
          ) : (
            'Start from the questions and we’ll scan your product page.'
          )}
        </p>
      </div>

      {!results ? (
        <div className="cxo-card cxo-reveal cxo-reveal-2 mx-auto max-w-[720px]">
          <a className="cxo-btn cxo-btn-primary cxo-btn-block" href="https://cxo.studio/start">Find my revenue leaks</a>
        </div>
      ) : (
        <div className="mx-auto flex w-full min-w-0 max-w-[880px] flex-col gap-6">
          {/* score + the store's numbers */}
          <div className={`grid min-w-0 gap-6 ${numbers ? 'md:grid-cols-2' : ''}`}>
            <section className="cxo-card cxo-reveal cxo-reveal-2 min-w-0" aria-label="Score">
              <p className="cxo-q !mb-2">Conversion score</p>
              <p className="font-[family-name:var(--font-display)] text-[56px] font-bold leading-none tracking-[-0.03em] text-[var(--text)]">
                {score}<span className="text-[28px] text-[var(--text-subtle)]">/100</span>
              </p>
              <div className="cxo-progress mt-5" aria-hidden="true">
                <motion.span initial={{ width: 0 }} animate={{ width: `${score}%` }} transition={greenBarTransition} />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="cxo-pill is-fail">{failedCount} to fix</span>
                <span className="cxo-pill is-pass">{passedCount} passed</span>
              </div>
            </section>

            {numbers && (
              <section className="cxo-card cxo-reveal cxo-reveal-3 min-w-0" aria-label="Your numbers">
                <p className="cxo-q !mb-4">Your numbers</p>
                <dl className="grid grid-cols-2 gap-4">
                  {numbers.rpv !== undefined && <Stat label="Revenue per visitor" value={eur(numbers.rpv, 2)} />}
                  {numbers.visitors !== undefined && <Stat label="Visitors per month" value={num(numbers.visitors)} />}
                  {numbers.aov !== undefined && <Stat label="Average order value" value={eur(numbers.aov)} />}
                  {numbers.cr !== undefined && (
                    <Stat label={numbers.crIsBenchmark ? 'Conversion rate (average)' : 'Conversion rate'} value={`${(numbers.cr * 100).toFixed(1)}%`} />
                  )}
                  {numbers.aov === undefined && <Stat label="Monthly revenue" value={eur(numbers.revenue)} />}
                </dl>
                <p className="mt-5 rounded-[var(--radius-md)] bg-[var(--bg-subtle)] px-4 py-3 text-sm leading-[1.5] text-[var(--text)]">
                  A 10% lift in conversion rate is worth about <strong>{eur(numbers.lift10)} a month</strong>.
                </p>
                <p className="mt-2 text-xs text-[var(--text-muted)]">Rough estimate from the ranges you picked.</p>
              </section>
            )}
          </div>

          {/* what the scanner saw */}
          {url && (desktopPreview || previewUnavailable) && (
            <section className="cxo-card min-w-0 !p-4 sm:!p-6" aria-label="Scanned page">
              <div className="relative">
                <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface-muted)]">
                  <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2">
                    <span className="min-w-0 flex-1 truncate rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs text-[var(--text-muted)]">
                      {url.startsWith('http') ? url : `https://${url}`}
                    </span>
                  </div>
                  <div className="relative aspect-[16/10] w-full overflow-hidden">
                    <img
                      src={previewUnavailable ? asset('/preview-unavailable.svg') : (desktopPreview as string)}
                      alt="Desktop view of the scanned page"
                      className="absolute inset-0 h-full w-full object-cover object-top"
                    />
                  </div>
                </div>
                {mobilePreviewSrc && !previewUnavailable && (
                  <div className="absolute -bottom-3 right-3 w-[26%] max-w-[170px] overflow-hidden rounded-[var(--radius-lg)] border-4 border-[var(--surface)] bg-[var(--surface)] shadow-[var(--shadow-raised)] max-[560px]:hidden">
                    <img src={mobilePreviewSrc} alt="Mobile view of the scanned page" className="block max-h-[300px] w-full object-cover object-top" loading="lazy" />
                  </div>
                )}
              </div>
            </section>
          )}

          {/* checkpoints, findings first */}
          <section className="cxo-card min-w-0" aria-label="Checkpoints">
            <p className="cxo-q">What we found</p>
            <div className="relative">
              <div className="cxo-rows">
                {visibleResults.map((result) => {
                  const open = expandedRules.has(result.ruleId)
                  const tone = result.passed ? 'pass' : 'fail'
                  return (
                    <div
                      key={result.ruleId}
                      className={`overflow-hidden rounded-[var(--radius-md)] border bg-[var(--surface)] ${open ? 'border-[var(--border-strong)]' : 'border-[var(--border)]'}`}
                      style={{ ['--result-fg' as string]: `var(--result-${tone}-fg)`, ['--result-bg' as string]: `var(--result-${tone}-bg)` }}
                    >
                      <button type="button" className="cxo-row !rounded-none !border-0 !bg-transparent" onClick={() => toggleRule(result.ruleId)} aria-expanded={open}>
                        <Verdict passed={result.passed} />
                        <span className="cxo-row-text"><span className="cxo-row-label text-[15px] leading-[1.4]">{result.ruleTitle}</span></span>
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-[var(--border)]">
                          <ChevronDown className={`h-4 w-4 text-[var(--text)] transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
                        </span>
                      </button>
                      {open && (
                        <div className="px-3 pb-3 sm:px-4 sm:pb-4">
                          <div className="rounded-[var(--radius-md)] bg-[var(--result-bg)] p-4 sm:p-5">
                            {result.checkpoint ? (
                              <CheckpointResultBody checkpoint={result.checkpoint} passed={result.passed} />
                            ) : (
                              <>
                                <p className="mb-1.5 font-[family-name:var(--font-display)] text-[17px] font-bold text-[var(--result-fg)]">
                                  {result.passed ? 'Why it passed:' : 'Why it needs fixing:'}
                                </p>
                                <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed text-[var(--text)]">{result.reason}</p>
                              </>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              {hasMore && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-40 items-end justify-center bg-gradient-to-b from-transparent to-[var(--surface)] pb-1">
                  <button type="button" onClick={loadMore} className="cxo-btn cxo-btn-primary pointer-events-auto !px-7">
                    Load more results
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* one next step, chosen from the revenue band (see NextStep) */}
          <NextStep />
        </div>
      )}
    </main>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-[var(--text-muted)]">{label}</dt>
      <dd className="mt-1 font-[family-name:var(--font-display)] text-[22px] font-bold tracking-[-0.02em] text-[var(--text)]">≈ {value}</dd>
    </div>
  )
}
function Verdict({ passed }: { passed: boolean }) {
  return (
    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full" style={{ background: `var(--result-${passed ? 'pass' : 'fail'}-fg)`, color: 'var(--text-inverse)' }} aria-label={passed ? 'Passed' : 'To fix'} role="img">
      {passed ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M12 6v8M12 18.5h.01" /></svg>
      )}
    </span>
  )
}
function FindingIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: 'var(--status-finding-fg)' }}>
      <circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5h.01" />
    </svg>
  )
}
function PassIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  )
}
