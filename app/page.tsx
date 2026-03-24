'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Cog, Check } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { z } from 'zod'
import { toast } from 'react-toastify'
import SelectButton from './components/SelectButton'
import emailjs from '@emailjs/browser'

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

const EMAILJS_SERVICE_ID = 'service_j08d36o'
const EMAILJS_TEMPLATE_ID = 'template_fiqbjw9'
const EMAILJS_PUBLIC_KEY = 'gnuaIRx_bs0IdMu7r'

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
  const [isStartingScan, setIsStartingScan] = useState(false)
  const [rules, setRules] = useState<Rule[]>([])
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)
  const [websiteScreenshot, setWebsiteScreenshot] = useState<string | null>(null)
  const [currentBatchNumber, setCurrentBatchNumber] = useState<number>(0)
  const [iframeError, setIframeError] = useState<boolean>(false)
  const [removedSteps, setRemovedSteps] = useState<Set<number>>(new Set())
  const totalSteps = 3

  // Step 1 buttons data
  const step1Buttons = [
    { value: 'Low Conversion Rates', label: 'Low conversion rates' },
    { value: 'Low Average Order Value', label: 'Low average order value' },
    { value: 'Both', label: 'Both' },
  ]

  // Step 2 buttons data
  const step2Buttons = [
    { value: 'Under €10,000 / month', label: 'Under €10,000 / month' },
    { value: '€10,000–€50,000 / month', label: '€10,000–€50,000 / month' },
    { value: '€50,000–€100,000 / month', label: '€50,000–€100,000 / month' },
    { value: 'Over €100,000 / month', label: 'Over €100,000 / month' },
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

  // When a step completes (mounted advances), show checkmark briefly then remove it
  useEffect(() => {
    if (mounted > 0) {
      const justCompleted = mounted - 1
      if (!removedSteps.has(justCompleted)) {
        const t = setTimeout(() => {
          setRemovedSteps(prev => new Set([...prev, justCompleted]))
        }, 700)
        return () => clearTimeout(t)
      }
    }
  }, [mounted])

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

  const BATCH_MAX_ATTEMPTS = 2 // initial run + one repeat if any error occurs

  const processBatches = async (batches: BatchData[]) => {
    const allResults: ScanResult[] = []

    setProgress({ current: 0, total: batches.length })

    const ScanResultsSchema = z.array(z.object({
      ruleId: z.string(),
      ruleTitle: z.string(),
      passed: z.boolean(),
      reason: z.string(),
    }))

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]

      setProgress({ current: i + 1, total: batches.length })

      let batchSucceeded = false
      let lastBatchError: unknown = null

      for (let attempt = 1; attempt <= BATCH_MAX_ATTEMPTS; attempt++) {
        try {
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
            let message = `Failed to scan batch ${i + 1}`
            try {
              const errorData = await response.json()
              message = (errorData as { error?: string }).error || message
            } catch {
              /* ignore JSON parse errors */
            }
            throw new Error(message)
          }

          const data = await response.json()
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
            try {
              sessionStorage.setItem('lastScreenshot', data.screenshot)
              console.log(`Screenshot updated from batch ${i + 1} and stored in sessionStorage`)
            } catch (e) {
              console.warn('Could not store screenshot in sessionStorage:', e)
            }
          } else {
            console.warn(`No screenshot received from batch ${i + 1}. This may be due to Vercel timeout.`)
          }

          batchSucceeded = true
          break
        } catch (err) {
          lastBatchError = err
          console.error(`Error processing batch ${i + 1} (attempt ${attempt}/${BATCH_MAX_ATTEMPTS}):`, err)
          if (attempt < BATCH_MAX_ATTEMPTS) {
            console.warn(`Retrying batch ${i + 1} once after error...`)
            await new Promise((r) => setTimeout(r, 1500))
          }
        }
      }

      if (!batchSucceeded) {
        console.error(`Batch ${i + 1} failed after ${BATCH_MAX_ATTEMPTS} attempts`)
        batch.rules.forEach(rule => {
          allResults.push({
            ruleId: rule.id,
            ruleTitle: rule.title,
            passed: false,
            reason: `Error processing batch ${i + 1}: ${lastBatchError instanceof Error ? lastBatchError.message : 'Unknown error'}`,
          })
        })
      }

      const remainingBatches = batches.slice(i + 1)
      if (remainingBatches.length > 0) {
        localStorage.setItem('scanBatches', JSON.stringify(remainingBatches))
      } else {
        localStorage.removeItem('scanBatches')
      }

      localStorage.setItem('scanResults', JSON.stringify(allResults))
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
      setIsStartingScan(true)
      let validUrl = urlResult.data!
      if (!validUrl.startsWith('http://') && !validUrl.startsWith('https://')) {
        validUrl = 'https://' + validUrl
      }

      const browser = navigator.userAgent
      const screenSize = `${window.screen.width}x${window.screen.height}`
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown'
      const browserData = [
        `ua=${browser}`,
        `platform=${navigator.platform}`,
        `language=${navigator.language}`,
        `screen=${screenSize}`,
        `timezone=${timeZone}`,
      ].join(' | ')

      let ipAddress = 'Unknown'
      try {
        const ipResponse = await fetch('https://api.ipify.org?format=json')
        if (ipResponse.ok) {
          const ipJson = await ipResponse.json()
          ipAddress = ipJson?.ip || 'Unknown'
        }
      } catch (ipErr) {
        console.warn('Failed to fetch client IP:', ipErr)
      }

      // EmailJS-ready payload values
      const level = selectedChallenge ?? ''
      const price = selectedRevenue ?? ''
      const emailJsPayloadBase = {
        level,
        price,
        url: validUrl,
        email: emailTrimmed,
        ip_address: ipAddress,
        browser,
        screen_size: screenSize,
        time_zone: timeZone,
        browser_data: browserData,
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

      // Send final scan summary to EmailJS (after results are ready)
      let passResult: string | number = 'N/A'
      let failResult: string | number = 'N/A'
      try {
        const stored = localStorage.getItem('scanResults')
        if (stored) {
          const parsedResults = z.array(z.object({
            ruleId: z.string(),
            ruleTitle: z.string(),
            passed: z.boolean(),
            reason: z.string(),
          })).parse(JSON.parse(stored))
          const passCount = parsedResults.filter((r) => r.passed).length
          const failCount = parsedResults.length - passCount
          passResult = `${passCount}/${parsedResults.length}`
          failResult = `${failCount}/${parsedResults.length}`
        }
      } catch (summaryErr) {
        console.warn('Could not compute pass/fail summary for EmailJS:', summaryErr)
      }

      const emailJsPayload = {
        ...emailJsPayloadBase,
        pass_result: passResult,
        fail_result: failResult,
      }

      // Non-blocking email send
      emailjs.send(
        EMAILJS_SERVICE_ID,
        EMAILJS_TEMPLATE_ID,
        emailJsPayload,
        { publicKey: EMAILJS_PUBLIC_KEY }
      )
        .then((response) => {
          console.log('EmailJS SUCCESS:', response.status, response.text)
        })
        .catch((err) => {
          console.error('EmailJS FAILED:', err)
        })
      setIsStartingScan(false)
      toast.success('Scan completed successfully!')
      router.push('/scanner')
    } catch (err) {
      setIsStartingScan(false)
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
    <main className="flex items-start justify-center md:px-4 min-h-screen w-full overflow-x-hidden pt-8 pb-12 bg-gray-100">
      <div className={`w-full mx-auto px-4 sm:px-6 ${showAnalyze ? 'max-w-4xl' : 'max-w-[400px]'}`}>
        {/* Header with Logo and Progress */}
        {!showAnalyze && (
          <>
            {/* Logo */}
            
            <motion.div
              className="text-center mt-8 mb-9"
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, ease: [0.25, 0.1, 0.25, 1] }}
            >
              <img src="/cxo_studio_logo.png" alt="logo" className="mx-auto w-[117.54px] h-[20px] object-cover" />
            </motion.div>

            {/* Back Button and Progress Bar */}
            <motion.div
              className="flex items-center gap-3"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1], delay: 0.08 }}
            >
              <motion.button
                type="button"
                onClick={handleBack}
                className="w-[35px] h-[35px] rounded-[10px] bg-white border border-[#E4E4E7] flex items-center justify-center hover:bg-gray-200 shrink-0 cursor-pointer"
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.97 }}
                transition={{ type: 'tween', duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
              >
                <span className="text-gray-700 text-xl mb-1">‹</span>
              </motion.button>
              {/* Progress Bar */}
              <div className="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden">
                <motion.div
                  className="bg-gray-600 h-2 rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${progressPercentage}%` }}
                  transition={{ duration: 0.65, ease: [0.4, 0, 0.2, 1] }}
                />
              </div>
            </motion.div>
          </>
        )}
        {/* Step Content - min-height keeps logo/progress bar fixed when step height changes */}
        <div className="h-full">
          {!showAnalyze ? (
            <>
              <AnimatePresence mode="wait">
                {currentStep === 1 && (
                  <motion.div
                    key="step1"
                    className="min-h-[400px]"
                    initial={{ opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -24 }}
                    transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
                  >
                    <motion.h2
                      className="text-3xl font-bold text-gray-900 text-center mt-[35px] mb-[28px]"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.45, ease: [0.25, 0.1, 0.25, 1], delay: 0.06 }}
                    >
                      What's your biggest challenge right now?
                    </motion.h2>
                    <div >
                      {step1Buttons.map((button, i) => (
                        <motion.div
                          key={button.value}
                          initial={{ opacity: 0, y: 14 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1], delay: 0.38 + i * 0.08 }}
                        >
                          <SelectButton
                            label={button.label}
                            value={button.value}
                            selectedValue={selectedChallenge}
                            onClick={setSelectedChallenge}
                          />
                        </motion.div>
                      ))}
                    </div>
                  </motion.div>
                )}

                {currentStep === 2 && (
                  <motion.div
                    key="step2"
                    className="min-h-[400px]"
                    initial={{ opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -24 }}
                    transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
                  >
                    <motion.h2
                      className="text-3xl  font-bold text-gray-900 text-center mt-[35px] mb-[28px]"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.45, ease: [0.25, 0.1, 0.25, 1], delay: 0.06 }}
                    >
                      What's your average online revenue?
                    </motion.h2>
                    <div className="mt-8">
                      {step2Buttons.map((button, i) => (
                        <motion.div
                          key={button.value}
                          initial={{ opacity: 0, y: 14 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1], delay: 0.38 + i * 0.08 }}
                        >
                          <SelectButton
                            label={button.label}
                            value={button.value}
                            selectedValue={selectedRevenue}
                            onClick={setSelectedRevenue}
                          />
                        </motion.div>
                      ))}
                    </div>
                  </motion.div>
                )}

                {currentStep === 3 && (
                  <motion.div
                    key="step3"
                    className="min-h-[400px]"
                    initial={{ opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -24 }}
                    transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
                  >
                      <motion.h2
                        className="text-[#757575] text-center text-[33px] italic font-bold leading-[48px] tracking-[-1.2px] me-[12px] mt-[35px]"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.45, ease: [0.25, 0.1, 0.25, 1], delay: 0.06 }}
                      >
                        <i>You're almost done!</i>
                      </motion.h2>
                      <motion.h2
                        className="text-3xl font-bold text-gray-900 text-center"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.45, ease: [0.25, 0.1, 0.25, 1], delay: 0.12 }}
                      >
                        Let's finish your audit
                      </motion.h2>
                    <motion.div
                      className="mt-8"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1], delay: 0.18 }}
                    >
                      <label className="block text-sm font-semibold text-gray-900">
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
                        className={` w-full mt-2 px-4 py-3 border rounded-lg bg-white text-sm focus:outline-none ${urlError ? 'border-red-500' : 'border-gray-300'}`}
                        required
                        aria-invalid={!!urlError}
                        aria-describedby={urlError ? 'url-error' : undefined}
                      />
                      {urlError && (
                        <p id="url-error" className="mt-1.5 text-sm text-red-500">{urlError}</p>
                      )}
                      <div className="relative mt-4">
                        <label className="block text-sm font-semibold text-gray-900">
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
                          className={`w-full mt-2 px-4 py-3 border rounded-lg bg-white text-sm focus:outline-none ${emailError ? 'border-red-500' : 'border-gray-300'}`}
                          required
                          aria-invalid={!!emailError}
                          aria-describedby={emailError ? 'email-error' : undefined}
                        />
                        {emailError && (
                          <p id="email-error" className="mt-1.5 text-sm text-red-500">{emailError}</p>
                        )}
                      </div>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Continue Button or Access Results Button */}
              {currentStep < totalSteps ? (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1], delay: 0.28 }}
                >
                  <motion.button
                    type="button"
                    onClick={handleNext}
                    disabled={!isStepValid()}
                    className={`w-full rounded-[10px] font-bold text-base text-center cursor-pointer ${!isStepValid()
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-black text-white shadow-lg'
                      }`}
                    whileHover={isStepValid() ? { scale: 1.015 } : {}}
                    whileTap={isStepValid() ? { scale: 0.985 } : {}}
                    transition={{ type: 'tween', duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
                  >
                    <p className="my-[18px]">Continue ›</p>
                  </motion.button>
                </motion.div>
              ) : (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1], delay: 0.28 }}
                >
                  {isStartingScan ? (
                    <div className="w-full py-6 rounded-[10px] font-bold text-lg text-center bg-gray-300 text-gray-600 cursor-not-allowed">
                      <span className="inline-flex items-center justify-center gap-2">
                        <span
                          className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"
                          aria-hidden="true"
                        />
                        Loading results...
                      </span>
                    </div>
                  ) : (
                    <motion.button
                      type="button"
                      onClick={handleStartScan}
                      disabled={!websiteUrl || !email}
                      className={`w-full py-6 rounded-[10px] font-bold text-lg text-center cursor-pointer ${!websiteUrl || !email
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        : 'bg-black text-white shadow-2xl'
                        }`}
                      whileHover={websiteUrl && email ? { scale: 1.015 } : {}}
                      whileTap={websiteUrl && email ? { scale: 0.985 } : {}}
                      transition={{ type: 'tween', duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
                    >
                      Access my results ›
                    </motion.button>
                  )}
                </motion.div>
              )}
            </>
          ) : (
            <>
              {/* BYTEEX-style dark analyze screen */}
              <div className="pt-8 pb-12">
                <h2 className="text-2xl md:text-[33px] font-bold text-center mb-2 text-[#757575] flex items-baseline justify-center gap-2 flex-wrap">
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

                {/* Debug: View full screenshot the AI is receiving */}
                {/* {websiteScreenshot && (
                  <div className="mb-4 flex justify-center">
                    <button
                      onClick={() => {
                        const win = window.open()
                        if (win) {
                          win.document.write(`<html><body style="margin:0;background:#000"><img src="${websiteScreenshot}" style="max-width:100%;display:block" /></body></html>`)
                        }
                      }}
                      className="text-xs text-purple-400 underline hover:text-purple-300"
                    >
                      🔍 View full screenshot AI is seeing
                    </button>
                  </div>
                )} */}

                {/* Steps - all steps visible; active spins, completed shows checkmark then slides out, pending waits */}
                <div className="space-y-3">
                  <AnimatePresence mode="popLayout">
                    {analysisSteps
                      .map((title, index) => ({ title, index, id: `step-${index}-${title}` }))
                      .filter(({ index }) => !removedSteps.has(index))
                      .map(({ title, index, id }) => {
                        const isCompleted = index < mounted
                        const isActive = index === mounted
                        const isPending = index > mounted

                        return (
                          <motion.div
                            key={id}
                            initial={{ opacity: 0, y: 16 }}
                            animate={{ opacity: isPending ? 0.45 : 1, y: 0 }}
                            exit={{ x: 160, opacity: 0 }}
                            transition={{ duration: 0.45, ease: [0.25, 0.1, 0.25, 1] }}
                            className="flex items-center gap-4 p-4 rounded-xl bg-white border border-gray-200"
                          >
                            {isCompleted ? (
                              <div className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center shrink-0">
                                <Check className="w-3.5 h-3.5 text-white" />
                              </div>
                            ) : (
                              <Cog className={`w-5 h-5 shrink-0 text-gray-400 ${isActive ? 'animate-spin' : ''}`} />
                            )}
                            <span className={`flex-1 text-sm font-medium ${isCompleted ? 'text-gray-500 line-through' : isPending ? 'text-gray-400' : 'text-gray-900'}`}>
                              {title}
                            </span>
                            {isCompleted && <span className="text-gray-600 text-sm font-medium">Finished</span>}
                            {isActive && (
                              <span className="text-gray-700 text-sm font-medium flex items-center gap-1.5">
                                Analyzing...
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
          <motion.div
            className="my-[18px]"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.25, 0.1, 0.25, 1], delay: 0.35 }}
          >
            <div className="flex justify-center gap-3">
              {/* Start: Profile Images */}
              <div className="flex -space-x-2">
                {['/client_first.png', '/client_second.png', '/client_third.png'].map((src, i) => (
                  <motion.div
                    key={src}
                    className="w-10 h-10 rounded-full border-2 border-white overflow-hidden bg-gray-200"
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1], delay: 0.45 + i * 0.09 }}
                  >
                    <img src={src} alt="user" className="w-[40px] h-[40px] object-cover" />
                  </motion.div>
                ))}
              </div>

              {/* End: Stars and Text */}
              <motion.div
                className="flex flex-col"
                initial={{ opacity: 0, x: 6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1], delay: 0.55 }}
              >
                <div className=" gap-1">
                  {[...Array(5)].map((_, i) => (
                    <motion.span
                      key={i}
                      className="text-[#FFB66E] text-lg w-[16px] h-[16px]"
                      initial={{ opacity: 0, scale: 0.3 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1], delay: 0.65 + i * 0.06 }}
                    >
                      ★
                    </motion.span>
                  ))}
                </div>
                <motion.p
                  className="text-xs font-semibold text-[#71717A] mt-[6px]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.45, ease: [0.25, 0.1, 0.25, 1], delay: 0.92 }}
                >
                  Trusted by e-commerce founders
                </motion.p>
              </motion.div>
            </div>
          </motion.div>
        )}
      </div>
    </main>
  )
}