'use client'

import { useState, useEffect } from 'react'
import { usePathname } from "next/navigation";
import { Check, X, ChevronDown, AlertCircle } from 'lucide-react';
import { z } from 'zod'

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
  const totalCount = results ? results.length : 0

  return (
    <main className="flex items-center justify-center md:px-4 bg-[#FDFDFD] min-h-screen">
      <div className="max-w-[400px] mx-[16px] w-full">
        {/* Logo */}
        <div className="text-center my-[34px]">
          <img src="/cxo_studio_logo.png" alt="logo" className="mx-auto w-[117.54px]  object-cover" />
        </div>

        {/* Title */}
        <h2 className="text-[33px] leading-[48px]  font-bold text-black text-center mb-8">
          Your results are in!
        </h2>

        {/* Phone */}
        <div className="flex justify-center mb-6">
          <img src="/IPhone.png" className="w-full max-w-[256px] h-auto object-contain" />
        </div>

        {results && (
          <div className="mt-6">
            {/* URL Text */}
            <p className="text-[15px] leading-[20px] font-semibold text-gray-600 text-center mb-4">
              Scan results for: <span>{url}</span>
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
                        className={`w-5 h-5 text-[#09090B] shrink-0 transition-transform ${
                          isExpanded ? 'transform rotate-180' : ''
                        }`}
                      />
                      </div>
                    </div>

                    {/* Expanded Content */}
                    {isExpanded && (
                      <div className="mt-4 pt-4 border-t border-gray-200">
                        <div className={`p-3 rounded-lg ${
                          result.passed
                            ? 'bg-green-50'
                            : 'bg-orange-50'
                        }`}>
                          <div className={`flex items-center gap-2 mb-2 ${
                            result.passed ? 'text-green-700' : 'text-orange-700'
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

