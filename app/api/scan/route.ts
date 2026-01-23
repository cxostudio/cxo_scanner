import { NextRequest, NextResponse } from 'next/server'
import { OpenRouter } from '@openrouter/sdk'
import { z } from 'zod'
import puppeteer from 'puppeteer'

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

// Zod schemas for validation
const RuleSchema = z.object({
  id: z.string().min(1, 'Rule ID is required'),
  title: z.string().min(1, 'Rule title is required').max(200, 'Rule title must be less than 200 characters'),
  description: z.string().min(1, 'Rule description is required').max(5000, 'Rule description must be less than 5000 characters'),
})

const ScanRequestSchema = z.object({
  url: z.string()
    .min(1, 'URL is required')
    .url('Invalid URL format')
    .refine((url) => {
      try {
        const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`)
        return ['http:', 'https:'].includes(urlObj.protocol)
      } catch {
        return false
      }
    }, 'URL must be a valid HTTP or HTTPS URL'),
  rules: z.array(RuleSchema)
    .min(1, 'At least one rule is required')
    .max(100, 'Maximum 100 rules allowed per scan'),
})

// Helper function to sleep/delay
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Helper function to extract retry-after time from error message
const extractRetryAfter = (errorMessage: string): number => {
  const match = errorMessage.match(/try again in ([\d.]+)s/i)
  if (match) {
    return Math.ceil(parseFloat(match[1]) * 1000) // Convert to milliseconds and round up
  }
  return 0
}

// Retry function with exponential backoff for rate limit errors
async function callOpenRouterWithRetry(
  openRouter: OpenRouter,
  params: Parameters<typeof openRouter.chat.send>[0],
  maxRetries: number = 5
): Promise<Awaited<ReturnType<typeof openRouter.chat.send>>> {
  let lastError: Error | null = null
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await openRouter.chat.send(params) as Awaited<ReturnType<typeof openRouter.chat.send>>
    } catch (error: any) {
      lastError = error
      const errorMessage = error?.message || ''
      
      // Check if it's a rate limit error
      if (errorMessage.includes('rate_limit') || errorMessage.includes('Rate limit') || errorMessage.includes('429') || errorMessage.includes('TPM')) {
        const retryAfter = extractRetryAfter(errorMessage)
        const waitTime = retryAfter > 0 
          ? retryAfter 
          : Math.min(1000 * Math.pow(2, attempt), 30000) // Exponential backoff, max 30s
        
        if (attempt < maxRetries - 1) {
          console.log(`Rate limit hit, waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries}`)
          await sleep(waitTime)
          continue
        }
      }
      
      // For non-rate-limit errors or final attempt, throw the error
      throw error
    }
  }
  
  throw lastError || new Error('Max retries exceeded')
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    // Validate request body with Zod
    const validationResult = ScanRequestSchema.safeParse(body)
    
    if (!validationResult.success) {
      const errors = validationResult.error.errors.map(err => `${err.path.join('.')}: ${err.message}`).join(', ')
      return NextResponse.json(
        { error: `Validation failed: ${errors}` },
        { status: 400 }
      )
    }

    const { url, rules } = validationResult.data
    
    // Normalize URL
    let validUrl = url.trim()
    if (!validUrl.startsWith('http://') && !validUrl.startsWith('https://')) {
      validUrl = 'https://' + validUrl
    }

    // OpenRouter API support
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { error: 'API key is not configured. Please set OPENROUTER_API_KEY in .env.local file' },
        { status: 500 }
      )
    }
    
    const openRouter = new OpenRouter({
      apiKey: apiKey,
    })

    // Fetch website content with Puppeteer to detect JavaScript-loaded content
    let websiteContent = ''
    let browser
    try {
      // Launch headless browser
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      })
      
      const page = await browser.newPage()
      
      // Set viewport and user agent
      await page.setViewport({ width: 1920, height: 1080 })
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
      
      // Navigate to the page and wait for network to be idle
      await page.goto(validUrl, {
        waitUntil: 'networkidle2', // Wait until network is idle (JavaScript loaded)
        timeout: 30000, // 30 second timeout
      })
      
      // Wait a bit more for any delayed JavaScript execution
      await new Promise(resolve => setTimeout(resolve, 3000)) // Wait 3 seconds for dynamic content
      
      // Scroll to ensure all content is loaded
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight / 2)
      })
      await new Promise(resolve => setTimeout(resolve, 1000))
      await page.evaluate(() => {
        window.scrollTo(0, 0)
      })
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Get visible text content (more token-efficient than HTML)
      const visibleText = await page.evaluate(() => {
        return document.body.innerText || document.body.textContent || ''
      })
      
      // Get key HTML elements (buttons, links, headings) for CTA detection
      // Sort for consistency - same order every time
      const keyElements = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, a[href], [role="button"]'))
          .map(el => {
            const text = el.textContent?.trim() || el.getAttribute('href') || el.getAttribute('aria-label') || ''
            return text
          })
          .filter(text => text.length > 0)
          .sort() // Sort alphabetically for consistency
          .slice(0, 30) // Increased limit and sort first
          .join(' | ')
        
        const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
          .map(h => h.textContent?.trim())
          .filter(text => text && text.length > 0)
          .sort() // Sort alphabetically for consistency
          .slice(0, 15) // Increased limit
          .join(' | ')
        
        // Get breadcrumb information - multiple selectors to catch all breadcrumb formats
        const breadcrumbSelectors = [
          '[class*="breadcrumb"]',
          'nav[aria-label*="breadcrumb"]',
          '.breadcrumb',
          '[itemtype*="BreadcrumbList"]',
          '[role="navigation"][aria-label*="breadcrumb"]',
          'ol[class*="breadcrumb"]',
          'ul[class*="breadcrumb"]'
        ]
        
        let breadcrumbs = ''
        for (const selector of breadcrumbSelectors) {
          const breadcrumbElements = Array.from(document.querySelectorAll(selector))
          if (breadcrumbElements.length > 0) {
            breadcrumbElements.forEach(bc => {
              const text = bc.textContent?.trim() || ''
              if (text && text.length > 0) {
                // Check if it looks like a breadcrumb (contains "Home", "/", or navigation path)
                if (text.includes('Home') || text.includes('/') || text.match(/\d+\./)) {
                  breadcrumbs = text
                }
              }
            })
            if (breadcrumbs) break
          }
        }
        
        // Also check for numbered breadcrumbs (like "1. Home 2. / mens 3. / New Arrivals")
        // Handle both single-line and multi-line formats
        if (!breadcrumbs) {
          const allText = document.body.innerText || ''
          
          // Try multi-line numbered format first (1. Home\n2. / mens\n3. / New Arrivals)
          const multiLinePattern = /(\d+\.\s*[^\n]+\s*\n\s*\d+\.\s*[^\n]+(?:\s*\n\s*\d+\.\s*[^\n]+)*)/i
          const multiLineMatch = allText.match(multiLinePattern)
          if (multiLineMatch) {
            // Clean up the match - remove extra whitespace and newlines, join with spaces
            breadcrumbs = multiLineMatch[0]
              .replace(/\s*\n\s*/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
          } else {
            // Try single-line numbered format (1. Home 2. / mens 3. / New Arrivals)
            const singleLinePattern = /(\d+\.\s*[^\n]+(?:\s*\/\s*[^\n]+)*)/i
            const singleLineMatch = allText.match(singleLinePattern)
            if (singleLineMatch) {
              breadcrumbs = singleLineMatch[0].trim()
            }
          }
        }
        
        // Additional check: Look for breadcrumb-like patterns in visible text near the top
        if (!breadcrumbs) {
          // Check first 2000 characters of visible text for breadcrumb patterns
          const topText = document.body.innerText?.substring(0, 2000) || ''
          const breadcrumbLikePatterns = [
            /(Home\s*[/>]\s*[^\n]+)/i,
            /(\d+\.\s*Home\s*[/>]?\s*[^\n]+)/i,
            /(Home\s*[/>]\s*\w+\s*[/>]\s*[^\n]+)/i
          ]
          
          for (const pattern of breadcrumbLikePatterns) {
            const match = topText.match(pattern)
            if (match && match[0].length < 100) { // Reasonable breadcrumb length
              breadcrumbs = match[0].trim()
              break
            }
          }
        }
        
        // Get color information for color rules - check computed styles
        const colorInfo = []
        try {
          // Sample key elements to check colors
          const sampleElements = [
            ...Array.from(document.querySelectorAll('body, h1, h2, h3, p, a, button, [class*="text"], [class*="color"]')).slice(0, 20),
            ...Array.from(document.querySelectorAll('[style*="color"], [style*="background"]')).slice(0, 10)
          ]
          
          const uniqueColors = new Set()
          sampleElements.forEach(el => {
            try {
              const computedStyle = window.getComputedStyle(el)
              const textColor = computedStyle.color
              const bgColor = computedStyle.backgroundColor
              
              // Convert rgb to hex if needed
              const rgbToHex = (rgb: string): string | null => {
                if (!rgb || rgb === 'transparent' || rgb === 'rgba(0, 0, 0, 0)') return null
                const match = rgb.match(/\d+/g)
                if (!match || match.length < 3) return null
                const r = parseInt(match[0])
                const g = parseInt(match[1])
                const b = parseInt(match[2])
                return '#' + [r, g, b].map(x => {
                  const hex = x.toString(16)
                  return hex.length === 1 ? '0' + hex : hex
                }).join('')
              }
              
              const textHex = rgbToHex(textColor)
              const bgHex = rgbToHex(bgColor)
              
              if (textHex) uniqueColors.add(`text:${textHex}`)
              if (bgHex) uniqueColors.add(`bg:${bgHex}`)
            } catch (e) {
              // Ignore errors
            }
          })
          
          // Check for pure black (#000000 or rgb(0,0,0))
          const colorArray = Array.from(uniqueColors) as string[]
          const hasPureBlack = colorArray.some((c: string) => 
            c.includes('#000000') || c.includes('rgb(0, 0, 0)') || c.includes('rgb(0,0,0)')
          )
          
          const colorList = Array.from(uniqueColors).slice(0, 15).join(', ')
          colorInfo.push(`Colors found: ${colorList || 'No colors detected'}`)
          colorInfo.push(`Pure black (#000000) detected: ${hasPureBlack ? 'YES' : 'NO'}`)
        } catch (e) {
          colorInfo.push('Color detection: Unable to extract')
        }
        
        // Get lazy loading information for images and videos
        const lazyLoadingInfo = []
        try {
          const images = Array.from(document.querySelectorAll('img'))
          const videos = Array.from(document.querySelectorAll('video'))
          
          let imagesWithLazy = 0
          let imagesWithoutLazy = 0
          let videosWithLazy = 0
          let videosWithoutLazy = 0
          const imagesWithoutLazyList: string[] = []
          const videosWithoutLazyList: string[] = []
          
          // Check images
          images.forEach((img, index) => {
            const loadingAttr = img.getAttribute('loading')
            const src = img.getAttribute('src') || img.getAttribute('data-src') || `image-${index + 1}`
            const isAboveFold = img.getBoundingClientRect().top < window.innerHeight
            
            // Above-fold images should NOT have lazy loading
            if (isAboveFold) {
              // Above-fold images are fine without lazy
              return
            }
            
            // Below-fold images should have lazy loading
            if (loadingAttr === 'lazy' || img.hasAttribute('data-lazy') || img.classList.contains('lazy')) {
              imagesWithLazy++
            } else {
              imagesWithoutLazy++
              if (imagesWithoutLazyList.length < 5) {
                const shortSrc = src.length > 50 ? src.substring(0, 50) + '...' : src
                imagesWithoutLazyList.push(shortSrc)
              }
            }
          })
          
          // Check videos
          videos.forEach((video, index) => {
            const loadingAttr = video.getAttribute('loading')
            const src = video.getAttribute('src') || video.querySelector('source')?.getAttribute('src') || `video-${index + 1}`
            const isAboveFold = video.getBoundingClientRect().top < window.innerHeight
            
            // Above-fold videos should NOT have lazy loading
            if (isAboveFold) {
              return
            }
            
            // Below-fold videos should have lazy loading
            if (loadingAttr === 'lazy' || video.hasAttribute('data-lazy') || video.classList.contains('lazy')) {
              videosWithLazy++
            } else {
              videosWithoutLazy++
              if (videosWithoutLazyList.length < 5) {
                const shortSrc = src.length > 50 ? src.substring(0, 50) + '...' : src
                videosWithoutLazyList.push(shortSrc)
              }
            }
          })
          
          const totalBelowFoldImages = imagesWithLazy + imagesWithoutLazy
          const totalBelowFoldVideos = videosWithLazy + videosWithoutLazy
          
          if (totalBelowFoldImages > 0 || totalBelowFoldVideos > 0) {
            lazyLoadingInfo.push(`Images (below-fold): ${imagesWithLazy} with lazy, ${imagesWithoutLazy} without lazy`)
            lazyLoadingInfo.push(`Videos (below-fold): ${videosWithLazy} with lazy, ${videosWithoutLazy} without lazy`)
            
            if (imagesWithoutLazy > 0) {
              lazyLoadingInfo.push(`Images without lazy loading: ${imagesWithoutLazyList.join(', ')}${imagesWithoutLazy > 5 ? ` (+${imagesWithoutLazy - 5} more)` : ''}`)
            }
            
            if (videosWithoutLazy > 0) {
              lazyLoadingInfo.push(`Videos without lazy loading: ${videosWithoutLazyList.join(', ')}${videosWithoutLazy > 5 ? ` (+${videosWithoutLazy - 5} more)` : ''}`)
            }
            
            // Overall status
            const allHaveLazy = imagesWithoutLazy === 0 && videosWithoutLazy === 0
            lazyLoadingInfo.push(`Lazy loading status: ${allHaveLazy ? 'PASS - All below-fold images/videos have lazy loading' : 'FAIL - Some below-fold images/videos missing lazy loading'}`)
          } else {
            lazyLoadingInfo.push('Lazy loading: No below-fold images or videos found (or all are above-fold)')
          }
        } catch (e) {
          lazyLoadingInfo.push('Lazy loading detection: Unable to extract')
        }
        
        return `Buttons/Links: ${buttons}\nHeadings: ${headings}\nBreadcrumbs: ${breadcrumbs || 'Not found'}\n${colorInfo.join('\n')}\n${lazyLoadingInfo.join('\n')}`
      })
      
      // Combine visible text and key elements (token-efficient)
      websiteContent = (visibleText.length > 4000 ? visibleText.substring(0, 4000) + '...' : visibleText) + 
                      '\n\n--- KEY ELEMENTS ---\n' + keyElements
      
      // Close browser
      await browser.close()
      
      // Final limit to ensure we stay under token budget
      if (websiteContent.length > 6000) {
        websiteContent = websiteContent.substring(0, 6000) + '... [truncated]'
      }
    } catch (error) {
      // Close browser if it's still open
      if (browser) {
        try {
          await browser.close()
        } catch (closeError) {
          // Ignore close errors
        }
      }
      
      // Fallback to simple fetch if Puppeteer fails
      try {
        const response = await fetch(validUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        })
        websiteContent = await response.text()
        
        // Limit content for fallback fetch too
        if (websiteContent.length > 6000) {
          websiteContent = websiteContent.substring(0, 6000) + '... [truncated]'
        }
      } catch (fetchError) {
        return NextResponse.json(
          { error: `Failed to fetch website: ${error instanceof Error ? error.message : 'Unknown error'}` },
          { status: 400 }
        )
      }
    }

    // Check each rule in batches of 5 to manage Vercel 60s timeout
    const results: ScanResult[] = []
    const BATCH_SIZE = 5
    
    // Split rules into batches of 5
    const batches: Rule[][] = []
    for (let i = 0; i < rules.length; i += BATCH_SIZE) {
      batches.push(rules.slice(i, i + BATCH_SIZE))
    }
    
    console.log(`Processing ${rules.length} rules in ${batches.length} batches of ${BATCH_SIZE}`)
    
    // Token usage tracking for rate limiting
    // OpenRouter rate limits - optimized for 60s Vercel timeout
    // Reduced delay to fit 5 rules per batch within 60 seconds
    const MIN_DELAY_BETWEEN_REQUESTS = 10000 // 10 seconds between requests (allows 5 rules in ~50s)
    let lastRequestTime = 0
    
    // Process each batch sequentially
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex]
      console.log(`Processing batch ${batchIndex + 1}/${batches.length} with ${batch.length} rules`)
      
      // Process rules in current batch
      for (const rule of batch) {
        // Wait if needed to respect rate limits
        const now = Date.now()
        if (lastRequestTime > 0) {
          const timeSinceLastRequest = now - lastRequestTime
          if (timeSinceLastRequest < MIN_DELAY_BETWEEN_REQUESTS) {
            const waitTime = MIN_DELAY_BETWEEN_REQUESTS - timeSinceLastRequest
            console.log(`Waiting ${waitTime}ms to respect rate limits...`)
            await sleep(waitTime)
          }
        }
        try {
          // Using OpenRouter with preview/search model
          const modelName = 'openai/gpt-4o-mini-search-preview'
          
          // Reduce content for token savings - OpenRouter model optimized
          const contentForAI = websiteContent.substring(0, 2000) // Reduced from 3000
          
          // Determine rule type for targeted instructions
          const isBreadcrumbRule = rule.title.toLowerCase().includes('breadcrumb') || rule.description.toLowerCase().includes('breadcrumb')
          const isColorRule = rule.title.toLowerCase().includes('color') || rule.title.toLowerCase().includes('black') || rule.description.toLowerCase().includes('color') || rule.description.toLowerCase().includes('#000000') || rule.description.toLowerCase().includes('pure black')
          const isLazyRule = rule.title.toLowerCase().includes('lazy') || rule.description.toLowerCase().includes('lazy') || rule.description.toLowerCase().includes('lazy loading')
          const isRatingRule = rule.title.toLowerCase().includes('rating') || rule.description.toLowerCase().includes('rating') || rule.description.toLowerCase().includes('review score') || rule.description.toLowerCase().includes('social proof')
          const isCustomerPhotoRule = rule.title.toLowerCase().includes('customer photo') || rule.title.toLowerCase().includes('customer using') || rule.description.toLowerCase().includes('customer photo') || rule.description.toLowerCase().includes('photos of customers')
          
          // Build concise prompt - only include relevant instructions
          let specialInstructions = ''
          if (isBreadcrumbRule) {
            specialInstructions = `\nBREADCRUMB RULE: Check "Breadcrumbs:" in KEY ELEMENTS. If "Not found" → FAIL, else → PASS.`
          } else if (isColorRule) {
            specialInstructions = `\nCOLOR RULE: Check "Pure black (#000000) detected:" in KEY ELEMENTS. If "YES" → FAIL, if "NO" → PASS.`
          } else if (isLazyRule) {
            specialInstructions = `\nLAZY LOADING RULE: Check "Lazy loading status:" in KEY ELEMENTS. If "PASS" → PASS, if "FAIL" → FAIL.`
          } else if (isRatingRule) {
            specialInstructions = `\nPRODUCT RATINGS RULE: Check if ratings are displayed NEAR the product title. Must have: (1) Review score (e.g., "4.3/5", "4 stars", "4.5"), (2) Total review count (e.g., "203 reviews", "150 ratings"), (3) Clickable link to reviews section (anchor link). All three required to PASS.`
          } else if (isCustomerPhotoRule) {
            specialInstructions = `\nCUSTOMER PHOTOS RULE: Check for customer photos in: product gallery, product description, or review section. Look for images showing customers using/wearing the product. Must be real customer photos, not just product images.`
          }
          
          const prompt = `URL: ${validUrl}\nContent: ${contentForAI}\nRule: ${rule.title} - ${rule.description}${specialInstructions}\n\nAnalyze if this rule is met. Check KEY ELEMENTS section first if relevant.\n\nRespond ONLY with valid JSON:\n{"passed": true/false, "reason": "brief, human-readable explanation"}\n\nReason must be: (1) Relevant to THIS rule only, (2) To the point, (3) Human readable, (4) Mention specific elements found or missing.`

          // Call OpenRouter API with retry logic
          const chatCompletion = await callOpenRouterWithRetry(openRouter, {
            model: modelName,
            messages: [
              {
                role: 'user',
                content: prompt,
              },
            ],
            temperature: 0.0,
            maxTokens: 512, // Reduced from 1024 to save tokens
            topP: 1,
            stream: false,
          })

          // Extract and parse JSON response (OpenRouter SDK returns similar structure to OpenAI)
          const responseText = (chatCompletion as any)?.choices?.[0]?.message?.content || 
                              (chatCompletion as any)?.message?.content || 
                              (chatCompletion as any)?.content || 
                              ''
          
          if (!responseText || responseText.trim().length === 0) {
            throw new Error('Empty response from API')
          }
          
          // Try to extract JSON from response (handle cases where model adds extra text)
          let jsonText = responseText.trim()
          // Remove markdown code blocks if present
          jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '')
          // Extract JSON object
          const jsonMatch = jsonText.match(/\{[\s\S]*\}/)
          if (!jsonMatch) {
            throw new Error('No JSON found in response')
          }
          jsonText = jsonMatch[0]
          
          // Parse and validate the JSON response
          let parsedResponse
          try {
            parsedResponse = JSON.parse(jsonText)
          } catch (parseError) {
            throw new Error(`Invalid JSON: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`)
          }
          
          const analysis = z.object({
            passed: z.boolean(),
            reason: z.string().max(500),
          }).parse(parsedResponse)
          
          // Validate that reason is relevant to the rule (prevent mismatched responses)
          const reasonLower = analysis.reason.toLowerCase()
          const ruleText = (rule.title + ' ' + rule.description).toLowerCase()
          
          // Check if reason mentions unrelated topics
          if (isBreadcrumbRule && !reasonLower.includes('breadcrumb') && !reasonLower.includes('navigation')) {
            console.warn(`Warning: Breadcrumb rule but reason doesn't mention breadcrumbs: ${analysis.reason.substring(0, 50)}`)
          } else if (isColorRule && !reasonLower.includes('color') && !reasonLower.includes('black') && !reasonLower.includes('#000000')) {
            console.warn(`Warning: Color rule but reason doesn't mention colors: ${analysis.reason.substring(0, 50)}`)
          } else if (isLazyRule && !reasonLower.includes('lazy') && !reasonLower.includes('loading')) {
            console.warn(`Warning: Lazy loading rule but reason doesn't mention lazy loading: ${analysis.reason.substring(0, 50)}`)
          } else if (isRatingRule && !reasonLower.includes('rating') && !reasonLower.includes('review') && !reasonLower.includes('star')) {
            console.warn(`Warning: Rating rule but reason doesn't mention ratings/reviews: ${analysis.reason.substring(0, 50)}`)
          } else if (isCustomerPhotoRule && !reasonLower.includes('photo') && !reasonLower.includes('image') && !reasonLower.includes('customer')) {
            console.warn(`Warning: Customer photo rule but reason doesn't mention photos/customers: ${analysis.reason.substring(0, 50)}`)
          }

          const result = {
            ruleId: rule.id,
            ruleTitle: rule.title,
            passed: analysis.passed === true,
            reason: analysis.reason || 'No reason provided',
          }
          
          results.push(result)
          
          // Update last request time after successful API call
          lastRequestTime = Date.now()

          // Save training data automatically - only if response is valid and relevant
          try {
            // Validate response relevance before saving
            const reasonLower = result.reason.toLowerCase()
            const ruleText = (rule.title + ' ' + rule.description).toLowerCase()
            
            // Check if reason is relevant to the rule (basic validation)
            const isRelevant = reasonLower.includes(rule.title.toLowerCase().split(' ')[0]) || 
                             reasonLower.length > 20 // If reason is substantial, likely relevant
            
            if (isRelevant && !result.reason.includes('Error:')) {
              await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/training-data`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  url: validUrl,
                  websiteContent: contentForAI,
                  rule: {
                    id: rule.id,
                    title: rule.title,
                    description: rule.description,
                  },
                  result: result,
                }),
              }).catch(err => console.error('Failed to save training data:', err))
            } else {
              console.warn(`Skipping training data save - response may not be relevant to rule: ${rule.title}`)
            }
          } catch (trainingError) {
            console.error('Error saving training data:', trainingError)
          }
        } catch (error) {
          let errorMessage = 'Unknown error occurred'
          
          if (error instanceof Error) {
            errorMessage = error.message
            
            // Handle rate limit errors specifically (OpenRouter returns these with retry-after info)
            if (errorMessage.includes('rate_limit') || errorMessage.includes('Rate limit') || errorMessage.includes('429') || errorMessage.includes('TPM')) {
              const retryAfter = extractRetryAfter(errorMessage)
              if (retryAfter > 0) {
                errorMessage = `Rate limit exceeded. Please wait ${Math.ceil(retryAfter / 1000)} seconds and try again. The system will automatically retry.`
              } else {
                errorMessage = 'Rate limit exceeded. The system will automatically retry with delays.'
              }
            } else if (errorMessage.includes('credits') || errorMessage.includes('tokens') || errorMessage.includes('max_tokens')) {
              errorMessage = `Token limit exceeded. Please check your OpenRouter API limits or try scanning fewer rules at a time.`
            } else if (errorMessage.includes('quota')) {
              errorMessage = 'API quota exceeded. Please check your account limits.'
            }
          }
          
          results.push({
            ruleId: rule.id,
            ruleTitle: rule.title,
            passed: false,
            reason: `Error: ${errorMessage}`,
          })
          
          // Update last request time even on error to prevent rapid retries
          lastRequestTime = Date.now()
        }
      }
      
      // Log batch completion
      console.log(`Batch ${batchIndex + 1}/${batches.length} completed. Total results: ${results.length}/${rules.length}`)
    }

    return NextResponse.json({ results })
  } catch (error) {
    console.error('Scan error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'An error occurred' },
      { status: 500 }
    )
  }
}

