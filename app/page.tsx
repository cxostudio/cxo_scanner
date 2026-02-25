'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Cog, Check } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { z } from 'zod'
import { toast } from 'react-toastify'
import SelectButton from './components/SelectButton'

interface Rule {
  id: string
  title: string
  description: string
}

interface ScanResult {
  ruleId: string
  ruleTitle: string
  passed: boolean
  reason: string
}

interface BatchData {
  batchId: string
  url: string
  rules: Rule[]
  batchIndex: number
  totalBatches: number
  timestamp: number
}

const RuleSchema = z.object({
  id: z.string().min(1, 'Rule ID is required'),
  title: z.string().min(1, 'Rule title is required').max(200, 'Rule title must be less than 200 characters'),
  description: z.string().min(1, 'Rule description is required').max(5000, 'Rule description must be less than 5000 characters'),
})

const URLSchema = z.string()
  .min(1, 'URL is required')
  .max(2048, 'URL is too long')
  .refine((url) => !/\s/.test(url), 'URL must not contain spaces')
  .refine((url) => {
    try {
      const validUrl = url.startsWith('http://') || url.startsWith('https://') ? url : `https://${url}`
      const parsed = new URL(validUrl)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
      const host = parsed.hostname.toLowerCase()
      if (!host || host.length < 4) return false
      const hasDot = host.includes('.')
      const isLocalhost = host === 'localhost' || host.startsWith('localhost.')
      if (!hasDot && !isLocalhost) return false
      if (hasDot) {
        const parts = host.split('.')
        const tld = parts[parts.length - 1]
        if (!tld || tld.length < 2) return false
      }
      return true
    } catch {
      return false
    }
  }, 'Please enter a valid website URL (e.g. https://example.com or www.mystore.com)')

  const EmailSchema = z.string()
  .min(1, 'Email is required')
  .email('Please enter a valid email address')

