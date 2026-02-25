'use client'

import { useState, useEffect } from 'react'
import { usePathname } from "next/navigation";
import { Check, X, ChevronDown, AlertCircle } from 'lucide-react';
import { z } from 'zod'
import { motion } from 'framer-motion'

interface ScanResult {
  ruleId: string
  ruleTitle: string
  passed: boolean
  reason: string
}

export default function ScannerPage() {
  const [results, setResults] = useState<ScanResult[] | null>(null)
  const [url, setUrl] = useState('')
  const [mounted, setMounted] = useState(false)
  const [expandedRules, setExpandedRules] = useState<Set<string>>(new Set())
  const [visibleCount, setVisibleCount] = useState(8)
  const [websiteScreenshot, setWebsiteScreenshot] = useState<string | null>(null)
  const [iframeError, setIframeError] = useState<boolean>(false)
  const pathname = usePathname();

  useEffect(() => {
    setMounted(true)
    loadResults()
  }, [])

  const loadResults = () => {
    const storedResults = localStorage.getItem('scanResults')
    const storedUrl = localStorage.getItem('scanUrl')

    if (storedResults) {
      try {
        const parsed = z.array(z.object({
          ruleId: z.string(),
          ruleTitle: z.string(),
          passed: z.boolean(),
          reason: z.string(),
        })).parse(JSON.parse(storedResults))

        setResults(parsed)
        if (storedUrl) {
          setUrl(storedUrl)
        }
      } catch (error) {
        console.error('Error loading results:', error)
        setResults(null)
      }
    }

    // Try to load screenshot from last batch (stored in sessionStorage during scan)
    try {
      const lastScreenshot = sessionStorage.getItem('lastScreenshot')
      if (lastScreenshot) {
        setWebsiteScreenshot(lastScreenshot)
      }
    } catch (e) {
      console.warn('Could not load screenshot from sessionStorage:', e)
      setWebsiteScreenshot(null)
    }
  }


  const toggleRule = (ruleId: string) => {
    ``
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
  const totalCount = results ? results.length : 0

  return (
    <main className="flex items-center justify-center md:px-4 bg-[#FDFDFD] min-h-screen w-full overflow-x-hidden">
      <div className="max-w-[1000px] w-full mx-auto px-4 sm:px-6">
        {/* Logo */}
        <div className="text-center my-[34px]">
          <img src="/cxo_studio_logo.png" alt="logo" className="mx-auto w-[117.54px] object-cover" />
        </div>

        {/* Title */}
        <h2 className="text-[33px] leading-[48px] font-bold text-black text-center mb-4">
          Your results are in!
        </h2>

        {/* Desktop browser preview only */}
        {url && (
          <div className="mb-8 rounded-2xl overflow-hidden p-4 sm:p-5">
            <div className="flex justify-center">
              {/* Desktop - browser window: traffic lights, address bar, site content */}
              <div className="w-full max-w-2xl h-[400px]">
                <div className="rounded-lg overflow-hidden bg-[#2a2a2d] border border-[#3f3f46] shadow-xl h-full flex flex-col">
                  {/* Title bar: traffic lights */}
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-[#3f3f46] bg-[#2a2a2d] shrink-0 relative z-10">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#ef4444]" />
                    <span className="w-2.5 h-2.5 rounded-full bg-[#eab308]" />
                    <span className="w-2.5 h-2.5 rounded-full bg-[#22c55e]" />
                  </div>
                  {/* Address bar - site looks like it's open in browser */}
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-[#3f3f46] bg-[#2a2a2d] shrink-0">
                    <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#18181b] border border-[#3f3f46] text-zinc-400 text-xs font-medium">
                      <svg className="w-3.5 h-3.5 shrink-0 text-zinc-500" viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" /></svg>
                      <span className="truncate">{url.startsWith('http') ? url : `https://${url}`}</span>
                    </div>
                  </div>
                  {/* Site content - website loads here inside desktop browser */}
                  <div className="flex-1 min-h-0 overflow-hidden bg-white">
                    {!iframeError ? (
                      <iframe
                        src={`/api/proxy?url=${encodeURIComponent(url.startsWith('http') ? url : `https://${url}`)}`}
                        className="w-full h-full min-h-0 border-0"
                        style={{ blockSize: '100%', minHeight: 0 }}
                        title="Website inside desktop browser"
                        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
                        loading="lazy"
                        onError={() => setIframeError(true)}
                      />
                    ) : websiteScreenshot ? (
                      <img src={websiteScreenshot} alt="Desktop" className="w-full h-full object-cover object-top" />
                    ) : (
                      <div className="w-full h-full bg-[#18181b] flex items-center justify-center text-zinc-500 text-sm">No preview</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <p className="text-sm text-zinc-400 text-center mt-4 font-medium">Analysis complete</p>
          </div>
        )}

        {results && (
          <div className="mt-6">
            <p className="relative text-[15px] leading-[20px] font-semibold text-gray-600 text-center mb-6">
              Scan results for:
              <span className="relative group ml-1">
                <a
                  href={url}
                  target="_blank"
                  className="cursor-pointer text-blue-600"
                  rel="noreferrer"
                >
                  {url.slice(0, 30)}...
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
                  <span className="block break-words">
                    {url}
                  </span>
                </span>
              </span>
            </p>


            {/* Summary Box - Yellow */}
            <div className="bg-[#FFF3CD] rounded-lg p-4 mb-6 border-[1px] border-[#FFC107]">
              <p className="text-base font-semibold text-black text-center m-0">
                {passedCount} of {totalCount} rules passed.
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
                      <div className="mt-4 pt-4 border-t border-gray-200">
                        <div className={`p-3 rounded-lg ${result.passed
                          ? 'bg-green-50'
                          : 'bg-orange-50'
                          }`}>
                          <div className={`flex items-center gap-2 mb-2 ${result.passed ? 'text-green-700' : 'text-orange-700'
                            }`}>
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
                          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap m-0">
                            {result.reason}
                          </p>
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