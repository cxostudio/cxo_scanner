'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Cog } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { z } from 'zod'
import { toast } from 'react-toastify'
import SelectButton from './components/SelectButton'
import emailjs from '@emailjs/browser'
import { DualViewportLoader, type InstantPreviewHint } from './components/DualViewportLoader';
import { QuadrantScanSequence } from './components/QuadrantScanSequence';


interface Rule {
  id: string
  title: string
  description: string
}

interface CheckpointPresentation {
  requiredActions?: string
  justificationsBenefits: string
  examples: Array<{ url: string; filename: string; thumbnailUrl: string }>
}

interface ScanResult {
  ruleId: string
  ruleTitle: string
  passed: boolean
  reason: string
  checkpoint?: CheckpointPresentation
}

interface BatchData {
  batchId: string
  url: string
  rules: Rule[]
  batchIndex: number
  totalBatches: number
  timestamp: number
}

type NdComplete = {
  type: 'complete';
  message?: string;
  quadrants?: string[];
  quadrantLabels?: string[];
  url?: string;
  previewDesktop?: string;
  previewMobile?: string;
  redirectWarning?: string;
};

/** sessionStorage often hits quota after lastScreenshot; fall back to localStorage for scan previews */
function persistScanPreview(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value)
    return
  } catch {
    /* QuotaExceeded or private mode */
  }
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}
const LOADER_MESSAGES = [
  'Capturing page screenshots',
  'Scanning sections',
  'Almost ready',
] as const;

