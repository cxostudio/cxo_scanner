'use client'

import { useState,useEffect } from 'react'
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
  .refine((url) => {
    try {
      const validUrl = url.startsWith('http') ? url : `https://${url}`
      new URL(validUrl)
      return true
    } catch {
      return false
    }
  }, 'Invalid URL format')

export default function Home() {
  const router = useRouter()
  const [currentStep, setCurrentStep] = useState(1)
  const [mounted, setMounted] = useState(0)
  const [selectedChallenge, setSelectedChallenge] = useState<string | null>(null)
  const [selectedRevenue, setSelectedRevenue] = useState<string | null>(null)
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [email, setEmail] = useState('')
  const [showAnalyze, setShowAnalyze] = useState(false)
  const [rules, setRules] = useState<Rule[]>([])
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)
  const [websiteScreenshot, setWebsiteScreenshot] = useState<string | null>(null)
  const [currentBatchNumber, setCurrentBatchNumber] = useState<number>(0)
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
  }, [showAnalyze])

  useEffect(() => {
    if (!showAnalyze || !progress) {
      return
    }

    // Update mounted based on batch progress
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
          setWebsiteScreenshot(data.screenshot)
          setCurrentBatchNumber(i + 1)
          // Store in sessionStorage for results page (not localStorage due to size limits)
          try {
            sessionStorage.setItem('lastScreenshot', data.screenshot)
            console.log(`Screenshot updated from batch ${i + 1} and stored in sessionStorage`)
          } catch (e) {
            console.warn('Could not store screenshot in sessionStorage:', e)
          }
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
        // Wait 10 seconds between batches to give rate limit window time to reset
        // Backend already handles 40s delays between rules, this is just an extra buffer
        await new Promise(resolve => setTimeout(resolve, 10000))
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
        localStorage.setItem('scanUrl', websiteUrl)
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
        localStorage.setItem('scanUrl', websiteUrl)
        localStorage.removeItem('scanBatches')
      }
    } catch (finalErr) {
      console.error('Final request error:', finalErr)
      localStorage.setItem('scanResults', JSON.stringify(allResults))
      localStorage.setItem('scanUrl', websiteUrl)
      localStorage.removeItem('scanBatches')
    }
    
    setProgress(null)
    // Complete all steps
    setMounted(analysisSteps.length - 1)
    
    // Wait a bit then redirect
    setTimeout(() => {
      router.push('/scanner')
    }, 1000)
  }

  const handleStartScan = async () => {
    if (!websiteUrl.trim()) {
      toast.error('Please enter a website URL')
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
      const validatedUrl = URLSchema.parse(websiteUrl.trim())
      let validUrl = validatedUrl
      if (!validUrl.startsWith('http://') && !validUrl.startsWith('https://')) {
        validUrl = 'https://' + validUrl
      }

      setShowAnalyze(true)
      setMounted(0)
      setProgress(null)
      setWebsiteScreenshot(null) // Reset screenshot for new scan
      setCurrentBatchNumber(0) // Reset batch number
      // Screenshot not stored in localStorage, no need to remove

      const batches = prepareBatches(validUrl, rulesToUse)
      await processBatches(batches)
      
      toast.success('Scan completed successfully!')
    } catch (err) {
      if (err instanceof z.ZodError) {
        toast.error(`Invalid URL: ${err.errors[0]?.message || 'Please enter a valid URL'}`)
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
    <main className="flex items-center  justify-center md:px-4 bg-[#FDFDFD] min-h-screen w-full overflow-x-hidden">
      <div className="max-w-[400px] w-full mx-auto px-4 sm:px-6">
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
                        Website URL:
                      </label>
                      <input
                        type="url"
                        value={websiteUrl}
                        onChange={(e) => setWebsiteUrl(e.target.value)}
                        placeholder="Enter the URL of your main product page"
                        className="w-full mt-[13px] px-4 py-3 border border-gray-300 rounded-xl bg-white text-sm focus:outline-none"
                      />
                    <div className="relative mt-[19px]">
                      <label className="block text-sm font-semibold text-black">
                        Email address:
                      </label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Enter your best email address"
                        className="w-full mt-[12px] px-4 py-3 border border-gray-300 rounded-xl bg-white text-sm focus:outline-none"
                      />
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
                    className={`w-full py-[18px] rounded-xl transition font-semibold text-sm text-center cursor-pointer ${
                      !isStepValid()
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        : 'bg-black text-white hover:bg-gray-800'
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
                    className={`w-full py-[18px] rounded-xl transition font-semibold text-sm text-center cursor-pointer ${
                      !websiteUrl || !email
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        : 'bg-black text-white hover:bg-gray-800'
                    }`}
                  >
                    Access my results ›
                  </button>
                </div>
              )}
            </>
          ) : (
           <>
            <h2 className="text-3xl md:text-4xl font-bold text-[#919191] text-center mb-8 flex items-center justify-center whitespace-nowrap">
              <span>Analyzing your URL</span>
                <span className="loader ml-2">
                  <span></span>
                  <span></span>
                  <span></span>
                </span>
          </h2>

      {/* Website Screenshot or Phone Placeholder */}
      <div className="flex flex-col items-center">
        {websiteScreenshot ? (
          <>
            {progress && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-4 text-sm text-gray-600 font-semibold"
              >
              </motion.div>
            )}
            {/* iPhone Frame with Screenshot */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className="relative w-full max-w-[375px] mx-auto min-w-0"
              style={{ aspectRatio: '375/812', maxHeight: 'min(90vh, 812px)' }}
            >
              {/* iPhone Frame */}
              <div className="absolute inset-0 bg-gradient-to-b from-gray-800 via-gray-900 to-gray-800 rounded-[3rem] shadow-2xl border-[8px] border-gray-900">
                {/* Notch */}
                <div className="absolute top-0 left-1/2 transform -translate-x-1/2 w-[150px] h-[30px] bg-gray-900 rounded-b-[20px] z-10"></div>
                
                {/* Screen Area */}
                <div className="absolute top-[8px] left-[8px] right-[8px] bottom-[8px] bg-black rounded-[2.5rem] overflow-hidden">
                  {/* Status Bar */}
                  <div className="absolute top-0 left-0 right-0 h-[44px] bg-black z-20 flex items-center justify-between px-6 pt-2">
                    <div className="text-white text-xs font-semibold">9:41</div>
                    <div className="flex items-center gap-1">
                      <div className="w-4 h-2 border border-white rounded-sm">
                        <div className="w-3 h-1.5 bg-white rounded-sm m-0.5"></div>
                      </div>
                      <div className="w-5 h-3 border border-white rounded-sm">
                        <div className="w-4 h-2 bg-white rounded-sm m-0.5"></div>
                      </div>
                      <div className="w-6 h-3 border border-white rounded-sm">
                        <div className="w-5 h-2 bg-white rounded-sm m-0.5"></div>
                      </div>
                    </div>
                  </div>
                  
                  {/* Screenshot Content */}
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3, duration: 0.5 }}
                    className="absolute top-[44px] left-0 right-0 bottom-0 overflow-y-auto bg-white iphone-scrollbar"
                    style={{ 
                      scrollbarWidth: 'thin',
                      scrollbarColor: 'rgba(0, 0, 0, 0.2) transparent'
                    }}
                  >
                    <img 
                      src={websiteScreenshot} 
                      alt={`Website being scanned - Batch ${currentBatchNumber} - Full page view`} 
                      className="w-full h-auto object-contain" 
                    />
                  </motion.div>
                  
                  {/* Home Indicator */}
                  <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 w-[134px] h-[5px] bg-white/30 rounded-full"></div>
                </div>
                
                {/* Side Buttons (Volume, Power) */}
                <div className="absolute left-0 top-[120px] w-[3px] h-[32px] bg-gray-800 rounded-r-sm"></div>
                <div className="absolute left-0 top-[170px] w-[3px] h-[32px] bg-gray-800 rounded-r-sm"></div>
                <div className="absolute right-0 top-[140px] w-[3px] h-[60px] bg-gray-800 rounded-l-sm"></div>
              </div>
            </motion.div>
          </>
        ) : (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
          >
        </motion.div>
        )}
      </div>

      {/* Steps */}
      <div className="mt-[45px]">
        <AnimatePresence mode="sync">
          {analysisSteps
            .map((title, index) => ({ title, index }))
            .filter(({ index }) => {
              const isCompleted = index < mounted
              const shouldAnimateOut = isCompleted && mounted >= index + 2
              return !shouldAnimateOut
            })
            .map(({ title, index }) => {
              const isCompleted = index < mounted
              const isActive = index === mounted

              return (
                <motion.div
                  key={index}
                  layout
                  initial={{ opacity: 0, y: 20 }}
                  animate={{
                    opacity: 1,
                    y: 0,
                  }}
                  exit={{
                    x: 200,          // 👉 right side slide
                    opacity: 0,
                    transition: {
                      duration: 0.6,
                      ease: 'easeInOut',
                    },
                  }}
                  transition={{
                    layout: { duration: 0.4, ease: 'easeOut' },
                    opacity: { duration: 0.3 },
                    y: { duration: 0.3 },
                  }}
                  className={`flex items-center gap-4 p-4 my-[14px] rounded-xl border ${
                    isCompleted
                      ? 'border-green-500'
                      : isActive
                      ? 'border-black border-2'
                      : 'border-gray-300'
                  }`}
                >
                  {isCompleted ? (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: 'spring', stiffness: 200, damping: 15 }}
                      className="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center shrink-0"
                    >
                      <Check className="w-5 h-5 text-white" />
                    </motion.div>
                  ) : (
                    <Cog className={`w-5 h-5 shrink-0 ${isActive ? 'text-black' : 'text-gray-400'}`} />
                  )}

                  <motion.span
                    animate={{
                      textDecoration: isCompleted ? 'line-through' : 'none',
                    }}
                    transition={{ duration: 0.3 }}
                    className={`flex-1 ${
                      isActive ? 'text-black font-semibold text-[14.8px] leading-[28.8px]' : 'text-gray-400 font-semibold text-[14.8px] leading-[28.8px]'
                    }`}
                  >
                    {title}
                  </motion.span>
                </motion.div>
              )
            })}
        </AnimatePresence>
      </div>
           </>
          )}
        </div>

        {/* Social Proof Footer - Only show when not analyzing */}
        {!showAnalyze && (
          <div className="my-[18px]">
            <div className="flex justify-center gap-3">
              {/* Left: Profile Images */}
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
              
              {/* Right: Stars and Text */}
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