export default function Home() {
  const router = useRouter()
  const [currentStep, setCurrentStep] = useState(1)
  const [mounted, setMounted] = useState(0)
  const [selectedChallenge, setSelectedChallenge] = useState<string | null>(null)
  const [selectedRevenue, setSelectedRevenue] = useState<string | null>(null)
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [email, setEmail] = useState('')
  const [urlError, setUrlError] = useState('')
  const [emailError, setEmailError] = useState('')
  const [showAnalyze, setShowAnalyze] = useState(false)
  const [rules, setRules] = useState<Rule[]>([])
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)
  const [websiteScreenshot, setWebsiteScreenshot] = useState<string | null>(null)
  const [currentBatchNumber, setCurrentBatchNumber] = useState<number>(0)
  const [iframeError, setIframeError] = useState<boolean>(false)
  const [loadingDots, setLoadingDots] = useState('')
  const totalSteps = 3

  // Step 1 buttons data
  const step1Buttons = [
    { value: 'low-conversion-rates', label: 'Low conversion rates' },
    { value: 'low-average-order-value', label: 'Low average order value' },
    { value: 'both', label: 'Both' },
  ]

  // Step 2 buttons data
  const step2Buttons = [
    { value: 'under-10k', label: 'Under €10,000 / month' },
    { value: '10k-50k', label: '€10,000–€50,000 / month' },
    { value: '50k-100k', label: '€50,000–€100,000 / month' },
    { value: 'over-100k', label: 'Over €100,000 / month' },
  ]

  const handleNext = () => {
    if (currentStep < totalSteps) {
      setCurrentStep(currentStep + 1)
    }
  }

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
    }
  }

  const analysisSteps = [
    'Crawling your product page structure',
    'Analyzing user experience and interface',
    'Analyzing content and copy effectiveness',
    'Generating conversion recommendations',
    'Finalizing your audit report',
  ]

  useEffect(() => {
    // Load rules on component mount
    loadRules()
    // Screenshot is not stored in localStorage due to size limits
    // It will be loaded from API response during scan
  }, [])

  useEffect(() => {
    if (!showAnalyze) {
      setMounted(0)
      return
    }

    // If we have progress, update mounted based on batch progress
    if (progress) {
      // Map batch progress to analysis steps
      const totalBatches = progress.total
      const currentBatch = progress.current

      // Calculate which step should be active based on batch progress
      // Distribute steps evenly across batches
      const targetStep = Math.min(
        Math.floor((currentBatch / totalBatches) * analysisSteps.length),
        analysisSteps.length - 1
      )

      setMounted(targetStep)
    } else {
      // When showAnalyze is true but no progress yet, show the first step
      setMounted(0)
    }
  }, [progress, showAnalyze])

  const loadRules = async () => {
    try {
      // Load rules from predefined-rules.json
      const response = await fetch('/data/predefined-rules.json')
      if (!response.ok) {
        throw new Error('Failed to load rules')
      }
      const parsed = await response.json()
      const validatedRules = z.array(RuleSchema).parse(parsed)
      setRules(validatedRules)
    } catch (error) {
      console.error('Error loading rules:', error)
      setRules([])
    }
  }

  const prepareBatches = (urlToScan: string, rulesToScan: Rule[]): BatchData[] => {
    const BATCH_SIZE = 5
    const batches: BatchData[] = []
    const timestamp = Date.now()

    const totalRules = rulesToScan.length
    const remainder = totalRules % BATCH_SIZE
    // Calculate total batches: first batch gets remainder, rest get BATCH_SIZE
    const totalBatches = remainder > 0
      ? 1 + Math.floor((totalRules - (BATCH_SIZE + remainder)) / BATCH_SIZE)
      : Math.floor(totalRules / BATCH_SIZE)

    let ruleIndex = 0

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      // First batch gets remainder if exists, otherwise BATCH_SIZE
      let currentBatchSize = BATCH_SIZE
      if (batchIndex === 0 && remainder > 0) {
        currentBatchSize = BATCH_SIZE + remainder
      }

      // Stop if no more rules left
      if (ruleIndex >= totalRules) {
        break
      }

      const batchRules = rulesToScan.slice(ruleIndex, ruleIndex + currentBatchSize)

      batches.push({
        batchId: `batch-${timestamp}-${batchIndex}`,
        url: urlToScan,
        rules: batchRules,
        batchIndex: batchIndex,
        totalBatches: totalBatches,
        timestamp: timestamp,
      })

      ruleIndex += currentBatchSize
    }

    localStorage.setItem('scanBatches', JSON.stringify(batches))
    localStorage.setItem('scanResults', JSON.stringify([]))

    return batches
  }

  const processBatches = async (batches: BatchData[]) => {
    const allResults: ScanResult[] = []

    setProgress({ current: 0, total: batches.length })

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]

      try {
        setProgress({ current: i + 1, total: batches.length })

        const response = await fetch('/api/scan', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: batch.url,
            rules: batch.rules,
            captureScreenshot: true, // Capture screenshot for every batch to show progress
          }),
        })

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || `Failed to scan batch ${i + 1}`)
        }

        const data = await response.json()

        const ScanResultsSchema = z.array(z.object({
          ruleId: z.string(),
          ruleTitle: z.string(),
          passed: z.boolean(),
          reason: z.string(),
        }))

        const batchResults = ScanResultsSchema.parse(data.results)

        // Remove duplicates before adding (check by ruleId)
        const existingRuleIds = new Set(allResults.map(r => r.ruleId))
        const newResults = batchResults.filter(result => {
          if (existingRuleIds.has(result.ruleId)) {
            console.warn(`Duplicate ruleId found: ${result.ruleId}, skipping duplicate`)
            return false
          }
          existingRuleIds.add(result.ruleId)
          return true
        })

        allResults.push(...newResults)

        // Store screenshot from every batch to show what AI is seeing
        // Store in both state and sessionStorage for results page
        if (data.screenshot) {
          console.log(`Screenshot received from batch ${i + 1}, length: ${data.screenshot.length}`)
          setWebsiteScreenshot(data.screenshot)
          setCurrentBatchNumber(i + 1)
          // Store in sessionStorage for results page (not localStorage due to size limits)
          try {
            sessionStorage.setItem('lastScreenshot', data.screenshot)
            console.log(`Screenshot updated from batch ${i + 1} and stored in sessionStorage`)
          } catch (e) {
            console.warn('Could not store screenshot in sessionStorage:', e)
          }
        } else {
          console.warn(`No screenshot received from batch ${i + 1}. This may be due to Vercel timeout.`)
        }


        const remainingBatches = batches.slice(i + 1)
        if (remainingBatches.length > 0) {
          localStorage.setItem('scanBatches', JSON.stringify(remainingBatches))
        } else {
          localStorage.removeItem('scanBatches')
        }

        localStorage.setItem('scanResults', JSON.stringify(allResults))

      } catch (err) {
        console.error(`Error processing batch ${i + 1}:`, err)
        // Add detailed error info for batch 4 specifically
        if (i === 3) {
          console.error('Batch 4 failed - adding longer delay before next retry')
          toast.error(`Batch ${i + 1} failed. Retrying with extended delay...`)
        }
        batch.rules.forEach(rule => {
          allResults.push({
            ruleId: rule.id,
            ruleTitle: rule.title,
            passed: false,
            reason: `Error processing batch ${i + 1}: ${err instanceof Error ? err.message : 'Unknown error'}`,
          })
        })
      }

      // Add delay between batches to avoid rate limits (except for last batch)
      if (i < batches.length - 1) {
        // Wait longer between batches - 20 seconds for batch 3->4, 15 seconds for others
        // This helps prevent rate limit issues, especially for batch 4
        const delayMs = i === 2 ? 20000 : 15000
        console.log(`Waiting ${delayMs / 1000}s before batch ${i + 2}...`)
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }
    }

    try {
      const finalResponse = await fetch('/api/scan/combine', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          results: allResults,
        }),
      })

      if (finalResponse.ok) {
        const finalData = await finalResponse.json()
        const validatedResults = z.array(z.object({
          ruleId: z.string(),
          ruleTitle: z.string(),
          passed: z.boolean(),
          reason: z.string(),
        })).parse(finalData.results)

        localStorage.setItem('scanResults', JSON.stringify(validatedResults))
        // Store normalized URL (with protocol) so iframe works on Vercel
        localStorage.setItem('scanUrl', batches[0]?.url || websiteUrl)
        // Store screenshot URL for results page (if available)
        if (websiteScreenshot) {
          // Store as data URL in sessionStorage instead of localStorage (smaller size limit)
          try {
            sessionStorage.setItem('lastScreenshot', websiteScreenshot)
          } catch (e) {
            console.warn('Could not store screenshot in sessionStorage:', e)
          }
        }
        localStorage.removeItem('scanBatches')
      } else {
        localStorage.setItem('scanResults', JSON.stringify(allResults))
        localStorage.setItem('scanUrl', batches[0]?.url || websiteUrl)
        localStorage.removeItem('scanBatches')
      }
    } catch (finalErr) {
      console.error('Final request error:', finalErr)
      localStorage.setItem('scanResults', JSON.stringify(allResults))
      localStorage.setItem('scanUrl', batches[0]?.url || websiteUrl)
      localStorage.removeItem('scanBatches')
    }

    // Don't set progress to null here (would reset mounted to 0 and flash all step loaders)
    // Toast + redirect happen in handleStartScan right after this returns
  }

  const handleStartScan = async () => {
    setUrlError('')
    setEmailError('')

    const urlTrimmed = websiteUrl.trim()
    const emailTrimmed = email.trim()

    if (!urlTrimmed) {
      setUrlError('Website URL is required')
      return
    }
    if (!emailTrimmed) {
      setEmailError('Email address is required')
      return
    }

    const urlResult = URLSchema.safeParse(urlTrimmed)
    if (!urlResult.success) {
      const msg = urlResult.error.errors[0]?.message || 'Invalid URL'
      setUrlError(msg)
      return
    }

    const emailResult = EmailSchema.safeParse(emailTrimmed)
    if (!emailResult.success) {
      const msg = emailResult.error.errors[0]?.message || 'Invalid email'
      setEmailError(msg)
      return
    }

    // Ensure rules are loaded before scanning
    let rulesToUse = rules
    if (rulesToUse.length === 0) {
      await loadRules()
      // Wait a bit for state to update
      await new Promise(resolve => setTimeout(resolve, 100))
      rulesToUse = rules

      // If still empty, try loading directly
      if (rulesToUse.length === 0) {
        try {

          const response = await fetch('/data/predefined-rules.json')
          if (!response.ok) {
            throw new Error('Failed to load rules')
          }
          const parsed = await response.json()
          const validatedRules = z.array(RuleSchema).parse(parsed)
          rulesToUse = validatedRules
          setRules(validatedRules)
        } catch (error) {
          console.error('Error loading rules:', error)
          toast.error('Failed to load rules. Please check predefined-rules.json file.')
          return
        }
      }
    }

    if (rulesToUse.length === 0) {
      toast.error('No rules available. Please check predefined-rules.json file.')
      return
    }

    try {
      let validUrl = urlResult.data!
      if (!validUrl.startsWith('http://') && !validUrl.startsWith('https://')) {
        validUrl = 'https://' + validUrl
      }

      // First, show the analyze UI (site/page should load first)
      setShowAnalyze(true)
      setProgress(null)
      setWebsiteScreenshot(null) // Reset screenshot for new scan
      setCurrentBatchNumber(0) // Reset batch number
      setIframeError(false) // Reset iframe error
      // Screenshot not stored in localStorage, no need to remove

      // Wait for the page/UI to fully render before starting batch requests
      // This ensures the site loads first, then batch requests go (important for Vercel free account)
      await new Promise(resolve => {
        // Use requestAnimationFrame to wait for next paint cycle
        requestAnimationFrame(() => {
          // Add a small delay to ensure UI is fully rendered
          setTimeout(() => {
            resolve(undefined)
          }, 200) // 300ms delay to ensure page is visible
        })
      })

      // Fire-and-forget lightweight screenshot capture for UI preview.
      // Runs in parallel with rule scanning so it doesn't slow down results.
      try {
        console.log('Triggering screenshot API for URL:', validUrl)
        fetch('/api/screenshot', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ url: validUrl }),
        })
          .then(async (res) => {
            console.log('Screenshot API response status:', res.status)
            if (!res.ok) {
              console.error('Screenshot API failed with status:', res.status)
              return
            }
            const data = await res.json()
            console.log('Screenshot API response data:', data)
            if (data?.screenshot) {
              console.log('Screenshot received, setting state')
              setWebsiteScreenshot(data.screenshot)
              try {
                sessionStorage.setItem('lastScreenshot', data.screenshot)
                console.log('Screenshot stored in sessionStorage')
              } catch (e) {
                console.warn('Could not store screenshot from /api/screenshot in sessionStorage:', e)
              }
            } else {
              console.warn('No screenshot in API response')
            }
          })
          .catch((err) => {
            console.error('Screenshot API call failed (non-blocking):', err)
          })
      } catch (sErr) {
        console.warn('Screenshot API trigger failed (non-blocking):', sErr)
      }

      // Now start batch processing after page has loaded
      const batches = prepareBatches(validUrl, rulesToUse)
      await processBatches(batches)

      toast.success('Scan completed successfully!')
      router.push('/scanner')
    } catch (err) {
      if (err instanceof z.ZodError) {
        console.error('Validation error:', err.errors)
      } else {
        toast.error(err instanceof Error ? err.message : 'An error occurred')
      }
      setShowAnalyze(false)
    }
  }

  const progressPercentage = (currentStep / totalSteps) * 100

  // Check if current step has required value
  const isStepValid = () => {
    if (currentStep === 1) {
      return selectedChallenge !== null
    }
    if (currentStep === 2) {
      return selectedRevenue !== null
    }
    if (currentStep === 3) {
      return websiteUrl.trim() !== '' && email.trim() !== ''
    }
    return false
  }

  return (
    <main className="flex items-center justify-center md:px-4 min-h-screen w-full overflow-x-hidden">
      <div className={`w-full mx-auto px-4 sm:px-6 ${showAnalyze ? 'max-w-4xl' : 'max-w-[400px]'}`}>
        {/* Header with Logo and Progress */}
        {!showAnalyze && (
          <>
            {/* Logo */}
            <div className="text-center my-[34px]">
              <img src="/cxo_studio_logo.png" alt="logo" className="mx-auto w-[117.54px] object-cover" />
            </div>

            {/* Back Button and Progress Bar */}
            <div className="flex items-center gap-3">

              <button
                onClick={handleBack}
                className="w-[35px] h-[35px] rounded-lg bg-white border border-[#E4E4E7] flex items-center justify-center hover:bg-gray-200 transition shrink-0 cursor-pointer"
              >
                <span className="text-gray-700 text-xl mb-1">‹</span>
              </button>
              {/* Progress Bar */}
              <div className="flex-1 bg-gray-200 rounded-full h-2">
                <div
                  className="bg-[#757575] h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progressPercentage}%` }}
                ></div>
              </div>
            </div>
          </>
        )}
        {/* Step Content */}
        <div className="my-[35px] mx-[16px]">
          {!showAnalyze ? (
            <>
              {currentStep === 1 && (
                <div>
                  <h2 className="text-[33px] leading-[48px] font-bold text-gray-[#09090B] text-center">
                    What's your biggest challenge right now?
                  </h2>
                  <div className="mt-[28px]">
                    {step1Buttons.map((button) => (
                      <SelectButton
                        key={button.value}
                        label={button.label}
                        value={button.value}
                        selectedValue={selectedChallenge}
                        onClick={setSelectedChallenge}
                      />
                    ))}
                  </div>
                </div>
              )}

              {currentStep === 2 && (
                <>
                  <h2 className="text-3xl my-[33px] font-bold text-gray-900 text-center px-4">
                    What's your average online revenue?
                  </h2>
                  <div className="mt-[43px]">
                    {step2Buttons.map((button) => (
                      <SelectButton
                        key={button.value}
                        label={button.label}
                        value={button.value}
                        selectedValue={selectedRevenue}
                        onClick={setSelectedRevenue}
                      />
                    ))}
                  </div>
                </>
              )}

              {currentStep === 3 && (
                <>
                  <div>
                    <h2 className="text-[33px] leading-[48px] font-bold text-[#757575] text-center">
                      <i>You're almost done!</i>
                    </h2>
                    <h2 className="text-[33px] leading-[48px] font-bold text-black text-center">
                      Let's finish your audit
                    </h2>
                  </div>
                  <div className="mt-[33px]">
                    <label className="block text-sm font-semibold text-black">
                      Website URL: <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="url"
                      value={websiteUrl}
                      onChange={(e) => {
                        setWebsiteUrl(e.target.value)
                        if (urlError) setUrlError('')
                      }}
                      placeholder="Enter the URL of your main product page"
                      className={`w-full mt-[13px] px-4 py-3 border rounded-xl bg-white text-sm focus:outline-none ${urlError ? 'border-red-500' : 'border-gray-300'}`}
                      required
                      aria-invalid={!!urlError}
                      aria-describedby={urlError ? 'url-error' : undefined}
                    />
                    {urlError && (
                      <p id="url-error" className="mt-1.5 text-sm text-red-500">{urlError}</p>
                    )}
                    <div className="relative mt-[19px]">
                      <label className="block text-sm font-semibold text-black">
                        Email address: <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value)
                          if (emailError) setEmailError('')
                        }}
                        placeholder="Enter your best email address"
                        className={`w-full mt-[12px] px-4 py-3 border rounded-xl bg-white text-sm focus:outline-none ${emailError ? 'border-red-500' : 'border-gray-300'}`}
                        required
                        aria-invalid={!!emailError}
                        aria-describedby={emailError ? 'email-error' : undefined}
                      />
                      {emailError && (
                        <p id="email-error" className="mt-1.5 text-sm text-red-500">{emailError}</p>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* Continue Button or Access Results Button */}
              {currentStep < totalSteps ? (
                <div className="mt-[91px]">
                  <button
                    onClick={handleNext}
                    disabled={!isStepValid()}
                    className={`w-full py-5 rounded-xl transition-all duration-300 font-bold text-base text-center cursor-pointer transform hover:scale-105 ${!isStepValid()
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-black text-white hover:bg-gray-800 shadow-lg hover:shadow-xl'
                      }`}
                  >
                    Continue ›
                  </button>
                </div>
              ) : (
                <div className="mt-[91px]">
                  <button
                    onClick={handleStartScan}
                    disabled={!websiteUrl || !email}
                    className={`w-full py-6 rounded-xl transition-all duration-300 font-bold text-lg text-center cursor-pointer transform hover:scale-105 ${!websiteUrl || !email
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-gradient-to-r from-black to-gray-800 text-white hover:from-gray-800 hover:to-black shadow-2xl hover:shadow-black/50'
                      }`}
                  >
                    Access my results ›
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              {/* BYTEEX-style dark analyze screen */}
              <div className="pt-8 pb-12">
                <h2 className="text-2xl md:text-3xl font-bold text-center mb-2 text-gray-600 flex items-baseline justify-center gap-2 flex-wrap">
                  Analyzing Your URL
                  <span className="flex gap-1 items-end" aria-hidden>
                    <span className="w-2 h-2 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 rounded-full bg-gray-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </span>
                </h2>

                {/* Desktop browser preview only */}
                {websiteUrl && (
                  <div className="mb-6 flex justify-center">
                    {/* Desktop - browser window: traffic lights, address bar, site content */}
                    <div className="w-full max-w-2xl h-[320px]">
                      <div className="rounded-lg overflow-hidden bg-[#2a2a2d] border border-[#3f3f46] shadow-2xl flex flex-col h-full">
                        <div className="flex items-center gap-2 px-3 py-2 border-b border-[#3f3f46] bg-[#2a2a2d] shrink-0 relative z-10">
                          <span className="w-2.5 h-2.5 rounded-full bg-[#ef4444]" />
                          <span className="w-2.5 h-2.5 rounded-full bg-[#eab308]" />
                          <span className="w-2.5 h-2.5 rounded-full bg-[#22c55e]" />
                        </div>
                        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#3f3f46] bg-[#2a2a2d] shrink-0">
                          <div className="flex-1 flex items-center gap-2 px-3 py-1 rounded-lg bg-[#18181b] border border-[#3f3f46] text-zinc-400 text-[11px] font-medium">
                            <svg className="w-3 h-3 shrink-0 text-zinc-500" viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z" /></svg>
                            <span className="truncate">{websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`}</span>
                          </div>
                        </div>
                        <div className="flex-1 min-h-0 overflow-hidden bg-white">
                          {!iframeError ? (
                            <iframe
                              src={`/api/proxy?url=${encodeURIComponent(websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`)}`}
                              className="w-full h-full min-h-0 border-0"
                              style={{ blockSize: '100%', minHeight: 0 }}
                              title="Website inside desktop browser"
                              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
                              loading="lazy"
                              onError={() => {
                                setIframeError(true)
                                if (websiteUrl && !websiteScreenshot) {
                                  const validUrl = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`
                                  fetch('/api/screenshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: validUrl }) })
                                    .then(async (res) => { if (res.ok) { const d = await res.json(); if (d?.screenshot) { setWebsiteScreenshot(d.screenshot); try { sessionStorage.setItem('lastScreenshot', d.screenshot) } catch (_) {} } } })
                                    .catch(() => {})
                                }
                              }}
                            />
                          ) : websiteScreenshot ? (
                            <img src={websiteScreenshot} alt="Desktop" className="w-full h-full object-cover object-top" />
                          ) : (
                            <div className="w-full h-full bg-[#18181b] flex items-center justify-center">
                              <div className="w-10 h-10 border-2 border-[#3f3f46] border-t-purple-500 rounded-full animate-spin" />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Steps - loading strips (visible dark cards with white text) */}
                <p className="text-sm font-medium text-white mb-3">Website URL:</p>
                <div className="space-y-3">
                  <AnimatePresence mode="popLayout">
                    {analysisSteps
                      .map((title, index) => ({ title, index, id: `step-${index}-${title}` }))
                      .filter(({ index }) => {
                        const isCompleted = index < mounted
                        const shouldAnimateOut = isCompleted && mounted >= index + 2
                        return !shouldAnimateOut
                      })
                      .map(({ title, index, id }) => {
                        const isCompleted = index < mounted
                        const isActive = index === mounted

                        return (
                          <motion.div
                            key={id}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ x: 200, opacity: 0 }}
                            transition={{ duration: 0.3 }}
                            className="flex items-center gap-4 p-4 rounded-xl bg-white border border-gray-200"
                          >
                            {isCompleted ? (
                              <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center shrink-0">
                                <Check className="w-3.5 h-3.5 text-white" />
                              </div>
                            ) : (
                              <Cog className={`w-5 h-5 shrink-0 ${isActive ? 'text-gray-400  animate-spin' : 'text-gray-400'}`} />
                            )}
                            <span className={`flex-1 text-sm font-medium ${isCompleted ? 'text-gray-500 line-through' : 'text-gray-900'}`}>
                              {title}
                            </span>
                            {isCompleted && <span className="text-gray-600 text-sm font-medium">Finished</span>}
                            {isActive && (
                              <span className="text-gray-700 text-sm font-medium flex items-center gap-1.5">
                                Analyzing...
                                <span className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                              </span>
                            )}
                          </motion.div>
                        )
                      })}
                  </AnimatePresence>
                </div>
              </div>

              {!websiteUrl && (
                <div className="py-12 text-center text-zinc-500">Loading...</div>
              )}
            </>
          )}
        </div>

        {/* Social Proof Footer - Only show when not analyzing */}
        {!showAnalyze && (
          <div className="my-[18px]">
            <div className="flex justify-center gap-3">
              {/* Start: Profile Images */}
              <div className="flex -space-x-2">
                <div className="w-10 h-10 rounded-full border-2 border-white overflow-hidden bg-gray-200">
                  <img src="/client_first.png" alt="user" className="w-[40px] h-[40px] object-cover" />
                </div>
                <div className="w-10 h-10 rounded-full border-2 border-white overflow-hidden bg-gray-200">
                  <img src="/client_second.png" alt="user" className="w-[40px] h-[40px] object-cover" />
                </div>
                <div className="w-10 h-10 rounded-full border-2 border-white overflow-hidden bg-gray-200">
                  <img src="/client_third.png" alt="user" className="w-[40px] h-[40px] object-cover" />
                </div>
              </div>

              {/* End: Stars and Text */}
              <div className="flex flex-col">
                <div className="flex items-center gap-1">
                  {[...Array(5)].map((_, i) => (
                    <span key={i} className="text-[#FFB66E] text-lg w-[16px] h-[16px]">★</span>
                  ))}
                </div>
                <p className="text-xs font-semibold text-[#71717A] mt-[4px]">
                  Trusted by e-commerce founders
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}