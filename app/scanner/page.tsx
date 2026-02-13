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
      <div className="max-w-[400px] w-full mx-auto px-4 sm:px-6">
        {/* Logo */}
        <div className="text-center my-[34px]">
          <img src="/cxo_studio_logo.png" alt="logo" className="mx-auto w-[117.54px]  object-cover" />
        </div>

        {/* Title */}
        <h2 className="text-[33px] leading-[48px] font-bold text-black text-center mb-4">
          Your results are in!
        </h2>

        {/* Website Screenshot Preview - iPhone Mobile Mockup */}
        {url && (
          <div className="w-full mb-8">
            {/* iPhone Frame */}
            <div className="relative mx-auto" style={{ width: '280px' }}>
              {/* iPhone Outer Frame */}
              <div className="relative bg-[#1a1a1a] rounded-[3rem] p-2 shadow-2xl">
                {/* iPhone Inner Bezel */}
                <div className="relative bg-black rounded-[2.5rem] p-1 overflow-hidden">
                  {/* Dynamic Island / Notch */}
                  <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20">
                    <div className="bg-black rounded-full h-6 w-24 flex items-center justify-center">
                      {/* Camera dot */}
                      <div className="w-2 h-2 rounded-full bg-[#1a1a1a] ml-6"></div>
                    </div>
                  </div>

                  {/* Screen Container */}
                  <div className="relative bg-white rounded-[2.2rem] overflow-hidden" style={{ height: '380px' }}>
                    {/* Status Bar */}
                    <div className="absolute top-0 left-0 right-0 h-8 bg-white z-10 flex items-center justify-between px-6 pt-1">
                      <span className="text-xs font-semibold text-black">9:41</span>
                      <div className="flex items-center gap-1">
                        <svg className="w-4 h-4 text-black" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 3C7.46 3 3.34 4.78.29 7.67c-.18.18-.29.43-.29.71 0 .28.11.53.29.71l11 11c.39.39 1.02.39 1.41 0l11-11c.18-.18.29-.43.29-.71 0-.28-.11-.53-.29-.71C20.66 4.78 16.54 3 12 3z" />
                        </svg>
                        <svg className="w-4 h-4 text-black" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M15.67 4H14V2h-4v2H8.33C7.6 4 7 4.6 7 5.33v15.33C7 21.4 7.6 22 8.33 22h7.33c.74 0 1.34-.6 1.34-1.33V5.33C17 4.6 16.4 4 15.67 4z" />
                        </svg>
                      </div>
                    </div>

                    {/* Screenshot Content */}
                    <div className="overflow-auto h-full pt-8">
                      {websiteScreenshot ? (
                        <img
                          src={websiteScreenshot}
                          alt="Mobile website preview"
                          className="w-full h-auto block"
                          style={{ maxHeight: 'none' }}
                        />
                      ) : (
                        <div className="h-full flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
                          <div className="text-center px-4">
                            <div className="relative">
                              {/* Animated scanning effect */}
                              <div className="w-14 h-14 mx-auto mb-3 relative">
                                <div className="absolute inset-0 border-4 border-gray-200 rounded-full"></div>
                                <div className="absolute inset-0 border-4 border-t-blue-500 border-r-blue-500 rounded-full animate-spin"></div>
                                <div className="absolute inset-2 bg-blue-500/10 rounded-full animate-pulse"></div>
                              </div>
                            </div>
                            <p className="text-xs text-gray-500 font-medium">Scanning...</p>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Bottom fade for scroll indication */}
                    <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-white via-white/80 to-transparent z-10 pointer-events-none"></div>
                  </div>

                  {/* Home Indicator */}
                  <div className="absolute bottom-1 left-1/2 -translate-x-1/2 z-20">
                    <div className="w-28 h-1 bg-white/30 rounded-full"></div>
                  </div>
                </div>

                {/* Side Buttons */}
                <div className="absolute top-20 -left-1 w-1 h-8 bg-[#2a2a2a] rounded-l-md"></div>
                <div className="absolute top-32 -left-1 w-1 h-12 bg-[#2a2a2a] rounded-l-md"></div>
                <div className="absolute top-48 -left-1 w-1 h-12 bg-[#2a2a2a] rounded-l-md"></div>
                <div className="absolute top-28 -right-1 w-1 h-16 bg-[#2a2a2a] rounded-r-md"></div>
              </div>

              {/* Decorative shadow beneath */}
              <div className="absolute -bottom-6 left-8 right-8 h-8 bg-black/20 blur-xl rounded-full"></div>
            </div>

            {/* Preview Label */}
            <div className="text-center mt-6">
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 rounded-full text-xs text-gray-600 font-medium">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                Mobile Preview
              </span>
            </div>
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
                  className="w-full py-3 px-6 bg-black text-white rounded-xl font-semibold text-sm hover:bg-gray-800 transition-colors"
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
    </main>
  )
}