/** Favicon + host for instant loading UI before the first streamed screenshot (desktop first, then mobile). */
function instantPreviewFromWebsiteUrl(raw: string): InstantPreviewHint | null {
  try {
    const t = raw.trim()
    if (!t) return null
    const abs = /^https?:\/\//i.test(t) ? t : `https://${t}`
    const u = new URL(abs)
    const host = (u.hostname || '').replace(/^www\./, '') || u.hostname
    if (!host) return null
    return {
      host,
      faviconUrl: `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(host)}`,
    }
  } catch {
    return null
  }
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
  const [quadrants, setQuadrants] = useState<string[]>([]);
  const [quadrantLabels, setQuadrantLabels] = useState<string[]>([]);
  const [analyzedUrl, setAnalyzedUrl] = useState<string | null>(null);
  const [redirectWarning, setRedirectWarning] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [loaderMsgIndex, setLoaderMsgIndex] = useState(0);
  const [previewDesktop, setPreviewDesktop] = useState<string | null>(null);
  const [previewMobile, setPreviewMobile] = useState<string | null>(null);
  const [displayedMounted, setDisplayedMounted] = useState(0)

  const analyzeInstantPreview = useMemo(
    () => (showAnalyze && websiteUrl.trim() ? instantPreviewFromWebsiteUrl(websiteUrl) : null),
    [showAnalyze, websiteUrl],
  )

  /** Step removal timeouts must not be cleared when `mounted` advances (that was preventing rows from removing). */
  const analysisStepRemoveTimeoutsRef = useRef<number[]>([])
  const analysisStepRemovalScheduledRef = useRef<Set<number>>(new Set())
  const analyzeTopRef = useRef<HTMLDivElement | null>(null)
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

  /** Shown during analyze; progress + row exits follow rule batch scanning (`progress`), not the X-Ray preview stream. */
  const analysisSteps = [
    'Crawling your product page structure',
    'Analyzing user experience and interface',
    'Analyzing content and copy effectiveness',
    'Generating conversion recommendations',
    'Finalizing your audit report',
  ] as const
  const ANALYSIS_STEP_COUNT = analysisSteps.length
  /** Virtual ticks per /api/scan batch so the bar & step rows keep moving during long requests (not stuck at 5/6). */
  const SCAN_PROGRESS_UNITS_PER_BATCH = 40
  /**
   * After /api/scan/combine, advance `current` in small steps so % and mounted don’t jump 66→100 on one frame
   * (slow main thread / Vercel). Total tail slots = 1 + SCAN_PROGRESS_TAIL_TICKS.
   */
  const SCAN_PROGRESS_TAIL_TICKS = 6
  const SCAN_PROGRESS_FINAL_TICK_MS = 420

  /**
   * Progress uses display units: each batch spans SCAN_PROGRESS_UNITS_PER_BATCH ticks while /api/scan runs,
   * plus tail ticks after combine for a smooth finish.
   */
  const targetMounted = useMemo(() => {
    if (!showAnalyze || !progress || progress.total <= 0) return 0
    if (progress.current >= progress.total) return ANALYSIS_STEP_COUNT
    return Math.min(
      ANALYSIS_STEP_COUNT - 1,
      Math.floor((progress.current / progress.total) * ANALYSIS_STEP_COUNT),
    )
  }, [showAnalyze, progress, ANALYSIS_STEP_COUNT])

  const analyzeProgressPercent = useMemo(() => {
    if (!showAnalyze || !progress || progress.total <= 0) return 0
    return Math.min(100, Math.round((progress.current / progress.total) * 100))
  }, [showAnalyze, progress])
  const ANALYSIS_STEP_MIN_ADVANCE_MS = 700

  /** Long enough to read “Finished” before the row exits; keep modest so scans still feel responsive. */
  const ANALYSIS_STEP_REMOVE_DELAY_MS = 950
  /** Brief pause after all batches + combine so the final “Finished” / 100% state is visible before /scanner. */
  const POST_SCAN_UI_BEFORE_REDIRECT_MS = 2200
  /** 0 = no extra wait per row (stagger used to add hundreds of ms per step). */
  const ANALYSIS_STEP_REMOVE_STAGGER_MS = 0

  // Warm the /scanner route while the user sees the analyze UI so client navigation is faster after the scan.
  useEffect(() => {
    if (!showAnalyze) return
    router.prefetch('/scanner')
  }, [showAnalyze, router])

  // While analyze UI is hidden, reset step row removal state.
  useEffect(() => {
    if (!showAnalyze) {
      setRemovedSteps(new Set())
      setDisplayedMounted(0)
    }
  }, [showAnalyze])

  // Throttle step index advancement so late-stage rows don't collapse together on slower environments.
  useEffect(() => {
    if (!showAnalyze) return
    if (displayedMounted >= targetMounted) return
    const id = window.setTimeout(() => {
      setDisplayedMounted((prev) => Math.min(targetMounted, prev + 1))
    }, ANALYSIS_STEP_MIN_ADVANCE_MS)
    return () => window.clearTimeout(id)
  }, [showAnalyze, displayedMounted, targetMounted, ANALYSIS_STEP_MIN_ADVANCE_MS])

  // On mobile, ensure analyze screen starts from the CXO logo.
  useEffect(() => {
    if (!showAnalyze) return
    if (typeof window === 'undefined') return
    if (window.innerWidth >= 1024) return

    const id = window.requestAnimationFrame(() => {
      const el = analyzeTopRef.current
      if (!el) return
      const top = window.scrollY + el.getBoundingClientRect().top - 18
      window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' })
    })
    return () => window.cancelAnimationFrame(id)
  }, [showAnalyze])

  // After each batch, show “Finished” briefly (ANALYSIS_STEP_REMOVE_DELAY_MS), then remove the row.
  useEffect(() => {
    if (!showAnalyze || displayedMounted <= 0) return

    for (let k = 0; k < displayedMounted; k++) {
      if (analysisStepRemovalScheduledRef.current.has(k)) continue
      analysisStepRemovalScheduledRef.current.add(k)

      const idx = k
      const applyRemove = () => {
        setRemovedSteps(prev => {
          if (prev.has(idx)) return prev
          return new Set([...prev, idx])
        })
      }
      if (ANALYSIS_STEP_REMOVE_DELAY_MS <= 0) {
        applyRemove()
      } else {
        const delay =
          ANALYSIS_STEP_REMOVE_DELAY_MS + idx * ANALYSIS_STEP_REMOVE_STAGGER_MS
        const id = window.setTimeout(applyRemove, delay)
        analysisStepRemoveTimeoutsRef.current.push(id)
      }
    }
  }, [displayedMounted, showAnalyze])

  const prepareBatches = (urlToScan: string, rulesToScan: Rule[]): BatchData[] => {
    const batches: BatchData[] = []
    const timestamp = Date.now()
    const totalRules = rulesToScan.length

    if (totalRules === 0) {
      localStorage.setItem('scanBatches', JSON.stringify([]))
      localStorage.setItem('scanResults', JSON.stringify([]))
      return []
    }

    // One /api/scan call = one Puppeteer session. Default: all rules in one batch (fastest).
    // On Vercel Hobby (60s function cap), set NEXT_PUBLIC_SCAN_BATCH_RULES=8 (or similar) to chunk.
    const configuredChunk = parseInt(process.env.NEXT_PUBLIC_SCAN_BATCH_RULES ?? '', 10)
    const chunkSize =
      Number.isFinite(configuredChunk) && configuredChunk > 0
        ? Math.min(configuredChunk, totalRules)
        : totalRules

    const totalBatches = Math.ceil(totalRules / chunkSize)

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const start = batchIndex * chunkSize
      const batchRules = rulesToScan.slice(start, start + chunkSize)

      batches.push({
        batchId: `batch-${timestamp}-${batchIndex}`,
        url: urlToScan,
        rules: batchRules,
        batchIndex: batchIndex,
        totalBatches: totalBatches,
        timestamp: timestamp,
      })
    }

    localStorage.setItem('scanBatches', JSON.stringify(batches))
    localStorage.setItem('scanResults', JSON.stringify([]))

    return batches
  }

  const BATCH_MAX_ATTEMPTS = 2 // initial run + one repeat if any error occurs

  const processBatches = async (batches: BatchData[]) => {
    const allResults: ScanResult[] = []

    const progressTotalUnits = Math.max(
      1,
      batches.length * SCAN_PROGRESS_UNITS_PER_BATCH + 1 + SCAN_PROGRESS_TAIL_TICKS,
    )
    const scanBaseCompleteUnits = batches.length * SCAN_PROGRESS_UNITS_PER_BATCH

    const tickProgressAfterCombine = async () => {
      for (let s = 1; s <= SCAN_PROGRESS_TAIL_TICKS + 1; s++) {
        setProgress({ current: scanBaseCompleteUnits + s, total: progressTotalUnits })
        await new Promise((r) => setTimeout(r, SCAN_PROGRESS_FINAL_TICK_MS))
      }
    }

    setProgress({ current: 0, total: progressTotalUnits })

    const ScanResultsSchema = z.array(
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

    const parseApiErrorMessage = async (response: Response, fallback: string) => {
      let message = fallback
      try {
        const errorData = await response.json()
        message = (errorData as { error?: string }).error || message
      } catch {
        /* ignore JSON parse errors */
      }
      return message
    }

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i]
      const segmentStart = i * SCAN_PROGRESS_UNITS_PER_BATCH
      const segmentPulseCap = segmentStart + SCAN_PROGRESS_UNITS_PER_BATCH - 1
      setProgress({ current: segmentStart, total: progressTotalUnits })

      let batchSucceeded = false
      let lastBatchError: unknown = null

      for (let attempt = 1; attempt <= BATCH_MAX_ATTEMPTS; attempt++) {
        const pulseMs = Math.min(
          6500,
          Math.max(
            700,
            Math.floor((batch.rules.length * 3200) / SCAN_PROGRESS_UNITS_PER_BATCH),
          ),
        )
        let pulseId: number | null = null
        try {
          pulseId = window.setInterval(() => {
            setProgress((prev) => {
              if (!prev) return prev
              const next = Math.min(prev.current + 1, segmentPulseCap)
              return { current: Math.max(prev.current, next), total: prev.total }
            })
          }, pulseMs)

          const response = await fetch('/api/scan', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              url: batch.url,
              rules: batch.rules,
              // Capture once for preview; doing this every batch increases timeout risk on Vercel.
              captureScreenshot: i === 0,
            }),
          })

          if (!response.ok) {
            const message = await parseApiErrorMessage(response, `Failed to scan batch ${i + 1}`)
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
        } finally {
          if (pulseId != null) {
            window.clearInterval(pulseId)
            pulseId = null
          }
        }
      }

      if (!batchSucceeded) {
        console.error(`Batch ${i + 1} failed after ${BATCH_MAX_ATTEMPTS} attempts`)
        // Fallback: split into single-rule scans so one heavy batch doesn't fail entirely.
        if (batch.rules.length > 1) {
          console.warn(`Attempting single-rule fallback for batch ${i + 1}...`)
          for (const rule of batch.rules) {
            let singleRuleSucceeded = false
            let singleRuleError: unknown = null
            for (let singleAttempt = 1; singleAttempt <= BATCH_MAX_ATTEMPTS; singleAttempt++) {
              try {
                const singleRes = await fetch('/api/scan', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    url: batch.url,
                    rules: [rule],
                    captureScreenshot: false,
                  }),
                })
                if (!singleRes.ok) {
                  const msg = await parseApiErrorMessage(singleRes, `Failed single-rule scan for ${rule.id}`)
                  throw new Error(msg)
                }
                const singleData = await singleRes.json()
                const parsed = ScanResultsSchema.parse(singleData.results)
                const result = parsed[0]
                if (!result) {
                  throw new Error('No single-rule result returned')
                }
                if (!allResults.some((r) => r.ruleId === result.ruleId)) {
                  allResults.push(result)
                }
                singleRuleSucceeded = true
                break
              } catch (singleErr) {
                singleRuleError = singleErr
                console.error(
                  `Single-rule fallback failed for ${rule.id} (attempt ${singleAttempt}/${BATCH_MAX_ATTEMPTS}):`,
                  singleErr
                )
                if (singleAttempt < BATCH_MAX_ATTEMPTS) {
                  await new Promise((r) => setTimeout(r, 800))
                }
              }
            }
            if (!singleRuleSucceeded) {
              allResults.push({
                ruleId: rule.id,
                ruleTitle: rule.title,
                passed: false,
                reason: `Error processing rule ${rule.id} in fallback: ${singleRuleError instanceof Error ? singleRuleError.message : 'Unknown error'}`,
              })
            }
          }
        } else {
          batch.rules.forEach(rule => {
            allResults.push({
              ruleId: rule.id,
              ruleTitle: rule.title,
              passed: false,
              reason: `Error processing batch ${i + 1}: ${lastBatchError instanceof Error ? lastBatchError.message : 'Unknown error'}`,
            })
          })
        }
      }

      const remainingBatches = batches.slice(i + 1)
      if (remainingBatches.length > 0) {
        localStorage.setItem('scanBatches', JSON.stringify(remainingBatches))
      } else {
        localStorage.removeItem('scanBatches')
      }

      localStorage.setItem('scanResults', JSON.stringify(allResults))

      setProgress({ current: (i + 1) * SCAN_PROGRESS_UNITS_PER_BATCH, total: progressTotalUnits })
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
        const validatedResults = z
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
          .parse(finalData.results)

        localStorage.setItem('scanResults', JSON.stringify(validatedResults))
        localStorage.setItem('scanUrl', batches[0]?.url || websiteUrl)
        if (websiteScreenshot) {
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
      await tickProgressAfterCombine()
    } catch (finalErr) {
      console.error('Final request error:', finalErr)
      localStorage.setItem('scanResults', JSON.stringify(allResults))
      localStorage.setItem('scanUrl', batches[0]?.url || websiteUrl)
      localStorage.removeItem('scanBatches')
      await tickProgressAfterCombine()
    }

    // Don't set progress to null here (would reset the batch progress bar and step UI)
    // Toast + redirect happen in handleStartScan right after this returns
  }

  /**
   * POST /api/preview_website — NDJSON desktop/mobile preview + quadrants.
   * `onReadyForRuleScan` fires once when a usable preview exists (or on error / stream end) so rule-scan
   * progress stays aligned with the left preview on slow networks (e.g. Vercel).
   */
  const startWebsitePreviewStream = async (
    captureUrl: string,
    gateHooks?: { onReadyForRuleScan?: () => void },
  ) => {
    const trimmed = captureUrl.trim()
    if (!trimmed) {
      setError('Please enter a URL.')
      return
    }
    const urlParam = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    setIsLoading(true)
    setError(null)
    setQuadrants([])
    setQuadrantLabels([])
    setAnalyzedUrl(null)
    setRedirectWarning(null)
    setLoaderMsgIndex(0)
    setPreviewDesktop(null)
    setPreviewMobile(null)

    let gateReleased = false
    const releaseRuleScanGate = () => {
      if (gateReleased) return
      gateReleased = true
      gateHooks?.onReadyForRuleScan?.()
    }

    const previewLooksReady = (s: unknown) => typeof s === 'string' && s.length > 80

    try {
      const response = await fetch('/api/preview_website', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: urlParam }),
      })
      if (!response.ok) {
        const errJson = (await response.json().catch(() => ({}))) as { error?: string; details?: string }
        throw new Error(errJson.details || errJson.error || `HTTP ${response.status}`)
      }
      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error('No response body.')
      }
      const decoder = new TextDecoder()
      let buffer = ''
      const streamState = { complete: null as NdComplete | null }
      const handleNdjsonLine = (line: string) => {
        if (!line.trim()) return
        const msg = JSON.parse(line) as Record<string, unknown>
        if (msg.type === 'meta') return
        if (msg.type === 'preview') {
          if (typeof msg.previewDesktop === 'string') {
            setPreviewDesktop(msg.previewDesktop)
            persistScanPreview('scanPreviewDesktop', msg.previewDesktop)
            if (previewLooksReady(msg.previewDesktop)) releaseRuleScanGate()
          }
          if (typeof msg.preview === 'string' && !msg.previewDesktop) {
            setPreviewDesktop(msg.preview)
            persistScanPreview('scanPreviewDesktop', msg.preview)
            if (previewLooksReady(msg.preview)) releaseRuleScanGate()
          }
          if (typeof msg.previewMobile === 'string') {
            setPreviewMobile(msg.previewMobile)
            persistScanPreview('scanPreviewMobile', msg.previewMobile)
            if (previewLooksReady(msg.previewMobile)) releaseRuleScanGate()
          }
        }
        if (msg.type === 'error') {
          throw new Error(
            typeof msg.details === 'string'
              ? msg.details
              : typeof msg.error === 'string'
                ? msg.error
                : 'Capture failed'
          )
        }
        if (msg.type === 'complete') {
          streamState.complete = msg as NdComplete
        }
      }
      while (true) {
        const { done, value } = await reader.read()
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          handleNdjsonLine(line)
        }
        if (done) {
          if (buffer.trim()) {
            handleNdjsonLine(buffer)
          }
          break
        }
      }
      const gotComplete = streamState.complete
      if (typeof gotComplete?.previewDesktop === 'string' && gotComplete.previewDesktop.length > 0) {
        setPreviewDesktop(gotComplete.previewDesktop)
        persistScanPreview('scanPreviewDesktop', gotComplete.previewDesktop)
        if (previewLooksReady(gotComplete.previewDesktop)) releaseRuleScanGate()
      }
      if (typeof gotComplete?.previewMobile === 'string') {
        setPreviewMobile(gotComplete.previewMobile)
        persistScanPreview('scanPreviewMobile', gotComplete.previewMobile)
        if (previewLooksReady(gotComplete.previewMobile)) releaseRuleScanGate()
      }
      if (gotComplete?.quadrants != null && gotComplete.quadrants.length > 0) {
        setQuadrants(gotComplete.quadrants)
        setQuadrantLabels(gotComplete.quadrantLabels ?? [])
        setAnalyzedUrl(gotComplete.url ?? urlParam)
        setRedirectWarning(gotComplete.redirectWarning ?? null)
      } else {
        setError('No capture data returned.')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.')
      console.error('Website preview stream error:', err)
      releaseRuleScanGate()
    } finally {
      setIsLoading(false)
      releaseRuleScanGate()
    }
  }

  const handleStartScan = async () => {
    setUrlError('')
    setEmailError('')
  
    const urlTrimmed = websiteUrl.trim()
    const emailTrimmed = email.trim()
  
    // ✅ Basic validation
    if (!urlTrimmed) return setUrlError('Website URL is required')
    if (!emailTrimmed) return setEmailError('Email address is required')
  
    const urlResult = URLSchema.safeParse(urlTrimmed)
    if (!urlResult.success) {
      return setUrlError(urlResult.error.errors[0]?.message || 'Invalid URL')
    }
  
    const emailResult = EmailSchema.safeParse(emailTrimmed)
    if (!emailResult.success) {
      return setEmailError(emailResult.error.errors[0]?.message || 'Invalid email')
    }
  
    try {
      setIsStartingScan(true)

      // ✅ Normalize URL (used for server-filtered checkpoints + scan)
      let validUrl = urlResult.data!
      if (!/^https?:\/\//i.test(validUrl)) {
        validUrl = `https://${validUrl}`
      }

      // ✅ Rules filtered on the server by `url` (detected page type + Airtable Page Type IDs)
      const cpRes = await fetch(
        `/api/conversion-checkpoints?url=${encodeURIComponent(validUrl)}`,
      )
      if (!cpRes.ok) throw new Error('Failed to load conversion checkpoints')
      const cpData = (await cpRes.json()) as {
        rules?: unknown
        records?: unknown
        detectedPageType?: string
        requiredPageTypeIds?: string[]
        filteredRulesCount?: number
        filterUsedFallback?: boolean
      }
      console.log('[conversion-checkpoints] for scan (server-filtered):', {
        url: validUrl,
        detectedPageType: cpData.detectedPageType,
        requiredPageTypeIds: cpData.requiredPageTypeIds,
        filteredRulesCount: cpData.filteredRulesCount,
        filterUsedFallback: cpData.filterUsedFallback,
        fullPayload: cpData,
      })

      const rulesToUse = z.array(RuleSchema).parse(cpData.rules ?? [])
      setRules(rulesToUse)

      if (!rulesToUse.length) {
        throw new Error('No rules available for this URL')
      }

      // ✅ Browser info
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
  
      // ✅ Get IP (safe)
      let ipAddress = 'Unknown'
      try {
        const res = await fetch('https://api.ipify.org?format=json')
        if (res.ok) {
          const data = await res.json()
          ipAddress = data?.ip || 'Unknown'
        }
      } catch {
        console.warn('IP fetch failed')
      }
  
      // ✅ UI setup
      setShowAnalyze(true)
      setProgress(null)
      setWebsiteScreenshot(null)
      setCurrentBatchNumber(0)
      setIframeError(false)
      setRemovedSteps(new Set())
      setDisplayedMounted(0)
      try {
        sessionStorage.removeItem('scanPreviewMobile')
        sessionStorage.removeItem('scanPreviewDesktop')
      } catch {
        /* ignore */
      }
      try {
        localStorage.removeItem('scanPreviewMobile')
        localStorage.removeItem('scanPreviewDesktop')
      } catch {
        /* ignore */
      }
      analysisStepRemoveTimeoutsRef.current.forEach((tid) => window.clearTimeout(tid))
      analysisStepRemoveTimeoutsRef.current = []
      analysisStepRemovalScheduledRef.current = new Set()
  
      // One frame so the analyze panel paints before heavy work (avoid extra 200ms delay)
      await new Promise<void>((r) => requestAnimationFrame(() => r()))

      let resolvePreviewGate!: () => void
      const previewReadyPromise = new Promise<void>((r) => {
        resolvePreviewGate = r
      })
      let previewGateSettled = false
      let previewGateTimeoutId = 0
      const settlePreviewGate = () => {
        if (previewGateSettled) return
        previewGateSettled = true
        if (previewGateTimeoutId !== 0) window.clearTimeout(previewGateTimeoutId)
        resolvePreviewGate()
      }
      previewGateTimeoutId = window.setTimeout(settlePreviewGate, 60_000)

      const streamPromise = startWebsitePreviewStream(validUrl, {
        onReadyForRuleScan: settlePreviewGate,
      })
      void streamPromise.catch((e) => console.error('Preview stream:', e))

      await previewReadyPromise

      // ✅ Screenshot (non-blocking, clean)
      ;(async () => {
        try {
          const res = await fetch('/api/screenshot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: validUrl }),
          })
  
          if (!res.ok) return
  
          const data = await res.json()
          if (data?.screenshot) {
            setWebsiteScreenshot(data.screenshot)
            sessionStorage.setItem('lastScreenshot', data.screenshot)
          }
        } catch (err) {
          console.warn('Screenshot  failed:', err)
        }
      })()
  
      // Main scan: POST /api/scan per batch, then /api/scan/combine (after preview is visible or gate timeout)
      const batches = prepareBatches(validUrl, rulesToUse)
      await processBatches(batches)

      await new Promise<void>((r) => window.setTimeout(r, POST_SCAN_UI_BEFORE_REDIRECT_MS))
      router.replace('/scanner')
    
      setTimeout(() => {
        let passResult: string | number = 'N/A'
        let failResult: string | number = 'N/A'

        try {
          const stored = localStorage.getItem('scanResults')
          if (stored) {
            const parsed = z
              .array(
                z
                  .object({
                    ruleId: z.string(),
                    ruleTitle: z.string(),
                    passed: z.boolean(),
                    reason: z.string(),
                  })
                  .passthrough(),
              )
              .parse(JSON.parse(stored))

            const pass = parsed.filter(r => r.passed).length
            passResult = `${pass}/${parsed.length}`
            failResult = `${parsed.length - pass}/${parsed.length}`
          }
        } catch {
          console.warn('Summary parsing failed')
        }

        // emailjs.send(
        //   EMAILJS_SERVICE_ID,
        //   EMAILJS_TEMPLATE_ID,
        //   {
        //     level: selectedChallenge ?? '',
        //     price: selectedRevenue ?? '',
        //     url: validUrl,
        //     email: emailTrimmed,
        //     ip_address: ipAddress,
        //     browser,
        //     screen_size: screenSize,
        //     time_zone: timeZone,
        //     browser_data: browserData,
        //     pass_result: passResult,
        //     fail_result: failResult,
        //   },
        //   { publicKey: EMAILJS_PUBLIC_KEY }
        // ).catch(err => console.error('EmailJS failed:', err))

        toast.success('Scan completed successfully!')
      }, 0)
      

    } catch (err) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : 'Something went wrong')
      setShowAnalyze(false)
    } finally {
      // Only reset button loading. Do NOT setShowAnalyze(false) here on success —
      // router.replace is async; flipping showAnalyze would flash the form before /scanner mounts.
      setIsStartingScan(false)
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


  useEffect(() => {
    if (!isLoading) return;
    const id = window.setInterval(() => {
      setLoaderMsgIndex((i) => (i + 1) % LOADER_MESSAGES.length);
    }, 2800);
    return () => window.clearInterval(id);
  }, [isLoading]);

  return (
    <main className="flex items-start justify-center md:px-4 min-h-screen w-full overflow-x-hidden  bg-gray-100">
      <div className={`w-full mx-auto px-4 sm:px-6  ${showAnalyze ? 'max-w-[1400px]' : 'sm:h-screen md:h-auto max-w-[600px]'}`}>
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
        <div className="w-full mx-auto">
          {!showAnalyze ? (
            <>
              <AnimatePresence mode="wait">
                {currentStep === 1 && (
                  <motion.div
                    key="step1"
                    className="min-h-[350px]"
                    initial={{ opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -24 }}
                    transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
                  >
                    <motion.h2
                      className="text-2xl  tracking-[-0.03em] font-plus-jakarta   font-semibold text-[#09090b] text-center mt-[35px] mb-[28px]"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.45, ease: [0.25, 0.1, 0.25, 1], delay: 0.06 }}
                    >
                      What's your biggest challenge right now?
                    </motion.h2>
                    <div>
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
                    className="min-h-[350px]"
                    initial={{ opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -24 }}
                    transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
                  >
                    <motion.h2
                      className="text-2xl tracking-[-0.03em] font-plus-jakarta  font-semibold text-[#09090b] text-center mt-[35px] mb-[28px]"
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
                    className="min-h-[350px]"
                    initial={{ opacity: 0, x: 24 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -24 }}
                    transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
                  >
                      <motion.h2
                        className=" text-center text-2xl md:text-4xl font-semibold font-plus-jakarta leading-[48px] tracking-[-0.03em] me-[12px] mt-[35px]"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.45, ease: [0.25, 0.1, 0.25, 1], delay: 0.06 }}
                      >
                        <span className="text-[#757575]"><i>You're almost done!</i></span><br />
                        <span className="text-[#09090b]">Let's finish your audit</span>
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
                        className={` w-full mt-2 px-4 py-3 border rounded-lg bg-white text-base focus:outline-none ${urlError ? 'border-red-500' : 'border-gray-300'}`}
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
                          className={`w-full mt-2 px-4 py-3 border rounded-lg bg-white text-base focus:outline-none ${emailError ? 'border-red-500' : 'border-gray-300'}`}
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
                  className='flex'
                >
                  <motion.button
                    type="button"
                    onClick={handleNext}
                    disabled={!isStepValid()}
                    className={`w-full my-[18px] flex items-center justify-center gap-1 h-[50px] rounded-[10px] py-[9px] pr-[12px] pl-[16px] text-[16px] font-bold cursor-pointer flex-[1_0_0] items-center justify-center gap-1 transition-colors ${!isStepValid()
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                      : 'bg-black text-white'
                      }`}
                    whileHover={isStepValid() ? { scale: 1.015 } : {}}
                    whileTap={isStepValid() ? { scale: 0.985 } : {}}
                    transition={{ type: 'tween', duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
                  >
                      <span>Continue</span>
                      <span>
                      <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 256 256"
    className="w-4 h-4 fill-current"
  >
    <path d="M184.49,136.49l-80,80a12,12,0,0,1-17-17L159,128,87.51,56.49a12,12,0,1,1,17-17l80,80A12,12,0,0,1,184.49,136.49Z" />
  </svg>
                      </span>
                  </motion.button>
                </motion.div>
              ) : (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1], delay: 0.28 }}
                  className='flex'
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
                      className={`w-full my-[18px] flex items-center justify-center gap-2 h-[50px] flex-[1_0_0] rounded-[10px] py-[9px] pr-[12px] pl-[16px] text-[16px] font-bold cursor-pointer flex items-center justify-center gap-1 transition-colors ${!websiteUrl || !email
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        : 'bg-black text-white shadow-2xl'
                        }`}
                      whileHover={websiteUrl && email ? { scale: 1.015 } : {}}
                      whileTap={websiteUrl && email ? { scale: 0.985 } : {}}
                      transition={{ type: 'tween', duration: 0.28, ease: [0.25, 0.1, 0.25, 1] }}
                    >
                      <span>Access my results</span>
                      <span>
                         <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 256 256"
    className="w-4 h-4 fill-current"
  >
    <path d="M184.49,136.49l-80,80a12,12,0,0,1-17-17L159,128,87.51,56.49a12,12,0,1,1,17-17l80,80A12,12,0,0,1,184.49,136.49Z" />
  </svg>
                      </span>
                    </motion.button>
                  )}
                </motion.div>
              )}
            </>
          ) : (
            <>
              {/* BYTEEX-style dark analyze screen */}
              <div className="pt-8 pb-12">
                <div ref={analyzeTopRef} className="text-center mb-4">
              <img src="/cxo_studio_logo.png" alt="logo" className="mx-auto w-[117.54px] h-[20px] object-cover" />
              </div>
     

                {/* Preview + right-side progress panel (stacked on small screens). */}
                {websiteUrl && (
                  <div className="mb-8 w-full">
                    {error && (
                      <div className="mx-auto mb-4 max-w-2xl rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-center text-sm text-red-800 shadow-sm">
                        <strong>Error:</strong> {error}
                      </div>
                    )}

                    <div className="mx-auto mt-[30px] grid w-full min-w-0 max-w-[1400px] gap-5 px-0 max-sm:px-3 sm:px-0 lg:grid-cols-[minmax(0,1fr)_minmax(360px,520px)] lg:items-start lg:gap-x-6 lg:gap-y-5">
                      <div className="flex min-h-0 min-w-0 flex-col">
                        {isLoading && quadrants.length === 0 && (
                          <DualViewportLoader
                            align="start"
                            previewDesktop={previewDesktop}
                            previewMobile={previewMobile}
                            instantPreview={analyzeInstantPreview}
                            scanning
                            statusText={`${LOADER_MESSAGES[loaderMsgIndex]}…`}
                          />
                        )}
                        {quadrants.length > 0 && (
                          <div className="w-full min-w-0 max-w-none">
                            {previewDesktop && (
                              <div className="mb-8">
                                <DualViewportLoader
                                  align="start"
                                  previewDesktop={previewDesktop}
                                  previewMobile={previewMobile}
                                  scanning={false}
                                />
                              </div>
                            )}
                            {redirectWarning && (
                              <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                                <strong>Redirect / geo-block:</strong> {redirectWarning}
                              </div>
                            )}
                            <QuadrantScanSequence
                              quadrants={quadrants}
                              quadrantLabels={quadrantLabels}
                              previewDesktop={previewDesktop}
                              previewMobile={previewMobile}
                            />
                          </div>
                        )}
                      </div>

                      <aside className="flex min-h-[462px] w-full max-w-full flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white/90 p-4 shadow-sm backdrop-blur-sm lg:h-[462px] lg:min-h-[462px]">
                        <div
                          className="w-full shrink-0"
                          role="progressbar"
                          aria-valuenow={analyzeProgressPercent}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        >
                          <div className="mb-1.5 flex items-center justify-between gap-3">
                            <span className="text-xs font-medium text-zinc-600">Progress</span>
                            <span className="text-xs font-medium tabular-nums text-zinc-800">
                              {analyzeProgressPercent}%
                            </span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
                            <div
                              className="h-full rounded-full bg-gray-600 transition-[width] duration-500 ease-in-out"
                              style={{ width: `${analyzeProgressPercent}%` }}
                            />
                          </div>
                        </div>

                        <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-x-hidden overflow-y-auto overscroll-contain">
                          <AnimatePresence mode="sync" initial={false}>
                            {analysisSteps
                              .map((title, index) => ({ title, index, id: `step-${index}-${title}` }))
                              .filter(({ index }) => !removedSteps.has(index))
                              .map(({ title, index, id }) => {
                                const isCompleted = index < displayedMounted
                                const isActive = index === displayedMounted
                                const isPending = index > displayedMounted

                                return (
                                  <motion.div
                                    key={id}
                                    layout
                                    initial={{ opacity: 0, y: 18, scale: 0.98 }}
                                    animate={{
                                      opacity: isPending ? 0.45 : 1,
                                      y: 0,
                                      scale: 1,
                                    }}
                                    exit={{
                                      x: 32,
                                      opacity: [1, 0.7, 0],
                                      y: 0,
                                      scale: [1, 0.99, 0.985],
                                      transition: { duration: 0.9, ease: [0.22, 1, 0.36, 1] },
                                    }}
                                    transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                                    className="flex min-w-0 items-center gap-3 rounded-xl border border-gray-200 bg-white p-3 sm:gap-4 sm:p-4"
                                  >
                                    {isCompleted ? (
                                      <div className="flex h-5 w-5 shrink-0 items-center justify-center">
                                        <img src="/check.png" alt="" className="h-3.5 w-3.5 object-cover" />
                                      </div>
                                    ) : (
                                      <Cog
                                        className={`h-5 w-5 shrink-0 text-gray-400 ${isActive ? 'animate-spin' : ''}`}
                                        aria-hidden
                                      />
                                    )}
                                    <span
                                      className={`min-w-0 flex-1 text-sm font-medium ${
                                        isCompleted
                                          ? 'text-gray-500 line-through'
                                          : isPending
                                            ? 'text-gray-400'
                                            : 'text-gray-900'
                                      }`}
                                    >
                                      {title}
                                    </span>
                                    {isCompleted && (
                                      <span className="shrink-0 text-xs font-medium text-gray-600 sm:text-sm">
                                        Finished
                                      </span>
                                    )}
                                  </motion.div>
                                )
                              })}
                          </AnimatePresence>
                        </div>
                      </aside>
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
            <div className="flex justify-center gap-3 items-center">
              {/* Start: Profile Images */}
              <div className="flex -space-x-2">
                {['/client_first.png', '/client_second.png', '/client_third.png'].map((src, i) => (
                  <motion.div
                    key={src}
                    className="w-10 h-10 rounded-full border-2 border-white overflow-hidden bg-gray-200 shadow-[0_1px_5px_#00000026]"
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
                  className="text-xs font-semibold text-[#71717A] mt-[2px]"
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
