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
    <div className="container">
      <div className="card" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
        <h1 style={{ fontSize: '3rem', marginBottom: '1rem', color: '#333' }}>
          Website Rule Checker
        </h1>
        <p style={{ fontSize: '1.2rem', color: '#666', marginBottom: '2rem' }}>
          Define rules and scan websites to check if they meet your requirements
        </p>
        
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/rules" className="btn">
            Manage Rules ({rulesCount})
          </Link>
          <Link href="/scanner" className="btn btn-secondary">
            Scan Website
          </Link>
        </div>

        <div style={{ marginTop: '3rem', padding: '2rem', background: '#f8f9fa', borderRadius: '8px' }}>
          <h2 style={{ marginBottom: '1rem', color: '#333' }}>How it works:</h2>
          <ol style={{ textAlign: 'left', maxWidth: '600px', margin: '0 auto', color: '#666' }}>
            <li style={{ marginBottom: '0.5rem' }}>Go to <strong>Manage Rules</strong> and define your rules</li>
            <li style={{ marginBottom: '0.5rem' }}>Go to <strong>Scan Website</strong> and enter a website URL</li>
            <li style={{ marginBottom: '0.5rem' }}>The system will analyze the website and check if it meets your rules</li>
            <li>View the results to see which rules pass or fail</li>
          </ol>
        </div>
      </div>
    </div>
  )
}

