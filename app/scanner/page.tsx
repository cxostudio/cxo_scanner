'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Check, X, ChevronDown, AlertCircle } from 'lucide-react';
import { z } from 'zod'
import { CheckpointResultBody } from '../components/CheckpointResultBody'
import type { CheckpointPresentation } from '../components/CheckpointResultBody'

/** Slow, smooth bar fill (left → right) */
const barEase = [0.4, 0, 0.2, 1] as const
const greenBarTransition = { duration: 1.75, ease: barEase }
const redBarTransition = { duration: 1.55, ease: barEase, delay: 0.45 }

/** Desktop + mobile preview row — smooth staggered entrance */
const previewEase = [0.4, 0, 0.2, 1] as const
const previewContainerVariants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.16, delayChildren: 0.08 },
  },
}
const previewItemVariants = {
  hidden: { opacity: 0, y: 22 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.75, ease: previewEase },
  },
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

  useEffect(() => {
    loadResults()
  }, [])

  const loadResults = () => {
    try {
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
        setResults(parsed)
      }

      const lastScreenshot = sessionStorage.getItem('lastScreenshot')
      const scanDesktop =
        sessionStorage.getItem('scanPreviewDesktop') ?? localStorage.getItem('scanPreviewDesktop')
      const scanMobile =
        sessionStorage.getItem('scanPreviewMobile') ?? localStorage.getItem('scanPreviewMobile')
      setDesktopPreview(lastScreenshot || scanDesktop || null)
      setMobilePreview(scanMobile && scanMobile.length > 0 ? scanMobile : null)
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

  const visibleResults = results ? results.slice(0, visibleCount) : []
  const hasMore = results ? visibleCount < results.length : false
  const passedCount = results ? results.filter(r => r.passed).length : 0
  const failedCount = results ? results.filter(r => !r.passed).length : 0
  const totalCount = results ? results.length : 0
  const failRatio = totalCount > 0 ? failedCount / totalCount : 0
  const passRatio = totalCount > 0 ? passedCount / totalCount : 0
  const scanHost = hostnameFromUrl(url)
  const mobilePreviewSrc = mobilePreview || desktopPreview

  return (
    <main className="flex items-center justify-center md:px-4 bg-[#FDFDFD] min-h-screen w-full overflow-x-visible">
      <div className="max-w-[1000px] w-full mx-auto px-4 pb-6 sm:px-6 sm:pb-8">
        {/* Logo */}
        <div className="text-center my-[34px]">
          <img src="/cxo_studio_logo.png" alt="logo" className="mx-auto w-[117.54px] object-cover" />
        </div>

        {/* Title */}
        <h2 className="text-[33px] leading-[48px] font-bold text-black text-center mb-4">
          Your results are in!
        </h2>

        {/* Hero preview: desktop canvas + overlapped mobile frame */}
        {url && (
          <div className="relative mb-10 overflow-visible px-2 sm:px-3">
            <div
              className="pointer-events-none absolute inset-x-3 inset-y-3 -z-10 rounded-[2.2rem] bg-gradient-to-br from-zinc-200/70 via-zinc-100/45 to-white/20 blur-2xl sm:inset-x-7"
              aria-hidden
            />
            <motion.div
              className="relative mx-auto flex w-full max-w-[920px] flex-col items-center pt-2 pb-8"
              variants={previewContainerVariants}
              initial="hidden"
              animate="show"
            >
              {/* Desktop browser */}
              <motion.div
                className="relative z-0 w-full max-w-[min(100%,40rem)] shrink-0 sm:min-w-0"
                variants={previewItemVariants}
              >
                <div className="overflow-hidden rounded-[1.8rem] border border-zinc-200/90 bg-white shadow-[0_32px_90px_-22px_rgba(0,0,0,0.22)] ring-1 ring-black/[0.04]">
                  <div className="flex h-10 items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-4">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" aria-hidden />
                    <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" aria-hidden />
                    <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" aria-hidden />
                  </div>
                  <div className="flex items-center gap-2 border-b border-zinc-200 bg-zinc-50/90 px-4 py-2.5">
                    <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-500">
                      <svg className="h-3.5 w-3.5 shrink-0 text-zinc-400" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
                      </svg>
                      <span className="truncate">{url.startsWith('http') ? url : `https://${url}`}</span>
                    </div>
                  </div>
                  <div className="relative aspect-[16/10] w-full overflow-hidden bg-zinc-100">
                    {desktopPreview ? (
                      <img
                        src={desktopPreview}
                        alt="Desktop view of scanned site"
                        className="absolute inset-0 h-full w-full object-cover object-top"
                      />
                    ) : (
                      <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-zinc-400">
                        No desktop capture yet — run a scan from the home page.
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>

              <motion.div
                className="mt-4 w-full max-w-[14.2rem] shrink-0 self-center sm:absolute sm:right-2 sm:top-1/2 sm:z-30 sm:mt-0 sm:max-w-[15.25rem] sm:-translate-y-1/2"
                variants={previewItemVariants}
              >
                <div className="rounded-[2.25rem] border border-zinc-200 bg-white p-2.5 shadow-none ring-1 ring-black/[0.05] ">
                  <div className="overflow-hidden rounded-[1.8rem] bg-white ring-1 ring-zinc-200/90">
                    <div className="flex shrink-0 justify-center border-b border-zinc-100 bg-white px-3 pb-2 pt-3">
                      <div
                        className="h-[1.15rem] w-[4.25rem] rounded-full bg-zinc-900"
                        aria-hidden
                      />
                    </div>
                    <div className="mx-2 min-h-0 overflow-hidden rounded-xl bg-white ring-1 ring-zinc-100 max-h-[420px] overflow-y-scroll hide-scrollbar">
                      {mobilePreviewSrc ? (
                        <img
                          src={mobilePreviewSrc}
                          alt="Mobile view of scanned site"
                          className="h-full w-full bg-white object-contain object-top"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex h-full min-h-[180px] items-center justify-center px-3 text-center text-xs text-zinc-400">
                          Mobile capture unavailable for this run.
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 bg-white px-2 pb-2.5 pt-1.5 text-center">
                      <p className="text-[0.7rem] font-bold leading-tight text-violet-950 sm:text-xs">
                        Mobile view
                      </p>
                      {scanHost ? (
                        <p className="mt-0.5 truncate text-[0.62rem] text-zinc-500" title={url}>
                          {scanHost}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          </div>
        )}

        {results && (
          <div className="mt-6">
            <p className="relative text-[15px] leading-[20px] font-semibold text-[#09090B] text-center mb-6">
              Scan results for:
              <span className="relative group ml-1">
                <a
                  href={url}
                  target="_blank"
                  className="cursor-pointer text-[#09090B]"
                  rel="noreferrer"
                >
                  {url.slice(0, 60)}...
                </a>

                <span
                  className="absolute left-1/2 top-full z-50 mt-3 w-[990px] max-w-[90vw] -translate-x-1/2 
        rounded-lg border border-gray-300
        bg-white p-4
        text-sm text-gray-800
        shadow-xl
        opacity-0 invisible
        transition-all duration-200 ease-out
        group-hover:opacity-100 group-hover:visible
      "
                >
                  <span className="block wrap-break-word">
                    {url}
                  </span>
                </span>
              </span>
            </p>


            {/* Checkpoints bar: green (passed) start / left, red (failed) end / right */}
            <div className="mb-6 rounded-xl border border-zinc-200 bg-zinc-100/90 px-4 py-4 sm:px-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
                <p className="m-0 shrink-0 text-base font-bold text-black">
                  {totalCount} checkpoints:
                </p>
                <div className="relative min-w-0 flex-1" dir="ltr">
                  <div className="flex h-3.5 w-full flex-row overflow-hidden rounded-full bg-zinc-200 shadow-inner">
                    {passRatio > 0 && (
                      <motion.div
                        className="h-full shrink-0 bg-emerald-500"
                        initial={{ width: '0%' }}
                        animate={{ width: `${passRatio * 100}%` }}
                        transition={greenBarTransition}
                      />
                    )}
                    {failRatio > 0 && (
                      <motion.div
                        className="h-full shrink-0 bg-red-500"
                        initial={{ width: '0%' }}
                        animate={{ width: `${failRatio * 100}%` }}
                        transition={redBarTransition}
                      />
                    )}
                  </div>
                  {/* Avatar rides the green→red boundary, moves forward with green fill */}
                  {totalCount > 0 && failRatio > 0 && passRatio > 0 && (
                    <motion.div
                      className="pointer-events-none absolute left-0 top-1/2 z-[1] -translate-x-1/2 -translate-y-1/2"
                      initial={{ left: '0%' }}
                      animate={{ left: `${passRatio * 100}%` }}
                      transition={greenBarTransition}
                    >
                      <motion.div
                        className="h-9 w-9 overflow-hidden rounded-full border-2 border-white bg-zinc-200 shadow-md ring-1 ring-zinc-300"
                        initial={{ opacity: 0, scale: 0.85 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ ...greenBarTransition, delay: 0.12 }}
                      >
                        <img
                          src="/client_first.png"
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      </motion.div>
                    </motion.div>
                  )}
                </div>
              </div>
              <p className="mt-3 mb-0 text-center text-sm text-zinc-600 sm:text-left" dir="ltr">
                <span className="font-semibold text-emerald-700">{passedCount} passed</span>
                <span className="mx-2 text-zinc-400">·</span>
                <span className="font-semibold text-red-600">{failedCount} failed</span>
              </p>
            </div>

            {/* Rules List */}
            <div className="space-y-3 mb-6">
              {visibleResults.map((result) => {
                const isExpanded = expandedRules.has(result.ruleId)
                return (
                  <div
                    key={result.ruleId}
                    className="bg-white rounded-xl border border-gray-200 p-4 cursor-pointer hover:border-gray-300 transition-colors"
                    onClick={() => toggleRule(result.ruleId)}
                  >
                    <div className="flex items-center gap-3">
                      {/* Icon */}
                      <div className="shrink-0">
                        {result.passed ? (
                          <Check className="w-4 h-4 bg-green-500 rounded-full text-white font-bold" />
                        ) : (
                          <AlertCircle className="bg-red-500 rounded-full w-5 h-5 text-white font-bold border-0" />
                        )}
                      </div>

                      {/* Rule Text */}
                      <div className="flex-1">
                        <p className="text-sm  font-semibold text-gray-900 m-0">
                          {result.ruleTitle}
                        </p>
                      </div>

                      {/* Chevron */}
                      <div className="shrink-0 border border-[#E4E4E7] rounded-lg p-1">
                        <ChevronDown
                          className={`w-5 h-5 text-[#09090B] shrink-0 transition-transform ${isExpanded ? 'transform rotate-180' : ''
                            }`}
                        />
                      </div>
                    </div>

                    {/* Expanded Content */}
                    {isExpanded && (
                      <div className="mt-4 border-t border-gray-200 pt-4">
                        <div
                          className={`rounded-lg p-3 ${
                            result.passed ? 'bg-green-50' : 'bg-orange-50'
                          }`}
                        >
                          {result.checkpoint ? (
                            <>
                              <div
                                className={`mb-3 flex items-center gap-2 ${
                                  result.passed ? 'text-green-700' : 'text-orange-800'
                                }`}
                              >
                                {result.passed ? (
                                  <>
                                    <Check size={16} className="shrink-0" />
                                    <strong className="text-sm font-semibold">Details</strong>
                                  </>
                                ) : (
                                  <>
                                    <X size={16} className="shrink-0" />
                                    <strong className="text-sm font-semibold">Details</strong>
                                  </>
                                )}
                              </div>
                              <CheckpointResultBody
                                checkpoint={result.checkpoint}
                                summaryLine={result.reason}
                                passed={result.passed}
                              />
                            </>
                          ) : (
                            <>
                              <div
                                className={`mb-2 flex items-center gap-2 ${
                                  result.passed ? 'text-green-700' : 'text-orange-700'
                                }`}
                              >
                                {result.passed ? (
                                  <>
                                    <Check size={16} className="shrink-0" />
                                    <strong className="text-sm font-semibold">Why it Passed:</strong>
                                  </>
                                ) : (
                                  <>
                                    <X size={16} className="shrink-0" />
                                    <strong className="text-sm font-semibold">Why it Failed:</strong>
                                  </>
                                )}
                              </div>
                              <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                                {result.reason}
                              </p>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Load More Button */}
            {hasMore && (
              <div className="flex justify-center mb-6">
                <button
                  onClick={loadMore}
                  className="w-full py-3 px-6 bg-black text-white rounded-xl font-semibold text-sm hover:bg-gray-800 transition-colors cursor-pointer"
                >
                  Load more results
                </button>
              </div>
            )}
          </div>
        )}

        {!results && (
          <div className="text-center py-12">
            <p className="text-gray-500 text-sm">
              No results found. Please start a scan from the home page.
            </p>
          </div>
        )}
      </div>
    </main >
  )
}
