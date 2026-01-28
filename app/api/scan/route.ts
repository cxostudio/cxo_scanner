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

      // Get quantity discount context for quantity discounts rule
      const quantityDiscountContext = await page.evaluate(() => {
        const bodyText = document.body.innerText.toLowerCase()
      
        // Common bulk discount patterns
        const patterns = [
          "buy 2",
          "buy 3",
          "buy more save",
          "quantity discount",
          "bulk discount",
          "volume discount",
          "save when you buy",
          "x for",
          "packs of",
          "bundle"
        ]
      
        const found = patterns.filter(p => bodyText.includes(p))
      
        return {
          foundPatterns: found,
          hasBulkDiscount: found.length > 0,
          preview: bodyText.substring(0, 800)
        }
      })
      
      // Get CTA context for shipping rules
      const ctaContext = await page.evaluate(() => {
        const cta = Array.from(document.querySelectorAll("button, a"))
          .find(el =>
            el.textContent?.toLowerCase().includes("add to bag") ||
            el.textContent?.toLowerCase().includes("add to cart") ||
            el.textContent?.toLowerCase().includes("buy now")
          )
        if (!cta) return "CTA not found"
        const parent = cta.closest("form, div, section")
        if (!parent) return "CTA parent container not found"
        const text = (parent as HTMLElement).innerText || parent.textContent || ''
        return text.substring(0, 500)
      })
      
      // Combine visible text and key elements (token-efficient)
      websiteContent = (visibleText.length > 4000 ? visibleText.substring(0, 4000) + '...' : visibleText) + 
                      '\n\n--- KEY ELEMENTS ---\n' + keyElements +
                      `\n\n--- QUANTITY DISCOUNT CHECK ---\nPatterns Found: ${quantityDiscountContext.foundPatterns.join(", ") || "None"}\nBulk Discount Detected: ${quantityDiscountContext.hasBulkDiscount ? "YES" : "NO"}\n` +
                      `\n\n--- CTA CONTEXT ---\n${ctaContext}`

                      

      
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
        
        // Using OpenRouter with Gemini model
        // Available Gemini models on OpenRouter: google/gemini-2.0-flash-exp, google/gemini-pro-1.5, google/gemini-flash-1.5-8b
        const modelName = 'google/gemini-2.5-flash-lite' // Latest Gemini Flash model
        
        try {
          
          // Reduce content for token savings - OpenRouter model optimized
          const contentForAI = websiteContent.substring(0, 2000) // Reduced from 3000
          
          // Determine rule type for targeted instructions
          const isBreadcrumbRule = rule.title.toLowerCase().includes('breadcrumb') || rule.description.toLowerCase().includes('breadcrumb')
          const isColorRule = rule.title.toLowerCase().includes('color') || rule.title.toLowerCase().includes('black') || rule.description.toLowerCase().includes('color') || rule.description.toLowerCase().includes('#000000') || rule.description.toLowerCase().includes('pure black')
          const isLazyRule = rule.title.toLowerCase().includes('lazy') || rule.description.toLowerCase().includes('lazy') || rule.description.toLowerCase().includes('lazy loading')
          const isRatingRule = rule.title.toLowerCase().includes('rating') || rule.description.toLowerCase().includes('rating') || rule.description.toLowerCase().includes('review score') || rule.description.toLowerCase().includes('social proof')
          const isCustomerPhotoRule = rule.title.toLowerCase().includes('customer photo') || rule.title.toLowerCase().includes('customer using') || rule.description.toLowerCase().includes('customer photo') || rule.description.toLowerCase().includes('photos of customers')
          const isStickyCartRule = rule.id === 'cta-sticky-add-to-cart' || rule.title.toLowerCase().includes('sticky') && rule.title.toLowerCase().includes('cart')
          const isProductTitleRule = rule.id === 'product-title-clarity' || rule.title.toLowerCase().includes('product title') || rule.description.toLowerCase().includes('product title')
          const isBenefitsNearTitleRule = rule.id === 'benefits-near-title' || rule.title.toLowerCase().includes('benefits') && rule.title.toLowerCase().includes('title')
          const isQuantityDiscountRule =
  rule.title.toLowerCase().includes("quantity") ||
  rule.title.toLowerCase().includes("bulk") ||
  rule.description.toLowerCase().includes("bulk pricing")
          const isShippingRule =
  rule.title.toLowerCase().includes("shipping time") ||
  rule.description.toLowerCase().includes("delivered by")
          
          // Build concise prompt - only include relevant instructions
          let specialInstructions = ''
          if (isBreadcrumbRule) {
            specialInstructions = `\nBREADCRUMB RULE: Check "Breadcrumbs:" in KEY ELEMENTS. If "Not found" → FAIL, else → PASS.`
          } else if (isColorRule) {
            specialInstructions = `\nCOLOR RULE: Check "Pure black (#000000) detected:" in KEY ELEMENTS. If "YES" → FAIL, if "NO" → PASS.`
          } else if (isLazyRule) {
            specialInstructions = `\nLAZY LOADING RULE - DETAILED CHECK:\nCheck "Lazy loading status:" and "Images without lazy loading:" in KEY ELEMENTS.\n\nIf FAILED: You MUST specify:\n1. WHICH images/videos are missing lazy loading (use image file names or descriptions from KEY ELEMENTS)\n2. WHERE these images/videos are located on the page (e.g., "product gallery section", "hero section", "product images area", "main product image", "thumbnail gallery", "description section")\n3. WHY it's a problem (e.g., "should have loading='lazy' attribute to improve page load time")\n\nIMPORTANT: \n- Do NOT mention currency symbols, prices, or amounts (like £29.00, $50, Rs. 3,166, £39.00) in the failure reason\n- Only mention image/video file names, descriptions, or locations\n- Be specific about WHERE on the page these images are located\n\nExample: "Images without lazy loading: The main product image for 'Rainbow Dust - Starter Kit' (found in product gallery section) is missing the loading='lazy' attribute. Additionally, images in the 'POPULAR PRODUCTS' section also lack lazy loading. These should be lazy-loaded to improve initial page load time."\n\nIf no images/videos found: "No images or videos found on the page to evaluate for lazy loading."\n\nBe SPECIFIC about which elements are missing lazy loading and WHERE they are located, but DO NOT include prices or currency.`
          } else if (isRatingRule) {
            specialInstructions = `\nPRODUCT RATINGS RULE - STRICT CHECK:\nRatings MUST be displayed NEAR product title (within same section/area) and MUST include ALL of the following:\n\n1. REVIEW SCORE: Must show the rating score (e.g., "4.3/5", "4 stars", "4.5", "★★★★☆", "4.5 out of 5")\n2. REVIEW COUNT: Must show the total number of reviews/ratings (e.g., "203 reviews", "150 ratings", "1.2k reviews", "1,234 customer reviews")\n3. CLICKABLE LINK: Must be clickable/linkable to reviews section (anchor link like #reviews or scroll to reviews section)\n\nALL 3 requirements must be present to PASS. If ANY is missing → FAIL.\n\nIf FAILED, you MUST specify:\n- WHERE the rating is located (if it exists)\n- WHAT is present (review score, review count, or clickable link)\n- WHAT is MISSING (specifically mention if "review count is missing" or "review score is missing" or "clickable link to reviews is missing")\n- WHY it fails (e.g., "Rating shows '4.5 out of 5' but review count (like '203 reviews') is missing", or "Rating is not clickable to navigate to reviews section")\n\nIMPORTANT: Review score and review count are TWO SEPARATE requirements. If only score is shown without count → FAIL with reason "Review count is missing". If only count is shown without score → FAIL with reason "Review score is missing".\n\nExample FAIL reason: "Product ratings show '4.5 out of 5' and 'Excellent' near the product title, but the review count (e.g., '203 reviews') is missing. The rating is clickable and navigates to reviews section, but without the review count, users cannot see how many people have rated the product. Review count is required for social proof."`
          } else if (isCustomerPhotoRule) {
            specialInstructions = `\nCUSTOMER PHOTOS RULE - STRICT CHECK:\nCheck for REAL customer photos (not product images) in: product gallery, description, or review section.\nMust show customers USING/WEARING the product in real life.\nProduct-only images do NOT count. Stock photos do NOT count.\nIf no customer photos found → FAIL.`
          } else if (isStickyCartRule) {
            specialInstructions = `\nSTICKY ADD TO CART RULE - DETAILED CHECK:\nThe page MUST have a sticky/floating "Add to Cart" button that remains visible when scrolling.\n\nIf FAILED: You MUST specify:\n1. WHICH button is the "Add to Cart" button (mention button text/label, but DO NOT include currency/price in the reason)\n2. WHERE it is located (e.g., "main product section", "product details area")\n3. WHY it fails (e.g., "button disappears when scrolling", "only visible at bottom of page", "not sticky/floating")\n\nIMPORTANT: Do NOT mention currency symbols, prices, or amounts (like £29.00, $50, Rs. 3,166) in the failure reason. Only mention the button text/label without price.\n\nExample: "The 'Add to Cart' button found in the main product section disappears when user scrolls down. It only becomes visible again when scrolled to the bottom of the page, but does not remain sticky/floating as required."`
          } else if (isProductTitleRule) {
            specialInstructions = `\nPRODUCT TITLE RULE - DETAILED CHECK:\nThe PRODUCT TITLE itself (not the description section) must be descriptive, specific, and include key attributes.\n\nCRITICAL: This rule checks the TITLE only. A product description section existing on the page does NOT make a generic title acceptable. The title must be descriptive on its own.\n\nTitle should include: brand, size, color, key characteristics, or specific benefits. Should be under 65 characters for SEO.\n\nIf FAILED: You MUST specify:\n1. WHAT the current title is (quote it exactly)\n2. WHAT is missing from the TITLE (e.g., size, color, brand, key characteristics, specific benefits)\n3. WHY it's a problem (e.g., "too generic", "lacks SEO keywords", "doesn't describe product clearly on its own")\n4. WHERE the title is located (e.g., "product page header", "product title section")\n5. NOTE if description exists but explain that title should still be descriptive independently\n\nIf PASSED: Title must be descriptive and clear on its own, even if description section also exists.\n\nExample FAIL: "The product title 'Rainbow Dust - Starter Kit' located in the product page header is too generic. While a product description section exists with benefits, the title itself lacks key attributes like size (e.g., '50g', '100ml'), flavor/variant details, or specific benefits. The title should be descriptive on its own for SEO and clarity, regardless of description content."\n\nExample PASS: "The product title 'Spacegoods Rainbow Dust - Coffee Flavor Starter Kit (50g)' is descriptive and clear. It includes brand name, product name, flavor variant, and size, making it SEO-friendly and informative."`
          } else if (isBenefitsNearTitleRule) {
            specialInstructions = `\nBENEFITS NEAR PRODUCT TITLE RULE - DETAILED CHECK:\nA short list of 2-3 key benefits MUST be displayed NEAR the product title (below or beside it, within the same section/area).\n\nREQUIREMENTS:\n1. Benefits must be NEAR product title (same section/area, not far below or in separate sections)\n2. Must have 2-3 benefits (not just 1, not more than 3)\n3. Benefits should be specific, impactful, and aligned with key selling points\n4. Benefits should stand out visually (bold, contrasting fonts, or clear formatting)\n5. Benefits should be concise and easy to scan\n\nIf PASSED: You MUST specify:\n- WHERE the benefits are located (e.g., "directly below product title", "beside product title in same section")\n- WHAT benefits are shown (list 2-3 benefits)\n- WHY it passes (e.g., "benefits are clearly visible near title and communicate value effectively")\n\nExample PASS: "Key benefits are displayed directly below the product title 'Rainbow Dust - Starter Kit' in the product header section: (1) 'Boost productivity with focus & energy without jitters', (2) 'Reduce anxiety & distraction, flow state all day', (3) '7-in-1 blend of coffee + potent mushrooms & adaptogens'. These benefits are clearly visible, specific, and help users quickly understand the product value."\n\nIf FAILED: You MUST specify:\n- WHERE the product title is located\n- WHERE benefits are located (if they exist elsewhere on the page)\n- WHAT is missing (e.g., "no benefits near title", "only 1 benefit shown", "benefits are too far from title in separate section", "benefits are not specific/impactful")\n- WHY it fails (e.g., "benefits are in description section far below title, not near title", "only generic benefits shown", "benefits don't stand out visually")\n\nExample FAIL: "The product title 'Rainbow Dust - Starter Kit' is located in the product header section, but there are no key benefits displayed near it. While product benefits exist in the description section further down the page (e.g., 'Boost productivity', 'Reduce anxiety'), these are not near the product title as required. Benefits should be placed directly below or beside the product title in the same section to quickly communicate value and capture attention."`
          } else if (isColorRule) {
            specialInstructions = `\nCOLOR RULE - STRICT CHECK:\nCheck "Pure black (#000000) detected:" in KEY ELEMENTS.\nIf "YES" → FAIL (black is being used, violates rule)\nIf "NO" → PASS (no pure black, rule followed)\nAlso verify in content: look for #000000, rgb(0,0,0), or "black" color codes.\nSofter tones like #333333, #121212 are acceptable.`
          }else if (isQuantityDiscountRule) {
            specialInstructions = `
          QUANTITY DISCOUNT RULE (STRICT):
          
          PASS only if page clearly shows bulk pricing like:
          - "Buy 2 save 10%"
          - Quantity pricing table
          - Bundle discount offers
          
          FAIL if:
          - Only subscription plan discounts exist
          - Text is vague like "Save more with flexible plan"
          
          IMPORTANT:
          If Bulk Discount Detected = NO → FAIL immediately.
          If Bulk Discount Detected = YES → PASS with clear reason.
          
          Do NOT confuse subscription savings with quantity discounts.
          ` 
        }if (isShippingRule) {
          specialInstructions = `
        SHIPPING RULE:
        If delivery date is present near CTA → PASS adjacency.
        Only FAIL if BOTH are missing:
        1. Delivery estimate
        2. Order cutoff time (“Order by XX”)
        If cutoff time missing but date present → FAIL with reason: "Order-by time missing."
        `
        }
          
          const prompt = `URL: ${validUrl}\nContent: ${contentForAI}\nRule: ${rule.title} - ${rule.description}${specialInstructions}\n\nCRITICAL: Analyze ACCURATELY. Check ALL requirements. Do NOT assume.\n\nIMPORTANT - REASON FORMAT REQUIREMENTS:\n- Be SPECIFIC: Mention exact elements, locations, and what's wrong\n- Be HUMAN READABLE: Write in clear, simple language that users can understand\n- Tell WHERE: Specify where on the page/site the problem is\n- Tell WHAT: Quote exact text/elements that are problematic\n- Tell WHY: Explain why it's a problem and what should be done\n- Be ACTIONABLE: User should know exactly what to fix\n\nIf PASSED: List specific elements found that meet the rule with their locations.\nIf FAILED: Be VERY SPECIFIC - mention exact elements, their locations, what's missing/wrong, and why it matters.\n\nIMPORTANT: You MUST respond with ONLY valid JSON. No text before or after. No markdown. No code blocks.\n\nRequired JSON format (copy exactly, replace values):\n{"passed": true, "reason": "brief explanation under 400 characters"}\n\nOR\n\n{"passed": false, "reason": "brief explanation under 400 characters"}\n\nReason must be: (1) Under 400 characters, (2) Accurate to actual content, (3) Specific elements mentioned with locations, (4) Human readable and clear, (5) Actionable - tells user what to fix, (6) Relevant ONLY to this rule.`

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

          // Extract and parse JSON response - Gemini compatible
          // Gemini may return different structure, so check all possible paths
          let responseText = ''
          
          // Try different response structures (Gemini/OpenRouter compatibility)
          if ((chatCompletion as any)?.choices?.[0]?.message?.content) {
            responseText = (chatCompletion as any).choices[0].message.content
          } else if ((chatCompletion as any)?.message?.content) {
            responseText = (chatCompletion as any).message.content
          } else if ((chatCompletion as any)?.content) {
            responseText = (chatCompletion as any).content
          } else if ((chatCompletion as any)?.text) {
            responseText = (chatCompletion as any).text
          } else if (typeof chatCompletion === 'string') {
            responseText = chatCompletion
          } else {
            // Log full response for debugging
            console.error('Unexpected response structure:', JSON.stringify(chatCompletion).substring(0, 500))
            throw new Error('Unexpected response structure from API')
          }
          
          if (!responseText || responseText.trim().length === 0) {
            throw new Error('Empty response from API - no content received')
          }
          
          // Clean and extract JSON - multiple methods for Gemini compatibility
          let jsonText = responseText.trim()
          
          // Method 1: Remove markdown code blocks (common in Gemini)
          jsonText = jsonText.replace(/```json\n?/gi, '').replace(/```\n?/g, '').replace(/```jsonl\n?/gi, '')
          
          // Method 2: Remove any text before first {
          const firstBrace = jsonText.indexOf('{')
          if (firstBrace > 0) {
            jsonText = jsonText.substring(firstBrace)
          }
          
          // Method 3: Remove any text after last }
          const lastBrace = jsonText.lastIndexOf('}')
          if (lastBrace > 0 && lastBrace < jsonText.length - 1) {
            jsonText = jsonText.substring(0, lastBrace + 1)
          }
          
          // Method 4: Try to find JSON object
          let jsonMatch = jsonText.match(/\{[\s\S]*\}/)
          
          // Method 5: If no match, try to construct from text patterns (Gemini fallback)
          if (!jsonMatch) {
            // Try to find passed/reason pattern (Gemini sometimes returns text format)
            const passedMatch = jsonText.match(/["']?passed["']?\s*[:=]\s*(true|false)/i)
            const reasonMatch = jsonText.match(/["']?reason["']?\s*[:=]\s*["']([^"']{1,400})["']/i) || 
                               jsonText.match(/["']?reason["']?\s*[:=]\s*"([^"]{1,400})"/i)
            
            if (passedMatch && reasonMatch) {
              // Escape quotes in reason and limit to 400 chars
              const escapedReason = reasonMatch[1].replace(/"/g, '\\"').replace(/\n/g, ' ').substring(0, 400)
              jsonText = `{"passed": ${passedMatch[1]}, "reason": "${escapedReason}"}`
            } else {
              // Last resort: try to find any JSON-like structure
              const hasPassed = jsonText.toLowerCase().includes('"passed":') || jsonText.toLowerCase().includes("'passed':") || jsonText.toLowerCase().includes('passed:')
              const hasReason = jsonText.toLowerCase().includes('"reason":') || jsonText.toLowerCase().includes("'reason':") || jsonText.toLowerCase().includes('reason:')
              
              if (!hasPassed || !hasReason) {
                // Log the actual response for debugging
                console.error('Failed to parse JSON. Response was:', responseText.substring(0, 300))
                throw new Error(`No valid JSON found in response. Response preview: ${responseText.substring(0, 150)}...`)
              }
              
              // Try one more time with cleaned text
              jsonMatch = jsonText.match(/\{[\s\S]*\}/)
              if (!jsonMatch) {
                throw new Error(`Could not extract JSON. Response: ${responseText.substring(0, 200)}`)
              }
            }
          } else {
            jsonText = jsonMatch[0]
          }
          
          // Parse and validate the JSON response
          let parsedResponse
          try {
            parsedResponse = JSON.parse(jsonText)
          } catch (parseError) {
            // Try to fix common JSON issues (especially for Gemini)
            try {
              // Fix single quotes to double quotes
              jsonText = jsonText.replace(/'/g, '"')
              // Fix trailing commas
              jsonText = jsonText.replace(/,(\s*[}\]])/g, '$1')
              // Fix unescaped newlines in strings
              jsonText = jsonText.replace(/\n/g, ' ').replace(/\r/g, ' ')
              parsedResponse = JSON.parse(jsonText)
            } catch (secondError) {
              // Try one more time - extract just the essential parts
              try {
                const passed = jsonText.match(/["']?passed["']?\s*[:=]\s*(true|false)/i)?.[1] || 'false'
                const reason = (jsonText.match(/["']?reason["']?\s*[:=]\s*["']([^"']{1,400})["']/i)?.[1] || 
                               jsonText.match(/["']?reason["']?\s*[:=]\s*"([^"]{1,400})"/i)?.[1] || 
                               'Unable to parse response').replace(/\n/g, ' ').substring(0, 400)
                parsedResponse = { passed: passed === 'true', reason: reason }
              } catch (thirdError) {
                console.error('JSON parse error. Original response:', responseText.substring(0, 300))
                throw new Error(`Invalid JSON format: ${parseError instanceof Error ? parseError.message : 'Unknown error'}. Response preview: ${responseText.substring(0, 150)}`)
              }
            }
          }
          
          // Validate and parse response with strict length limit
          const analysis = z.object({
            passed: z.boolean(),
            reason: z.string().max(400), // Reduced from 500 to 400 for safety
          }).parse(parsedResponse)
          
          // Ensure reason is within limit (truncate if needed)
          if (analysis.reason.length > 400) {
            analysis.reason = analysis.reason.substring(0, 397) + '...'
          }
          
          // Validate that reason is relevant to the rule (prevent mismatched responses)
          const reasonLower = analysis.reason.toLowerCase()
          const ruleText = (rule.title + ' ' + rule.description).toLowerCase()
          
          // Strict validation - check if reason matches rule requirements
          let isRelevant = true
          
          if (isRatingRule) {
            // Rating rule must mention rating/review/star AND check all requirements
            const hasRatingMention = reasonLower.includes('rating') || reasonLower.includes('review') || reasonLower.includes('star')
            const mentionsNearTitle = reasonLower.includes('near') || reasonLower.includes('title') || reasonLower.includes('close')
            const mentionsScore = reasonLower.includes('score') || reasonLower.includes('star') || reasonLower.includes('/5') || reasonLower.includes('out of')
            const mentionsCount = reasonLower.includes('review') || reasonLower.includes('rating') || reasonLower.includes('people')
            
            if (!hasRatingMention) {
              console.warn(`Warning: Rating rule but reason doesn't mention ratings: ${analysis.reason.substring(0, 50)}`)
              isRelevant = false
            }
            
            // If passed=true but missing requirements, it's wrong
            if (analysis.passed && (!mentionsScore || !mentionsCount || !mentionsNearTitle)) {
              console.warn(`Warning: Rating rule passed but missing requirements. Score: ${mentionsScore}, Count: ${mentionsCount}, Near title: ${mentionsNearTitle}`)
              // Force re-evaluation - mark as failed if requirements not met
              if (!mentionsScore || !mentionsCount) {
                analysis.passed = false
                analysis.reason = `Rating rule failed: Missing required elements. ${analysis.reason}`
              }
            }
          } else if (isColorRule) {
            // Color rule must mention color/black and verify actual usage
            if (!reasonLower.includes('color') && !reasonLower.includes('black') && !reasonLower.includes('#000000')) {
              console.warn(`Warning: Color rule but reason doesn't mention colors: ${analysis.reason.substring(0, 50)}`)
              isRelevant = false
            }
            // Check if black is actually mentioned and matches
            if (reasonLower.includes('black') && !reasonLower.includes('#000000') && !reasonLower.includes('rgb(0,0,0)') && !reasonLower.includes('pure black')) {
              console.warn(`Warning: Color rule mentions black but not specific color code`)
            }
          } else if (isBreadcrumbRule && !reasonLower.includes('breadcrumb') && !reasonLower.includes('navigation')) {
            console.warn(`Warning: Breadcrumb rule but reason doesn't mention breadcrumbs: ${analysis.reason.substring(0, 50)}`)
            isRelevant = false
          } else if (isLazyRule && !reasonLower.includes('lazy') && !reasonLower.includes('loading')) {
            console.warn(`Warning: Lazy loading rule but reason doesn't mention lazy loading: ${analysis.reason.substring(0, 50)}`)
            isRelevant = false
          } else if (isCustomerPhotoRule && !reasonLower.includes('photo') && !reasonLower.includes('image') && !reasonLower.includes('customer')) {
            console.warn(`Warning: Customer photo rule but reason doesn't mention photos/customers: ${analysis.reason.substring(0, 50)}`)
            isRelevant = false
          }
          
          // If reason is not relevant, mark as error
          if (!isRelevant) {
            analysis.reason = `Invalid response: ${analysis.reason}. This response does not match the rule: ${rule.title}`
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
            
            // Handle 404 errors (model not found)
            if (errorMessage.includes('404') || errorMessage.includes('No endpoints found') || errorMessage.includes('not found')) {
              errorMessage = `Model not found. The model '${modelName}' is not available on OpenRouter. Please try using: google/gemini-2.0-flash-exp, google/gemini-pro-1.5, or google/gemini-flash-1.5-8b`
            } 
            // Handle rate limit errors specifically (OpenRouter returns these with retry-after info)
            else if (errorMessage.includes('rate_limit') || errorMessage.includes('Rate limit') || errorMessage.includes('429') || errorMessage.includes('TPM')) {
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

