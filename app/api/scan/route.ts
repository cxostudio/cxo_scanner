import { NextRequest, NextResponse } from 'next/server'
import { OpenRouter } from '@openrouter/sdk'
import { z } from 'zod'
import { Rule, ScanResult, RuleSchema } from './types'
import { sleep, extractRetryAfter, normalizeAmazonUrl } from './utils'
import {
  launchBrowser,
  navigateToPage,
  waitForImages,
  scrollPage,
  captureScreenshot,
  getPageContent,
  getKeyElements,
  closeBrowser,
} from './browser'
import { createAIService, scanWithAI } from './ai-service'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Extended schema that accepts pre-captured content
const ExtendedScanRequestSchema = z.object({
  url: z.string()
    .min(1, 'URL is required')
    .url('Invalid URL format'),
  rules: z.array(RuleSchema)
    .min(1, 'At least one rule is required')
    .max(100, 'Maximum 100 rules allowed per scan'),
  captureScreenshot: z.boolean().optional().default(true),
  // Optional pre-captured content for batches (avoids re-launching browser)
  preCapturedScreenshot: z.string().optional(),
  preCapturedText: z.string().optional(),
  preCapturedElements: z.string().optional(),
})

export async function POST(request: NextRequest) {
  let browser: any = null

  try {
    const body = await request.json()
    const validationResult = ExtendedScanRequestSchema.safeParse(body)

    if (!validationResult.success) {
      const errors = validationResult.error.errors.map(err => `${err.path.join('.')}: ${err.message}`).join(', ')
      return NextResponse.json(
        { error: `Validation failed: ${errors}` },
        { status: 400 }
      )
    }

    const {
      url,
      rules,
      captureScreenshot: shouldCaptureScreenshot = true,
      preCapturedScreenshot,
      preCapturedText,
      preCapturedElements
    } = validationResult.data

    // Normalize URL
    let validUrl = url.trim()
    if (!validUrl.startsWith('http://') && !validUrl.startsWith('https://')) {
      validUrl = 'https://' + validUrl
    }
    validUrl = normalizeAmazonUrl(validUrl)

    // Check API key
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { error: 'API key is not configured. Please set OPENROUTER_API_KEY in .env.local file' },
        { status: 500 }
      )
    }

    const openRouter = createAIService({ apiKey })

    // Use pre-captured content if available (for batches 2+), otherwise launch browser
    let screenshotDataUrl: string | null = preCapturedScreenshot || null
    let visibleText: string = preCapturedText || ''
    let keyElements: string = preCapturedElements || ''

    // Only launch browser if we don't have pre-captured content
    if (!screenshotDataUrl || !visibleText || !keyElements) {
      console.log('Launching browser for first batch...')
      const { browser: browserInstance, page } = await launchBrowser()
      browser = browserInstance

      await navigateToPage(page, validUrl)
      await waitForImages(page)
      await scrollPage(page, validUrl)

      // Capture screenshot
      if (shouldCaptureScreenshot) {
        screenshotDataUrl = await captureScreenshot(page)
      }

      // Get page content
      visibleText = await getPageContent(page)
      keyElements = await getKeyElements(page)
    } else {
      console.log('Using pre-captured content for batch...')
    }

    // Process all rules
    const results: ScanResult[] = []
    const BATCH_SIZE = 5
    const batches: Rule[][] = []

    for (let i = 0; i < rules.length; i += BATCH_SIZE) {
      batches.push(rules.slice(i, i + BATCH_SIZE))
    }

    let lastRequestTime = 0
    const minDelayBetweenRequests = 1000 // 1 second minimum

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex]
      console.log(`Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} rules)`)

      for (const rule of batch) {
        try {
          // Rate limiting
          const timeSinceLastRequest = Date.now() - lastRequestTime
          if (timeSinceLastRequest < minDelayBetweenRequests) {
            await sleep(minDelayBetweenRequests - timeSinceLastRequest)
          }

          const result = await scanWithAI(openRouter, rule, {
            url: validUrl,
            visibleText,
            keyElements,
            screenshotDataUrl,
          })

          results.push(result)
          lastRequestTime = Date.now()
        } catch (error) {
          console.error(`Error scanning rule ${rule.id}:`, error)

          let errorMessage = error instanceof Error ? error.message : 'Unknown error'

          // Handle specific error types
          if (errorMessage.includes('rate_limit') || errorMessage.includes('429')) {
            const retryAfter = extractRetryAfter(errorMessage)
            if (retryAfter > 0) {
              console.log(`Rate limit hit, waiting ${retryAfter}ms before retry...`)
              await sleep(retryAfter)
            }
            errorMessage = 'Rate limit exceeded. Please try again.'
          } else if (errorMessage.includes('404') || errorMessage.includes('not found')) {
            errorMessage = 'AI model not found. Please check model availability.'
          }

          results.push({
            ruleId: rule.id,
            ruleTitle: rule.title,
            passed: false,
            reason: `Error: ${errorMessage}`,
          })

          lastRequestTime = Date.now()
        }
      }

      // Small delay between batches
      if (batchIndex < batches.length - 1) {
        await sleep(300)
      }
    }

    console.log(`Scan completed. ${results.length}/${rules.length} rules processed.`)

    return NextResponse.json({
      results,
      screenshot: screenshotDataUrl,
    })
  } catch (error) {
    console.error('Scan error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'An error occurred' },
      { status: 500 }
    )
  } finally {
    if (browser) {
      await closeBrowser(browser)
    }
  }
}
