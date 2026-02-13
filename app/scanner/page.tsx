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

        {/* Website Preview - Same as scanning page */}
        {url && !iframeError && (
          <div className="mb-8">
            <div className="text-center mb-3">
              <p className="text-sm text-gray-600 font-medium">Website Preview</p>
            </div>
            <div className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
              <iframe
                src={`/api/proxy?url=${encodeURIComponent(url.startsWith('http') ? url : `https://${url}`)}`}
                className="w-full"
                style={{ blockSize: '400px' }}
                title="Website Preview"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
                loading="lazy"
                onError={() => {
                  console.log('Iframe blocked, falling back to screenshot')
                  setIframeError(true)
                }}
                onLoad={() => {
                  console.log('Iframe loaded successfully')
                }}
              />
            </div>
          </div>
        )}

        {/* Fallback to screenshot when iframe is blocked */}
        {(iframeError || !url) && (
          <div className="mb-8">
            <div className="text-center mb-3">
              <p className="text-sm text-gray-600 font-medium">
                {iframeError ? 'Website Preview (Screenshot)' : 'Website Analysis Complete'}
              </p>
            </div>
            <div className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
              {websiteScreenshot ? (
                <img
                  src={websiteScreenshot}
                  alt="Website screenshot"
                  className="w-full h-auto object-contain"
                  style={{ blockSize: '400px' }}
                />
              ) : (
                <div className="p-6 bg-gray-50">
                  <div className="text-center">
                    <div className="w-12 h-12 mx-auto mb-3 border-4 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
                    <p className="text-sm text-gray-600">
                      Loading preview...
                    </p>
                  </div>
                </div>
              )}
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
    </main >
  )
}