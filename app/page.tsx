'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

export default function Home() {
  const [rulesCount, setRulesCount] = useState(0)

  useEffect(() => {
    const rules = localStorage.getItem('websiteRules')
    if (rules) {
      const parsedRules = JSON.parse(rules)
      setRulesCount(parsedRules.length)
    }
  }, [])

  return (
    <main className="min-h-screen flex items-center justify-center bg-[linear-gradient(135deg,#667eea,#764ba2)]  px-4">
      <div className="bg-white w-full max-w-4xl rounded-2xl shadow-xl p-10 text-center">
        
        {/* Title */}
        <h1 className="text-3xl md:text-4xl font-bold text-gray-800 mb-4">
          Website Rule Checker
        </h1>

        {/* Subtitle */}
        <p className="text-gray-500 text-lg mb-8">
          Define rules and scan websites to check if they meet your requirements
        </p>

        {/* Buttons */}
        <div className="flex justify-center gap-4 flex-wrap mb-10">
          <Link
            href="/rules"
            className="px-6 py-3 rounded-lg bg-[linear-gradient(135deg,#667eea,#764ba2)] text-white font-medium hover:bg-blue-700 transition"
          >
            Manage Rules ({rulesCount})
          </Link>

          <Link
            href="/scanner"
            className="px-6 py-3 rounded-lg bg-gray-500 text-white font-medium hover:bg-gray-600 transition"
          >
            Scan Website
          </Link>
        </div>

        {/* How it works */}
        <div className="bg-gray-50 rounded-xl p-6 text-left max-w-2xl mx-auto">
          <h2 className="text-xl font-semibold text-gray-800 mb-4 text-center">
            How it works:
          </h2>

          <ol className="list-decimal list-inside text-gray-600 space-y-2">
            <li>
              Go to <strong>Manage Rules</strong> and define your rules
            </li>
            <li>
              Go to <strong>Scan Website</strong> and enter a website URL
            </li>
            <li>
              The system analyzes the website against your rules
            </li>
            <li>
              View results to see which rules pass or fail
            </li>
          </ol>
        </div>

      </div>
    </main>
  )
}

