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

// Helper function to extract retry-after time from error message (for error messages only)
const extractRetryAfter = (errorMessage: string): number => {
  const match = errorMessage.match(/try again in ([\d.]+)s/i)
  if (match) {
    return Math.ceil(parseFloat(match[1]) * 1000) // Convert to milliseconds and round up
  }
  return 0
}

// Helper function to convert image URLs to protocol-relative format (//)
const toProtocolRelativeUrl = (url: string, baseUrl: string): string => {
  if (!url || url.startsWith('data:') || url.startsWith('//')) {
    // Already protocol-relative or data URL, return as is
    return url
  }

  try {
    // If URL is already absolute (starts with http:// or https://)
    if (url.startsWith('http://') || url.startsWith('https://')) {
      // Extract domain and path, convert to protocol-relative
      const urlObj = new URL(url)
      return `//${urlObj.host}${urlObj.pathname}${urlObj.search}${urlObj.hash}`
    }

    // If URL is relative, resolve it first
    const baseUrlObj = new URL(baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`)
    const resolvedUrl = new URL(url, baseUrlObj.href)
    // Convert to protocol-relative
    return `//${resolvedUrl.host}${resolvedUrl.pathname}${resolvedUrl.search}${resolvedUrl.hash}`
  } catch (error) {
    // If URL parsing fails, return original
    console.warn('Failed to convert URL to protocol-relative:', url, error)
    return url
  }
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
    let screenshotDataUrl: string | null = null // Screenshot for AI vision analysis
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
      await new Promise(resolve => setTimeout(resolve, 2000)) // Reduced to 2 seconds for faster processing

      // Scroll to ensure all content is loaded
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight / 2)
      })
      await page.waitForSelector('img[data-hook="review-image-tile"]', { timeout: 8000 }).catch(() => {
        console.log("No customer images found");
      });
      await new Promise(resolve => setTimeout(resolve, 500)) // Reduced to 500ms
      await page.evaluate(() => {
        window.scrollTo(0, 0)
      })
      await new Promise(resolve => setTimeout(resolve, 300)) // Reduced to 300ms

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
            let src = img.getAttribute('src') || img.getAttribute('data-src') || `image-${index + 1}`
            // Convert image URLs to protocol-relative format (//)
            if (src && !src.startsWith('data:') && !src.startsWith('//')) {
              try {
                if (src.startsWith('http://') || src.startsWith('https://')) {
                  const urlObj = new URL(src)
                  src = `//${urlObj.host}${urlObj.pathname}${urlObj.search}${urlObj.hash}`
                } else if (src.startsWith('/')) {
                  // Relative URL starting with /, make it protocol-relative
                  const baseUrl = window.location.origin
                  src = `//${new URL(baseUrl).host}${src}`
                }
              } catch (e) {
                // If conversion fails, keep original
              }
            }
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

      // Get quantity discount and general discount context (merged)
      const quantityDiscountContext = await page.evaluate(() => {
        const bodyText = document.body.innerText || ''
        const bodyTextLower = bodyText.toLowerCase()

        // Common discount patterns (bulk, quantity, and regular discounts)
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
          "bundle",
          // Regular discount patterns
          "% off",
          "percent off",
          "special price",
          "bank offer",
          "flat",
          "off",
          "cashback",
          "discount",
          "save",
          "offer"
        ]

        const found = patterns.filter(p => bodyTextLower.includes(p))

        // Also check for discount percentages/amounts in text
        const hasDiscountPercentage = /(\d+)%\s*off/i.test(bodyText) || /off\s*(\d+)%/i.test(bodyText)
        const hasDiscountAmount = /flat\s*₹?\s*\d+/i.test(bodyText) || /₹?\s*\d+\s*off/i.test(bodyText)
        const hasSpecialPrice = bodyTextLower.includes("special price")
        const hasBankOffer = bodyTextLower.includes("bank offer")

        // Step 1: Check for discount percentage (e.g., "20% off", "10% discount")
        const discountPercentagePatterns = [
          /(\d+)%\s*off/i,
          /off\s*(\d+)%/i,
          /(\d+)%\s*discount/i,
          /discount\s*of\s*(\d+)%/i,
          /save\s*(\d+)%/i,
          /(\d+)%\s*save/i
        ]

        let discountPercentage = null
        for (const pattern of discountPercentagePatterns) {
          const match = bodyText.match(pattern)
          if (match) {
            discountPercentage = match[0]
            break
          }
        }

        // Step 2: Check for price drop (e.g., "Was $50, Now $40", "Original $100, Now $80")
        const priceDropPatterns = [
          /was\s*[₹$€£]?\s*[\d,]+\.?\d*\s*now\s*[₹$€£]?\s*[\d,]+\.?\d*/i,
          /original\s*[₹$€£]?\s*[\d,]+\.?\d*\s*now\s*[₹$€£]?\s*[\d,]+\.?\d*/i,
          /was\s*[₹$€£]?\s*[\d,]+\.?\d*\s*,\s*now\s*[₹$€£]?\s*[\d,]+\.?\d*/i,
          /[₹$€£]?\s*[\d,]+\.?\d*\s*was\s*[₹$€£]?\s*[\d,]+\.?\d*/i,
          /strike.*[₹$€£]?\s*[\d,]+\.?\d*\s*now\s*[₹$€£]?\s*[\d,]+\.?\d*/i
        ]

        let priceDrop = null
        for (const pattern of priceDropPatterns) {
          const match = bodyText.match(pattern)
          if (match) {
            priceDrop = match[0]
            break
          }
        }

        // Step 3: Check for coupon codes (e.g., "Use code SAVE20", "Coupon: DISCOUNT10")
        const couponPatterns = [
          /use\s+code\s+[A-Z0-9]+/i,
          /coupon\s+code\s*:?\s*[A-Z0-9]+/i,
          /promo\s+code\s*:?\s*[A-Z0-9]+/i,
          /code\s*:?\s*[A-Z0-9]{4,}/i,
          /apply\s+code\s+[A-Z0-9]+/i
        ]

        let couponCode = null
        for (const pattern of couponPatterns) {
          const match = bodyText.match(pattern)
          if (match) {
            couponCode = match[0]
            break
          }
        }

        // Step 4: Exclude free shipping alone (unless it's part of a discount)
        const hasFreeShipping = /free\s+shipping/i.test(bodyTextLower)
        const hasOnlyFreeShipping = hasFreeShipping && !discountPercentage && !priceDrop && !couponCode && !hasDiscountPercentage && !hasDiscountAmount && !hasSpecialPrice && !hasBankOffer

        // Determine if discount exists (quantity/bulk OR general discount)
        const hasBulkDiscount = found.length > 0 || hasDiscountPercentage || hasDiscountAmount || hasSpecialPrice || hasBankOffer
        const hasGeneralDiscount = !!(discountPercentage || priceDrop || couponCode)
        const hasAnyDiscount = hasBulkDiscount || (hasGeneralDiscount && !hasOnlyFreeShipping)

        return {
          foundPatterns: found,
          hasBulkDiscount: hasBulkDiscount,
          discountPercentage: discountPercentage || 'None',
          priceDrop: priceDrop || 'None',
          couponCode: couponCode || 'None',
          hasFreeShipping: hasFreeShipping,
          hasOnlyFreeShipping: hasOnlyFreeShipping,
          hasAnyDiscount: hasAnyDiscount,
          preview: bodyText.substring(0, 1000)
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

      // Get shipping time context for shipping time visibility rule
      const shippingTimeContext = await page.evaluate(() => {
        const ctaSelectors = ["button", "a", "[role='button']", "input[type='submit']"]
        let ctaElement: HTMLElement | null = null
        let ctaText = "N/A"
        let ctaRect: DOMRect | null = null
        const viewportHeight = window.innerHeight

        // Find CTA button
        for (const selector of ctaSelectors) {
          const potentialCtas = Array.from(document.querySelectorAll(selector)) as HTMLElement[]
          const foundCTA = potentialCtas.find(el => {
            const text = (el.textContent || el.getAttribute('aria-label') || el.getAttribute('value') || '').toLowerCase()
            return text.includes("add to cart") || text.includes("add to bag") || text.includes("buy now") || text.includes("checkout")
          })
          if (foundCTA) {
            ctaElement = foundCTA
            ctaText = (ctaElement.textContent || ctaElement.getAttribute('aria-label') || ctaElement.getAttribute('value') || '').trim()
            ctaRect = ctaElement.getBoundingClientRect()
            break
          }
        }

        const ctaFound = !!ctaElement
        const ctaVisibleWithoutScrolling = ctaRect ? (ctaRect.top >= 0 && ctaRect.bottom <= viewportHeight) : false

        // Find shipping time information near CTA
        let shippingInfoNearCTA = ""
        let hasCountdown = false
        let hasDeliveryDate = false
        let shippingText = ""

        if (ctaRect && ctaElement) {
          // Get parent container of CTA
          const parent = ctaElement.closest("form, div, section, [class*='cart'], [class*='checkout'], [class*='product']")
          if (parent) {
            const parentText = (parent as HTMLElement).innerText || parent.textContent || ''

            // Check for countdown/cutoff time patterns
            const countdownPatterns = [
              /order\s+within\s+[\d\s]+(?:hours?|hrs?|minutes?|mins?)/i,
              /order\s+by\s+[\d\s]+(?:am|pm|hours?|hrs?)/i,
              /order\s+before\s+[\d\s]+(?:am|pm|hours?|hrs?)/i,
              /cutoff\s+time/i,
              /order\s+in\s+the\s+next\s+[\d\s]+(?:hours?|hrs?)/i
            ]

            // Check for delivery date patterns
            const deliveryDatePatterns = [
              /get\s+it\s+by\s+[A-Za-z]+\s*,\s*[A-Za-z]+\s+\d+/i,
              /delivered\s+by\s+[A-Za-z]+\s*,\s*[A-Za-z]+\s+\d+/i,
              /arrives\s+by\s+[A-Za-z]+\s*,\s*[A-Za-z]+\s+\d+/i,
              /get\s+it\s+on\s+[A-Za-z]+\s*,\s*[A-Za-z]+\s+\d+/i,
              /delivery\s+by\s+[A-Za-z]+\s*,\s*[A-Za-z]+\s+\d+/i,
              /get\s+it\s+by\s+[A-Za-z]+\s+\d+/i,
              /delivered\s+by\s+[A-Za-z]+\s+\d+/i
            ]

            // Check for countdown
            for (const pattern of countdownPatterns) {
              if (pattern.test(parentText)) {
                hasCountdown = true
                const match = parentText.match(pattern)
                if (match) shippingText += match[0] + " "
                break
              }
            }

            // Check for delivery date
            for (const pattern of deliveryDatePatterns) {
              if (pattern.test(parentText)) {
                hasDeliveryDate = true
                const match = parentText.match(pattern)
                if (match) shippingText += match[0] + " "
                break
              }
            }

            // Extract shipping info from parent container (first 300 chars)
            if (parentText) {
              shippingInfoNearCTA = parentText.substring(0, 300)
            }
          }
        }

        return {
          ctaFound,
          ctaText,
          ctaVisibleWithoutScrolling,
          shippingInfoNearCTA: shippingInfoNearCTA || "N/A",
          hasCountdown,
          hasDeliveryDate,
          shippingText: shippingText.trim() || "None",
          allRequirementsMet: hasCountdown && hasDeliveryDate
        }
      })

      // Get trust badges context for trust badges rule
      const trustBadgesContext = await page.evaluate(() => {
        // Find CTA button
        const cta = Array.from(document.querySelectorAll("button, a"))
          .find(el => {
            const text = el.textContent?.toLowerCase() || ''
            return text.includes("add to bag") ||
              text.includes("add to cart") ||
              text.includes("checkout") ||
              text.includes("buy now")
          })

        if (!cta) {
          return {
            ctaFound: false,
            trustBadgesNearCTA: [],
            trustBadgesCount: 0,
            within50px: false,
            visibleWithoutScrolling: false,
            trustBadgesInfo: "CTA not found"
          }
        }

        const ctaRect = cta.getBoundingClientRect()
        const ctaTop = ctaRect.top
        const ctaBottom = ctaRect.bottom
        const ctaLeft = ctaRect.left
        const ctaRight = ctaRect.right
        const viewportHeight = window.innerHeight

        // Check if CTA is visible without scrolling
        const ctaVisibleWithoutScrolling = ctaTop >= 0 && ctaTop < viewportHeight

        // Find trust badges (payment logos, SSL badges, security badges)
        const trustBadgeSelectors = [
          'img[alt*="ssl"]',
          'img[alt*="SSL"]',
          'img[alt*="secure"]',
          'img[alt*="Secure"]',
          'img[alt*="visa"]',
          'img[alt*="Visa"]',
          'img[alt*="mastercard"]',
          'img[alt*="Mastercard"]',
          'img[alt*="paypal"]',
          'img[alt*="PayPal"]',
          'img[alt*="payment"]',
          'img[alt*="Payment"]',
          'img[alt*="guarantee"]',
          'img[alt*="Guarantee"]',
          'img[alt*="money-back"]',
          'img[alt*="Money-back"]',
          '[class*="trust"]',
          '[class*="badge"]',
          '[class*="payment"]',
          '[class*="ssl"]',
          '[class*="secure"]',
          '[id*="trust"]',
          '[id*="badge"]',
          '[id*="payment"]'
        ]

        const allTrustBadges: Array<{ element: Element, distance: number, visible: boolean, text: string }> = []

        trustBadgeSelectors.forEach(selector => {
          try {
            const elements = document.querySelectorAll(selector)
            elements.forEach(el => {
              const rect = el.getBoundingClientRect()
              const badgeTop = rect.top
              const badgeBottom = rect.bottom
              const badgeLeft = rect.left
              const badgeRight = rect.right

              // Calculate distance from CTA (using center points)
              const ctaCenterX = (ctaLeft + ctaRight) / 2
              const ctaCenterY = (ctaTop + ctaBottom) / 2
              const badgeCenterX = (badgeLeft + badgeRight) / 2
              const badgeCenterY = (badgeTop + badgeBottom) / 2

              const distanceX = Math.abs(ctaCenterX - badgeCenterX)
              const distanceY = Math.abs(ctaCenterY - badgeCenterY)
              const distance = Math.sqrt(distanceX * distanceX + distanceY * distanceY)

              // Check if badge is visible without scrolling
              const badgeVisible = badgeTop >= 0 && badgeTop < viewportHeight

              // Get badge text/alt
              const badgeText = (el instanceof HTMLImageElement ? el.alt : null) ||
                (el as HTMLElement).title ||
                el.textContent?.trim() ||
                'Trust badge'

              allTrustBadges.push({
                element: el,
                distance: distance,
                visible: badgeVisible,
                text: badgeText
              })
            })
          } catch (e) {
            // Ignore selector errors
          }
        })

        // Filter badges within 50px of CTA
        const badgesWithin50px = allTrustBadges.filter(badge => badge.distance <= 50)
        const badgesVisibleWithoutScrolling = badgesWithin50px.filter(badge => badge.visible && ctaVisibleWithoutScrolling)

        return {
          ctaFound: true,
          ctaText: (cta as HTMLElement).textContent?.trim() || 'CTA button',
          ctaVisibleWithoutScrolling: ctaVisibleWithoutScrolling,
          trustBadgesNearCTA: badgesWithin50px.map(b => b.text),
          trustBadgesCount: badgesWithin50px.length,
          within50px: badgesWithin50px.length > 0,
          visibleWithoutScrolling: badgesVisibleWithoutScrolling.length > 0 && ctaVisibleWithoutScrolling,
          trustBadgesInfo: badgesWithin50px.length > 0
            ? `Found ${badgesWithin50px.length} trust badge(s) within 50px: ${badgesWithin50px.map(b => b.text).join(', ')}`
            : 'No trust badges found within 50px of CTA'
        }
      })
      // preselect
      const selectedVariant = await page.evaluate(() => {
        // Method 1: Check actual checked input (radio buttons)
        const checkedInput = document.querySelector(
          'input[type="radio"]:checked'
        )
        if (checkedInput) {
          const value = (checkedInput as HTMLInputElement).value
          if (value) return value
        }

        // Method 2: Check CSS-based visual selection (gradient borders, selected classes)
        // This handles cases where selection is shown via CSS styling, not checked attribute
        const cssSelectors = [
          '.flavour-option.gradient-border-checked',
          '.variant-option.gradient-border-checked',
          '.option.gradient-border-checked',
          '[class*="gradient-border-checked"]',
          '.flavour-option.selected',
          '.variant-option.selected',
          '.option.selected',
          '[class*="selected"][class*="option"]',
          '[class*="selected"][class*="variant"]',
          '[class*="selected"][class*="flavour"]',
          '[class*="selected"][class*="flavor"]'
        ]

        for (const selector of cssSelectors) {
          const element = document.querySelector(selector)
          if (element) {
            // Try data attributes first
            const dataFlavour = element.getAttribute('data-flavour') || element.getAttribute('data-flavor') || element.getAttribute('data-variant')
            if (dataFlavour) return dataFlavour

            // Fallback to text content
            const text = element.textContent?.trim()
            if (text && text.length > 0 && text.length < 50) {
              return text
            }
          }
        }

        // Method 3: Check visually selected elements (elements with distinct borders/backgrounds)
        // Look for elements in variant/flavor sections that have visual selection indicators
        const variantSections = document.querySelectorAll('[class*="variant"], [class*="flavour"], [class*="flavor"], [class*="option"]')
        for (const section of Array.from(variantSections)) {
          const options = section.querySelectorAll('label, button, [role="button"], .option, [class*="option"]')
          for (const opt of Array.from(options)) {
            const styles = window.getComputedStyle(opt)
            const borderWidth = parseInt(styles.borderWidth) || 0
            const hasVisibleBorder = borderWidth > 1 // More than 1px border indicates selection
            const bgColor = styles.backgroundColor
            const hasGradientBorder = styles.borderImageSource && styles.borderImageSource !== 'none'

            // Check if element has visual selection indicators
            if (hasVisibleBorder || hasGradientBorder) {
              const dataFlavour = opt.getAttribute('data-flavour') || opt.getAttribute('data-flavor') || opt.getAttribute('data-variant')
              if (dataFlavour) return dataFlavour

              const text = opt.textContent?.trim()
              if (text && text.length > 0 && text.length < 50) {
                return text
              }
            }
          }
        }

        return null
      })


      // Combine visible text and key elements (token-efficient)
      websiteContent = (visibleText.length > 4000 ? visibleText.substring(0, 4000) + '...' : visibleText) +
        '\n\n--- KEY ELEMENTS ---\n' + keyElements +
        `\nSelected Variant: ${selectedVariant || 'None'}` +
        `\n\n--- QUANTITY DISCOUNT & PROMOTION CHECK ---\nPatterns Found: ${quantityDiscountContext.foundPatterns.join(", ") || "None"}\nBulk/Quantity Discount Detected: ${quantityDiscountContext.hasBulkDiscount ? "YES" : "NO"}\nDiscount Percentage: ${quantityDiscountContext.discountPercentage}\nPrice Drop: ${quantityDiscountContext.priceDrop}\nCoupon Code: ${quantityDiscountContext.couponCode}\nHas Free Shipping Only: ${quantityDiscountContext.hasOnlyFreeShipping ? "YES" : "NO"}\nAny Discount/Promotion Detected: ${quantityDiscountContext.hasAnyDiscount ? "YES" : "NO"}\n` +
        `\n\n--- CTA CONTEXT ---\n${ctaContext}` +
        `\n\n--- SHIPPING TIME CHECK ---\nCTA Found: ${shippingTimeContext.ctaFound ? "YES" : "NO"}\nCTA Text: ${shippingTimeContext.ctaFound ? shippingTimeContext.ctaText : "N/A"}\nCTA Visible Without Scrolling: ${shippingTimeContext.ctaVisibleWithoutScrolling ? "YES" : "NO"}\nShipping Info Near CTA: ${shippingTimeContext.shippingInfoNearCTA}\nHas Countdown/Cutoff Time: ${shippingTimeContext.hasCountdown ? "YES" : "NO"}\nHas Delivery Date: ${shippingTimeContext.hasDeliveryDate ? "YES" : "NO"}\nShipping Text Found: ${shippingTimeContext.shippingText}\nAll Requirements Met: ${shippingTimeContext.allRequirementsMet ? "YES" : "NO"}` +
        `\n\n--- TRUST BADGES CHECK ---\nCTA Found: ${trustBadgesContext.ctaFound ? "YES" : "NO"}\nCTA Text: ${trustBadgesContext.ctaFound ? trustBadgesContext.ctaText : "N/A"}\nCTA Visible Without Scrolling: ${trustBadgesContext.ctaVisibleWithoutScrolling ? "YES" : "NO"}\nTrust Badges Within 50px: ${trustBadgesContext.within50px ? "YES" : "NO"}\nTrust Badges Count: ${trustBadgesContext.trustBadgesCount}\nTrust Badges Visible Without Scrolling: ${trustBadgesContext.visibleWithoutScrolling ? "YES" : "NO"}\nTrust Badges Info: ${trustBadgesContext.trustBadgesInfo}\nTrust Badges List: ${trustBadgesContext.trustBadgesNearCTA.length > 0 ? trustBadgesContext.trustBadgesNearCTA.join(", ") : "None"}`



      // Capture screenshot once for all rules (for AI vision analysis)
      // Capture before closing browser so page is still available
      // Support multiple formats: PNG (best quality), JPEG (fallback), WebP (alternative)
      try {
        let screenshot: string | Buffer | null = null
        let imageFormat = 'png'

        // Try PNG first (best quality, supports transparency, lossless)
        try {
          screenshot = await page.screenshot({
            type: 'png',
            fullPage: false, // Only capture viewport for faster processing
            encoding: 'base64',
          }) as string
          imageFormat = 'png'
          console.log('Screenshot captured in PNG format')
        } catch (pngError) {
          // Fallback to JPEG if PNG fails (smaller file size, good quality)
          try {
            screenshot = await page.screenshot({
              type: 'jpeg',
              fullPage: false,
              encoding: 'base64',
              quality: 90, // High quality JPEG
            }) as string
            imageFormat = 'jpeg'
            console.log('Screenshot captured in JPEG format (PNG fallback)')
          } catch (jpegError) {
            // Final fallback to WebP (modern format, good compression)
            try {
              screenshot = await page.screenshot({
                type: 'webp',
                fullPage: false,
                encoding: 'base64',
                quality: 90, // High quality WebP
              }) as string
              imageFormat = 'webp'
              console.log('Screenshot captured in WebP format (PNG/JPEG fallback)')
            } catch (webpError) {
              console.warn('Failed to capture screenshot in PNG, JPEG, and WebP:', webpError)
              screenshot = null
            }
          }
        }

        if (screenshot) {
          screenshotDataUrl = `data:image/${imageFormat};base64,${screenshot}`
          console.log(`Screenshot ready in ${imageFormat.toUpperCase()} format for AI vision analysis`)
        } else {
          screenshotDataUrl = null
        }
      } catch (screenshotError) {
        console.warn('Failed to capture screenshot:', screenshotError)
        screenshotDataUrl = null
      }

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

    // Check each rule in batches to manage Vercel 60s timeout
    // Optimized: Larger batches, shorter delays for 25 rules
    const results: ScanResult[] = []
    const BATCH_SIZE = 8 // Increased from 5 to 8 for faster processing

    // Split rules into batches of 5
    const batches: Rule[][] = []
    for (let i = 0; i < rules.length; i += BATCH_SIZE) {
      batches.push(rules.slice(i, i + BATCH_SIZE))
    }

    console.log(`Processing ${rules.length} rules in ${batches.length} batches of ${BATCH_SIZE}`)

    // Token usage tracking for rate limiting
    // OpenRouter rate limits - optimized for 60s Vercel timeout
    const MIN_DELAY_BETWEEN_REQUESTS = 300 // Reduced to 300ms for faster processing
    let lastRequestTime = 0

    // Process each batch sequentially
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex]
      console.log(`Processing batch ${batchIndex + 1}/${batches.length} with ${batch.length} rules`)

      // Process rules in current batch with minimal delay
      for (const rule of batch) {
        // Wait if needed to respect rate limits (minimal delay for speed)
        const now = Date.now()
        if (lastRequestTime > 0) {
          const timeSinceLastRequest = now - lastRequestTime
          if (timeSinceLastRequest < MIN_DELAY_BETWEEN_REQUESTS) {
            const waitTime = MIN_DELAY_BETWEEN_REQUESTS - timeSinceLastRequest
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
          const isVideoTestimonialRule =
            rule.title.toLowerCase().includes('video') &&
            (
              rule.title.toLowerCase().includes('testimonial') ||
              rule.title.toLowerCase().includes('review') ||
              rule.title.toLowerCase().includes('customer')
            ) ||
            rule.description.toLowerCase().includes('video testimonial') ||
            rule.description.toLowerCase().includes('customer video') ||
            rule.description.toLowerCase().includes('video review') ||
            rule.description.toLowerCase().includes('real customer video');


          const isLazyRule = rule.title.toLowerCase().includes('lazy') || rule.description.toLowerCase().includes('lazy') || rule.description.toLowerCase().includes('lazy loading')
          const isRatingRule = rule.title.toLowerCase().includes('rating') || rule.description.toLowerCase().includes('rating') || rule.description.toLowerCase().includes('review score') || rule.description.toLowerCase().includes('social proof')
          const isCustomerPhotoRule = rule.title.toLowerCase().includes('customer photo') || rule.title.toLowerCase().includes('customer using') || rule.description.toLowerCase().includes('customer photo') || rule.description.toLowerCase().includes('photos of customers')
          const isStickyCartRule = rule.id === 'cta-sticky-add-to-cart' || rule.title.toLowerCase().includes('sticky') && rule.title.toLowerCase().includes('cart')
          const isProductTitleRule = rule.id === 'product-title-clarity' || rule.title.toLowerCase().includes('product title') || rule.description.toLowerCase().includes('product title')
          const isBenefitsNearTitleRule = rule.id === 'benefits-near-title' || rule.title.toLowerCase().includes('benefits') && rule.title.toLowerCase().includes('title')
          const isCTAProminenceRule = rule.id === 'cta-prominence' || (rule.title.toLowerCase().includes('cta') && rule.title.toLowerCase().includes('prominent'))
          const isFreeShippingThresholdRule = rule.id === 'free-shipping-threshold' || (rule.title.toLowerCase().includes('free shipping') && rule.title.toLowerCase().includes('threshold'))
          const isQuantityDiscountRule =
            rule.title.toLowerCase().includes("quantity") ||
            rule.title.toLowerCase().includes("bulk") ||
            rule.description.toLowerCase().includes("bulk pricing")
          const isShippingRule =
            rule.title.toLowerCase().includes("shipping time") ||
            rule.description.toLowerCase().includes("delivered by")
          const isVariantRule =
            rule.title.toLowerCase().includes("variant") ||
            rule.title.toLowerCase().includes("preselect") ||
            rule.description.toLowerCase().includes("variant") ||
            rule.description.toLowerCase().includes("preselect")
          const isTrustBadgesRule =
            rule.id === 'trust-badges-near-cta' ||
            (rule.title.toLowerCase().includes("trust") && rule.title.toLowerCase().includes("cta")) ||
            (rule.title.toLowerCase().includes("trust") && rule.title.toLowerCase().includes("signal")) ||
            (rule.description.toLowerCase().includes("trust") && rule.description.toLowerCase().includes("cta"))

          // Build concise prompt - only include relevant instructions
          let specialInstructions = ''
          if (isBreadcrumbRule) {
            specialInstructions = `\nBREADCRUMB RULE: Check "Breadcrumbs:" in KEY ELEMENTS. If "Not found" → FAIL, else → PASS.`
          } else if (isColorRule) {
            specialInstructions = `\nCOLOR RULE: Check "Pure black (#000000) detected:" in KEY ELEMENTS. If "YES" → FAIL, if "NO" → PASS.`
          } else if (isLazyRule) {
            specialInstructions = `\nLAZY LOADING RULE - DETAILED CHECK:\nCheck "Lazy loading status:" and "Images without lazy loading:" in KEY ELEMENTS.\n\nIf FAILED: You MUST specify:\n1. WHICH images/videos are missing lazy loading (use image file names or descriptions from KEY ELEMENTS)\n2. WHERE these images/videos are located on the page (e.g., "product gallery section", "hero section", "product images area", "main product image", "thumbnail gallery", "description section")\n3. WHY it's a problem (e.g., "should have loading='lazy' attribute to improve page load time")\n\nIMPORTANT: \n- Do NOT mention currency symbols, prices, or amounts (like £29.00, $50, Rs. 3,166, £39.00) in the failure reason\n- Only mention image/video file names, descriptions, or locations\n- Be specific about WHERE on the page these images are located\n\nExample: "Images without lazy loading: The main product image for 'Rainbow Dust - Starter Kit' (found in product gallery section) is missing the loading='lazy' attribute. Additionally, images in the 'POPULAR PRODUCTS' section also lack lazy loading. These should be lazy-loaded to improve initial page load time."\n\nIf no images/videos found: "No images or videos found on the page to evaluate for lazy loading."\n\nBe SPECIFIC about which elements are missing lazy loading and WHERE they are located, but DO NOT include prices or currency.`
          }

          else if (isVideoTestimonialRule) {
            specialInstructions = `
VIDEO TESTIMONIALS RULE - DETAILED CHECK:

Check KEY ELEMENTS for:
- Video testimonials section
- Embedded videos (YouTube, Vimeo, self-hosted)
- Customer review videos
- Customer face + voice presence
- Placement (homepage / product page)

If FAILED: You MUST specify:
1. WHETHER any video testimonials are present or not
2. WHERE video testimonials are missing (e.g., "homepage", "product page", "below product description", "reviews section")
3. WHAT is missing:
   - No video testimonials at all
   - Only text testimonials present
   - Videos exist but are promotional, not customer testimonials
4. WHY it's a problem (e.g., "video testimonials build trust and improve conversions")

If PASSED: You MUST specify:
1. WHERE the video testimonials are located on the page
2. WHAT makes them valid (real customer, face visible, product mentioned)
3. TYPE of video (YouTube embed, self-hosted, Vimeo)

IMPORTANT:
- Do NOT mention prices, currency symbols, or amounts
- Do NOT assume customers are actors unless clearly promotional
- Only evaluate visible content on the page
- Be specific about WHERE on the page the video testimonials appear or are missing

Example FAILURE:
"No video testimonials were found on the homepage or product page. The website only includes text-based customer reviews below the product description. Adding real customer video testimonials would increase trust and engagement."

Example SUCCESS:
"A video testimonial section is present below the product description. Embedded YouTube videos feature real customers speaking about their experience with the product, making the testimonials authentic and trust-building."

If no videos found at all:
"No video testimonials or embedded customer videos were found on the page."

Be SPECIFIC, factual, and based only on visible page content.
`
          }

          else if (isRatingRule) {
            specialInstructions = `\nPRODUCT RATINGS RULE - STRICT CHECK:\nRatings MUST be displayed NEAR product title (within same section/area) and MUST include ALL of the following:\n\n1. REVIEW SCORE: Must show the rating score (e.g., "4.3/5", "4 stars", "4.5", "★★★★☆", "4.5 out of 5")\n2. REVIEW COUNT: Must show the total number of reviews/ratings (e.g., "203 reviews", "150 ratings", "1.2k reviews", "1,234 customer reviews")\n3. CLICKABLE LINK: Must be clickable/linkable to reviews section (anchor link like #reviews or scroll to reviews section)\n\nALL 3 requirements must be present to PASS. If ANY is missing → FAIL.\n\nIf FAILED, you MUST specify:\n- WHERE the rating is located (if it exists)\n- WHAT is present (review score, review count, or clickable link)\n- WHAT is MISSING (specifically mention if "review count is missing" or "review score is missing" or "clickable link to reviews is missing")\n- WHY it fails (e.g., "Rating shows '4.5 out of 5' but review count (like '203 reviews') is missing", or "Rating is not clickable to navigate to reviews section")\n\nIMPORTANT: Review score and review count are TWO SEPARATE requirements. If only score is shown without count → FAIL with reason "Review count is missing". If only count is shown without score → FAIL with reason "Review score is missing".\n\nExample FAIL reason: "Product ratings show '4.5 out of 5' and 'Excellent' near the product title, but the review count (e.g., '203 reviews') is missing. The rating is clickable and navigates to reviews section, but without the review count, users cannot see how many people have rated the product. Review count is required for social proof."`
          } else if (isCustomerPhotoRule) {
            specialInstructions = `
CUSTOMER PHOTOS RULE - VISUAL ANALYSIS WITH SCREENSHOT:

CRITICAL: You will receive a SCREENSHOT IMAGE of the product page. You MUST visually analyze this image to check for customer photos.

STEP 1 (Visual Scan - Look at the Screenshot):
- Examine the entire screenshot image provided
- Look for images in: product gallery, description section, review section, or user-generated content areas
- Scan for photos that show the product being USED by real customers

STEP 2 (Identify Customer Photos):
Look for visual indicators of authentic customer photos:
- Natural lighting (not studio lighting)
- Real-world backgrounds (homes, offices, outdoor settings)
- Non-professional models (regular people, not models)
- Product in use (being worn, held, or used in real life)
- User-uploaded style (different angles, casual settings)

STEP 3 (Differentiate from Professional Photos):
EXCLUDE these (they are NOT customer photos):
- Studio shots with white/plain backgrounds
- Professional product photography
- Branded/model photos
- Product-only images (no people using it)
- Stock photos

STEP 4 (Final Verdict):
- PASS if you find at least ONE (1) authentic customer photo in the screenshot
- FAIL if you only see professional/studio photos or product-only images
- FAIL if no images are visible in the screenshot

IMPORTANT:
- You MUST look at the SCREENSHOT IMAGE provided, not just text content
- Visual analysis is required - check the actual images in the screenshot
- If customer photos are present in the screenshot, the rule PASSES
- Be specific about WHERE in the screenshot you see customer photos (e.g., "review section", "gallery", "user photos section")

Examples:
✅ PASS: "I can see in the screenshot that there are customer-uploaded photos in the review section showing the product being used in real home settings with natural lighting. These are authentic customer photos, not professional studio shots."
❌ FAIL: "In the screenshot, I only see professional product images with white backgrounds and studio lighting. No customer photos are visible in the review section or gallery."
`
          } else if (isStickyCartRule) {
            specialInstructions = `\nSTICKY ADD TO CART RULE - DETAILED CHECK:\nThe page MUST have a sticky/floating "Add to Cart" button that remains visible when scrolling.\n\nIf FAILED: You MUST specify:\n1. WHICH button is the "Add to Cart" button (mention button text/label, but DO NOT include currency/price in the reason)\n2. WHERE it is located (e.g., "main product section", "product details area")\n3. WHY it fails (e.g., "button disappears when scrolling", "only visible at bottom of page", "not sticky/floating")\n\nIMPORTANT: Do NOT mention currency symbols, prices, or amounts (like £29.00, $50, Rs. 3,166) in the failure reason. Only mention the button text/label without price.\n\nExample: "The 'Add to Cart' button found in the main product section disappears when user scrolls down. It only becomes visible again when scrolled to the bottom of the page, but does not remain sticky/floating as required."`
          } else if (isProductTitleRule) {
            specialInstructions = `\nPRODUCT TITLE RULE - DETAILED CHECK:\nThe PRODUCT TITLE itself (not the description section) must be descriptive, specific, and include key attributes.\n\nCRITICAL: This rule checks the TITLE only. A product description section existing on the page does NOT make a generic title acceptable. The title must be descriptive on its own.\n\nTitle should include: brand, size, color, key characteristics, or specific benefits. Should be under 65 characters for SEO.\n\nIf FAILED: You MUST specify:\n1. WHAT the current title is (quote it exactly)\n2. WHAT is missing from the TITLE (e.g., size, color, brand, key characteristics, specific benefits)\n3. WHY it's a problem (e.g., "too generic", "lacks SEO keywords", "doesn't describe product clearly on its own")\n4. WHERE the title is located (e.g., "product page header", "product title section")\n5. NOTE if description exists but explain that title should still be descriptive independently\n\nIf PASSED: Title must be descriptive and clear on its own, even if description section also exists.\n\nExample FAIL: "The product title 'Rainbow Dust - Starter Kit' located in the product page header is too generic. While a product description section exists with benefits, the title itself lacks key attributes like size (e.g., '50g', '100ml'), flavor/variant details, or specific benefits. The title should be descriptive on its own for SEO and clarity, regardless of description content."\n\nExample PASS: "The product title 'Spacegoods Rainbow Dust - Coffee Flavor Starter Kit (50g)' is descriptive and clear. It includes brand name, product name, flavor variant, and size, making it SEO-friendly and informative."`
          } else if (isBenefitsNearTitleRule) {
            specialInstructions = `\nBENEFITS NEAR PRODUCT TITLE RULE - DETAILED CHECK:\nA short list of 2-3 key benefits MUST be displayed NEAR the product title (below or beside it, within the same section/area).\n\nREQUIREMENTS:\n1. Benefits must be NEAR product title (same section/area, not far below or in separate sections)\n2. Must have 2-3 benefits (not just 1, not more than 3)\n3. Benefits should be specific, impactful, and aligned with key selling points\n4. Benefits should stand out visually (bold, contrasting fonts, or clear formatting)\n5. Benefits should be concise and easy to scan\n\nIf PASSED: You MUST specify:\n- WHERE the benefits are located (e.g., "directly below product title", "beside product title in same section")\n- WHAT benefits are shown (list 2-3 benefits)\n- WHY it passes (e.g., "benefits are clearly visible near title and communicate value effectively")\n\nExample PASS: "Key benefits are displayed directly below the product title 'Rainbow Dust - Starter Kit' in the product header section: (1) 'Boost productivity with focus & energy without jitters', (2) 'Reduce anxiety & distraction, flow state all day', (3) '7-in-1 blend of coffee + potent mushrooms & adaptogens'. These benefits are clearly visible, specific, and help users quickly understand the product value."\n\nIf FAILED: You MUST specify:\n- WHERE the product title is located\n- WHERE benefits are located (if they exist elsewhere on the page)\n- WHAT is missing (e.g., "no benefits near title", "only 1 benefit shown", "benefits are too far from title in separate section", "benefits are not specific/impactful")\n- WHY it fails (e.g., "benefits are in description section far below title, not near title", "only generic benefits shown", "benefits don't stand out visually")\n\nExample FAIL: "The product title 'Rainbow Dust - Starter Kit' is located in the product header section, but there are no key benefits displayed near it. While product benefits exist in the description section further down the page (e.g., 'Boost productivity', 'Reduce anxiety'), these are not near the product title as required. Benefits should be placed directly below or beside the product title in the same section to quickly communicate value and capture attention."`
          } else if (isColorRule) {
            specialInstructions = `\nCOLOR RULE - STRICT CHECK:\nCheck "Pure black (#000000) detected:" in KEY ELEMENTS.\nIf "YES" → FAIL (black is being used, violates rule)\nIf "NO" → PASS (no pure black, rule followed)\nAlso verify in content: look for #000000, rgb(0,0,0), or "black" color codes.\nSofter tones like #333333, #121212 are acceptable.`
          } else if (isQuantityDiscountRule) {
            specialInstructions = `
QUANTITY DISCOUNT & PROMOTION RULE - STEP-BY-STEP CHECK:

This rule checks if the product page displays ANY discount or promotional offer (quantity discounts, bulk discounts, OR general product discounts).

STEP 1: Check "QUANTITY DISCOUNT & PROMOTION CHECK" section in KEY ELEMENTS
- Look for "Any Discount/Promotion Detected: YES" or "Any Discount/Promotion Detected: NO"

STEP 2: If "Any Discount/Promotion Detected: YES", check which type of discount is present:

A. QUANTITY/BULK DISCOUNTS (Check "Bulk/Quantity Discount Detected"):
   - "Buy 2 Get 1 Free", "Buy 3 save 10%", "Save 10% when you buy 3"
   - Tiered pricing (e.g., "$10 each for 5+ units")
   - Volume discounts, bundle offers
   - If "Bulk/Quantity Discount Detected: YES" → PASS

B. GENERAL DISCOUNTS (Check individual fields):
   - Discount Percentage: Check if value is NOT "None" (e.g., "20% off", "10% discount")
   - Price Drop: Check if value is NOT "None" (e.g., "Was $50, Now $40", "Original $100, Now $80")
   - Coupon Code: Check if value is NOT "None" (e.g., "Use code SAVE20", "Coupon: DISCOUNT10")
   - If ANY of these is NOT "None" → PASS

STEP 3: Exclude free shipping alone
- If "Has Free Shipping Only: YES" → This means ONLY free shipping exists, NO price discount → FAIL
- If "Has Free Shipping Only: NO" and discount exists → PASS

STEP 4: Determine result
- PASS if ANY discount type is present (quantity/bulk discount OR general discount with price reduction)
- FAIL if NO discount is present OR only free shipping exists without price reduction

EXAMPLES:

Example 1 - PASS (Price Drop):
Input: "Buy this iPhone for $999, original price $1200."
QUANTITY DISCOUNT & PROMOTION CHECK shows:
- Price Drop: "original price $1200" (or similar)
- Any Discount/Promotion Detected: YES
Output: {"passed": true, "reason": "Price drop detected: Product shows original price $1200, now $999, indicating a discount."}

Example 2 - FAIL (No Discount):
Input: "Fresh organic apples at $5 per kg."
QUANTITY DISCOUNT & PROMOTION CHECK shows:
- Discount Percentage: None
- Price Drop: None
- Coupon Code: None
- Bulk/Quantity Discount Detected: NO
- Any Discount/Promotion Detected: NO
Output: {"passed": false, "reason": "No discount or promotional offer detected. Product shows standard pricing without any discount percentage, price drop, coupon code, or bulk discount."}

Example 3 - PASS (Coupon Code):
Input: "Get 20% off on all Nike shoes using code NIKE20."
QUANTITY DISCOUNT & PROMOTION CHECK shows:
- Discount Percentage: "20% off"
- Coupon Code: "code NIKE20" (or similar)
- Any Discount/Promotion Detected: YES
Output: {"passed": true, "reason": "Discount detected: 20% off discount with coupon code NIKE20 available."}

Example 4 - FAIL (Free Shipping Only):
Input: "Free shipping on all orders. Product price: $50."
QUANTITY DISCOUNT & PROMOTION CHECK shows:
- Has Free Shipping Only: YES
- Any Discount/Promotion Detected: NO
Output: {"passed": false, "reason": "No discount on product price detected. Only free shipping is offered, but the product price remains the same without any discount."}

Example 5 - PASS (Quantity Discount):
Input: "Buy 2 Get 1 Free on all items."
QUANTITY DISCOUNT & PROMOTION CHECK shows:
- Bulk/Quantity Discount Detected: YES
- Any Discount/Promotion Detected: YES
Output: {"passed": true, "reason": "Quantity discount detected: 'Buy 2 Get 1 Free' offer is displayed, providing financial incentive for purchasing multiple units."}

CRITICAL INSTRUCTIONS:
1. You MUST check the "QUANTITY DISCOUNT & PROMOTION CHECK" section in KEY ELEMENTS
2. Follow the step-by-step process above
3. If "Any Discount/Promotion Detected: YES" → PASS (unless it's only free shipping)
4. If "Any Discount/Promotion Detected: NO" → FAIL
5. If "Has Free Shipping Only: YES" → FAIL (free shipping alone doesn't count as discount)
6. Be SPECIFIC about which discount type is present (quantity/bulk, percentage, price drop, coupon, etc.)
7. Quote the exact discount text from the page if available
8. If PASSED: Mention the specific discount type and where it's located
9. If FAILED: Explain that no discount or promotional offer is visible on the product page
          `
          } else if (isShippingRule) {
            specialInstructions = `
SHIPPING TIME VISIBILITY RULE - STEP-BY-STEP AUDIT:

You are an expert E-commerce UX Auditor. Your task is to analyze the Product Page based on the rule: 'Display shipping time near CTA'.

Please follow these steps strictly:

STEP 1 (Locate CTA): 
- Check "SHIPPING TIME CHECK" section in KEY ELEMENTS
- Look for "CTA Found: YES" or "CTA Found: NO"
- If "CTA Found: NO" → FAIL (Cannot evaluate without CTA)
- If "CTA Found: YES", note the "CTA Text" (e.g., "Add to Cart", "Buy Now")

STEP 2 (Check Proximity): 
- Check "Shipping Info Near CTA" in SHIPPING TIME CHECK section
- Verify that shipping information is located directly above or below the CTA button
- Check "CTA Visible Without Scrolling: YES" - CTA must be visible without scrolling
- If shipping info is NOT near CTA (e.g., in footer, far from button) → FAIL

STEP 3 (Verify Dynamic Logic - Countdown/Cutoff Time): 
- Check "Has Countdown/Cutoff Time: YES" or "Has Countdown/Cutoff Time: NO"
- Look for patterns like:
  * "Order within X hours" (e.g., "Order within 3 hrs 20 mins")
  * "Order by [Time]" (e.g., "Order by 3 PM")
  * "Order before [Time]" (e.g., "Order before 5 PM")
  * "Cutoff time" mentions
- If "Has Countdown/Cutoff Time: NO" → FAIL (Missing countdown/cutoff time requirement)

STEP 4 (Verify Delivery Date): 
- Check "Has Delivery Date: YES" or "Has Delivery Date: NO"
- Look for specific delivery date or range patterns like:
  * "Get it by [Day], [Month] [Date]" (e.g., "Get it by Thursday, Oct 12th")
  * "Delivered by [Day], [Month] [Date]" (e.g., "Delivered by Tuesday, Oct 10th")
  * "Arrives by [Day], [Month] [Date]"
  * "Get it on [Day], [Month] [Date]"
- If "Has Delivery Date: NO" → FAIL (Missing specific delivery date requirement)

STEP 5 (Final Verdict): 
- Check "All Requirements Met: YES" or "All Requirements Met: NO"
- PASS if ALL of the following are met:
  1. CTA found and visible without scrolling
  2. Shipping info is near CTA (directly above or below)
  3. Countdown/cutoff time is present
  4. Specific delivery date is present
- FAIL if ANY requirement is missing

EXAMPLES FOR AI TRAINING:

✅ GOOD EXAMPLE (PASS):
SHIPPING TIME CHECK shows:
- CTA Found: YES
- CTA Text: Add to Cart
- CTA Visible Without Scrolling: YES
- Shipping Info Near CTA: "Order within 3 hrs 20 mins, get it by Thursday, Oct 12th."
- Has Countdown/Cutoff Time: YES
- Has Delivery Date: YES
- Shipping Text Found: "Order within 3 hrs 20 mins get it by Thursday, Oct 12th"
- All Requirements Met: YES

Reason: "Dynamic delivery estimate is displayed near the 'Add to Cart' button. The message 'Order within 3 hrs 20 mins, get it by Thursday, Oct 12th' includes both a countdown (3 hrs 20 mins) and a specific delivery date (Thursday, Oct 12th), positioned directly below the CTA button. This reduces purchase friction by managing expectations upfront."

❌ BAD EXAMPLE (FAIL - Missing Countdown):
SHIPPING TIME CHECK shows:
- CTA Found: YES
- CTA Text: Buy Now
- CTA Visible Without Scrolling: YES
- Shipping Info Near CTA: "Fast shipping available. Get it by Thursday."
- Has Countdown/Cutoff Time: NO
- Has Delivery Date: YES
- Shipping Text Found: "Get it by Thursday"
- All Requirements Met: NO

Reason: "Shipping information 'Get it by Thursday' is displayed near the 'Buy Now' button and includes a delivery date, but it is missing the countdown or specific cutoff time requirement (e.g., 'Order within X hours' or 'Order by X PM'). The rule requires both a countdown/cutoff time AND a delivery date to be present."

❌ BAD EXAMPLE (FAIL - Missing Delivery Date):
SHIPPING TIME CHECK shows:
- CTA Found: YES
- CTA Text: Add to Cart
- CTA Visible Without Scrolling: YES
- Shipping Info Near CTA: "Order within 2 hours for fast delivery."
- Has Countdown/Cutoff Time: YES
- Has Delivery Date: NO
- Shipping Text Found: "Order within 2 hours"
- All Requirements Met: NO

Reason: "Shipping information 'Order within 2 hours for fast delivery' is displayed near the 'Add to Cart' button and includes a countdown (2 hours), but it is missing the specific delivery date requirement (e.g., 'Get it by Tuesday, Oct 12th'). The rule requires both a countdown/cutoff time AND a specific delivery date to be present."

❌ BAD EXAMPLE (FAIL - Not Near CTA):
SHIPPING TIME CHECK shows:
- CTA Found: YES
- CTA Text: Add to Cart
- CTA Visible Without Scrolling: YES
- Shipping Info Near CTA: "Fast shipping available nationwide" (but this is in footer, not near CTA)
- Has Countdown/Cutoff Time: NO
- Has Delivery Date: NO
- Shipping Text Found: None
- All Requirements Met: NO

Reason: "Shipping information 'Fast shipping available nationwide' exists on the page but is located in the footer, far from the 'Add to Cart' button. The rule requires shipping time information to be placed in immediate proximity (directly above or below) the primary CTA. Additionally, the message lacks both a countdown/cutoff time and a specific delivery date."

CRITICAL INSTRUCTIONS:
1. You MUST check the "SHIPPING TIME CHECK" section in KEY ELEMENTS
2. Follow the 5-step process above precisely
3. Check BOTH countdown/cutoff time AND delivery date - BOTH are required
4. Verify proximity - shipping info must be directly above or below CTA
5. If ANY requirement is missing → FAIL
6. Be SPECIFIC about which requirement is missing in your reason
7. Quote the exact shipping text from "Shipping Text Found" if available
8. Do NOT mention currency symbols, prices, or amounts in the reason
        `
          } else if (isVariantRule) {
            specialInstructions = `
VARIANT PRESELECTION RULE - STEP-BY-STEP AUDIT:

You are a UX Audit Specialist. Your task is to check if a product page follows the "Variant Preselection" rule.

Rule Definition: The most common variant (size, color, etc.) must be preselected by default when the page loads to reduce user friction.

STEP 1 (Initial Load Check - Is Variant Selected?):
- Check "Selected Variant:" in KEY ELEMENTS section
- Look for the line "Selected Variant: [value]" in KEY ELEMENTS
- If "Selected Variant:" shows a value (like "Coffee", "Small", "Red", "Medium", etc.) → Variant IS preselected
- If "Selected Variant:" shows "None" → No variant preselected → FAIL this step
- IMPORTANT: Variants can be preselected via CSS styling (gradient borders, selected classes) even if radio input doesn't have "checked" attribute
- Visual selection via CSS (like gradient borders, highlighted backgrounds) IS a valid preselection
- The "Selected Variant:" value already accounts for CSS-based selections

STEP 2 (Friction Analysis - Can User Add to Cart Immediately?):
- Check if user has to click a variant before they can click "Add to Cart"
- Look for disabled "Add to Cart" buttons or "Select a Size/Color" messages
- If "Add to Cart" button is disabled until variant is selected → FAIL (increases friction)
- If user can click "Add to Cart" immediately without selecting variant → PASS this step
- If dropdown shows "Select a Size" or similar placeholder → FAIL (no preselection)
- If variant is preselected and "Add to Cart" is enabled → PASS this step

STEP 3 (Visual Clarity - Is Selected Variant Clearly Highlighted?):
- Check if the selected variant is clearly different from unselected ones
- Look for visual indicators:
  * Bold border around selected variant
  * Darker color or different background
  * Selected state styling (highlighted, active class)
  * Clear visual distinction from other options
- If all variant options look the same on page load → FAIL (no visual clarity)
- If selected variant has clear visual distinction → PASS this step
- If variant is preselected but not visually clear → Partial PASS (preselected but needs better visual clarity)

STEP 4 (Final Verdict):
- PASS if ALL 3 steps pass:
  1. Variant is preselected on initial load ✓
  2. User can add to cart immediately (no friction) ✓
  3. Selected variant is clearly highlighted visually ✓
- FAIL if Step 1 or Step 2 fails (no preselection or friction exists)
- Partial PASS if Step 1 and 2 pass but Step 3 fails (preselected but not visually clear)

EXAMPLES FOR AI TRAINING:

✅ Example 1 - PASS (Good - T-shirt with Size M Preselected):
Analysis:
- STEP 1: Checked "Selected Variant:" in KEY ELEMENTS → Shows "Selected Variant: M" (Medium size is preselected)
- STEP 2: "Add to Cart" button is enabled immediately, user can click without selecting size first
- STEP 3: Size M has a blue border around it, clearly different from other sizes (S, L, XL)
- STEP 4: All requirements met

Output: {"passed": true, "reason": "The variant 'M' (Medium size) is preselected by default when the page loads. The selected variant has a blue border, making it clearly distinguishable from other options. Users can click 'Add to Cart' immediately without selecting a variant first, reducing friction."}

❌ Example 2 - FAIL (Bad - Shoe Page with Dropdown):
Analysis:
- STEP 1: Checked "Selected Variant:" in KEY ELEMENTS → Shows "Selected Variant: None" (no variant preselected)
- STEP 2: Dropdown shows "Select a Size" placeholder, "Add to Cart" button is disabled until user picks a size
- STEP 3: No variant is selected, so visual clarity check is not applicable
- STEP 4: Preselection requirement failed

Output: {"passed": false, "reason": "No variant is preselected on page load. The size dropdown shows 'Select a Size' placeholder and the 'Add to Cart' button is disabled until the user selects a size. This increases friction and requires an extra click before purchase. The most common variant should be preselected by default."}

❌ Example 3 - FAIL (Bad - All Color Circles Look the Same):
Analysis:
- STEP 1: Checked "Selected Variant:" in KEY ELEMENTS → Shows "Selected Variant: None" (no variant preselected)
- STEP 2: "Add to Cart" button is enabled but no color is selected, user must click a color first
- STEP 3: All color circles look identical on page load, no visual indication of which is selected (none are selected)
- STEP 4: Preselection and visual clarity requirements failed

Output: {"passed": false, "reason": "No variant is preselected on page load. All color options look identical with no visual distinction, and users cannot determine which color is active. The 'Add to Cart' button is enabled but users must select a color first, increasing friction. The most common color should be preselected and clearly highlighted."}

✅ Example 4 - PASS (Good - Coffee Flavor Preselected with CSS):
Analysis:
- STEP 1: Checked "Selected Variant:" in KEY ELEMENTS → Shows "Selected Variant: Coffee" (preselected via CSS styling)
- STEP 2: "Add to Cart" button is enabled immediately, user can add to cart without selecting flavor
- STEP 3: Coffee flavor option has a gradient border and darker background, clearly different from other flavors
- STEP 4: All requirements met

Output: {"passed": true, "reason": "The variant 'Coffee' is preselected by default (via CSS styling with gradient border). The selected variant is clearly highlighted with a darker background and gradient border, making it visually distinct from other flavor options. Users can click 'Add to Cart' immediately, reducing friction."}

❌ Example 5 - FAIL (Bad - Add to Cart Disabled):
Analysis:
- STEP 1: Checked "Selected Variant:" in KEY ELEMENTS → Shows "Selected Variant: None"
- STEP 2: "Add to Cart" button is disabled/grayed out with message "Please select a size first"
- STEP 3: No variant is selected, so visual clarity is not applicable
- STEP 4: Preselection requirement failed

Output: {"passed": false, "reason": "No variant is preselected on page load. The 'Add to Cart' button is disabled with a 'Please select a size first' message, requiring users to make an additional selection before purchase. This increases friction. The most common variant should be preselected to allow immediate purchase."}

CRITICAL INSTRUCTIONS:
1. You MUST check "Selected Variant:" in KEY ELEMENTS section FIRST
2. If "Selected Variant: None" → FAIL (no preselection)
3. If "Selected Variant: [any value]" → Variant IS preselected, proceed to check friction and visual clarity
4. CSS-based selection (gradient borders, selected classes) COUNTS as valid preselection
5. Check if "Add to Cart" is enabled immediately or requires variant selection first
6. Verify visual clarity - selected variant must be clearly different from others
7. If PASSED: Mention the preselected variant name and how it's visually highlighted
8. If FAILED: Explain what's missing (no preselection, disabled button, or lack of visual clarity)
9. Be SPECIFIC about which variant is preselected (if any) and how it's displayed
10. Do NOT mention currency symbols, prices, or amounts in the reason
`
          } else if (isTrustBadgesRule) {
            specialInstructions = `
TRUST BADGES NEAR CTA RULE - STEP-BY-STEP CHECK:

This rule checks if trust signals (security badges, payment logos) are positioned within 50px of the CTA button, visible without scrolling, and have muted/monochromatic design.

STEP 1: Identify CTA
- Check "TRUST BADGES CHECK" section in KEY ELEMENTS
- Look for "CTA Found: YES" or "CTA Found: NO"
- If "CTA Found: NO" → FAIL (cannot check proximity without CTA)
- Note the "CTA Text" value (e.g., "Add to Cart", "Checkout", "Buy Now")

STEP 2: Check Proximity (50px constraint)
- Check "Trust Badges Within 50px: YES" or "Trust Badges Within 50px: NO"
- If "Trust Badges Within 50px: NO" → FAIL
- Check "Trust Badges Count" - must be > 0
- Check "Trust Badges List" to see which badges are found (SSL, Visa, PayPal, Money-back Guarantee, etc.)

STEP 3: Check Visibility (without scrolling)
- Check "CTA Visible Without Scrolling: YES" or "CTA Visible Without Scrolling: NO"
- Check "Trust Badges Visible Without Scrolling: YES" or "Trust Badges Visible Without Scrolling: NO"
- If CTA requires scrolling → FAIL (CTA must be visible without scrolling)
- If trust badges require scrolling → FAIL (badges must be visible without scrolling)
- BOTH CTA and badges must be visible without scrolling → PASS this step

STEP 4: Check Design (muted/monochromatic, less prominent than CTA)
- This step requires visual analysis of the page content
- Trust badges should use muted colors or monochromatic design
- Badges should have lower visual weight than the main CTA button
- If badges are too bright, colorful, or distracting → FAIL
- If badges compete with CTA for attention → FAIL
- If badges are subtle and don't distract from CTA → PASS this step

DETERMINE RESULT:
- PASS only if ALL 4 steps pass:
  1. CTA is found ✓
  2. Trust badges are within 50px of CTA ✓
  3. Both CTA and badges are visible without scrolling ✓
  4. Badges are muted/monochromatic and less prominent than CTA ✓
- FAIL if ANY step fails

EXAMPLES:

Example 1 - PASS (All requirements met):
TRUST BADGES CHECK shows:
- CTA Found: YES
- CTA Text: "Add to Cart"
- CTA Visible Without Scrolling: YES
- Trust Badges Within 50px: YES
- Trust Badges Count: 3
- Trust Badges Visible Without Scrolling: YES
- Trust Badges List: "SSL Secure, Visa, PayPal"
Output: {"passed": true, "reason": "Trust signals (SSL Secure, Visa, PayPal) are positioned within 50px of the 'Add to Cart' button, visible without scrolling, and use muted design that doesn't distract from the CTA."}

Example 2 - FAIL (No badges within 50px):
TRUST BADGES CHECK shows:
- CTA Found: YES
- CTA Text: "Add to Cart"
- CTA Visible Without Scrolling: YES
- Trust Badges Within 50px: NO
- Trust Badges Count: 0
Output: {"passed": false, "reason": "No trust signals (SSL, payment logos, security badges) are positioned within 50px of the 'Add to Cart' button. Trust badges must be within 50px of the CTA to reassure users and reduce hesitation."}

Example 3 - FAIL (Badges require scrolling):
TRUST BADGES CHECK shows:
- CTA Found: YES
- CTA Visible Without Scrolling: YES
- Trust Badges Within 50px: YES
- Trust Badges Visible Without Scrolling: NO
Output: {"passed": false, "reason": "Trust badges are within 50px of the CTA but are not visible without scrolling. Both the CTA and trust badges must be visible without scrolling to meet the requirement."}

Example 4 - FAIL (Badges too prominent/distracting):
TRUST BADGES CHECK shows:
- CTA Found: YES
- Trust Badges Within 50px: YES
- Trust Badges Visible Without Scrolling: YES
- (Visual analysis: Badges are bright, colorful, and compete with CTA for attention)
Output: {"passed": false, "reason": "Trust badges are within 50px of the CTA and visible without scrolling, but they use bright, colorful designs that compete with the main CTA for attention. Badges should use muted or monochromatic designs with lower visual weight than the CTA."}

CRITICAL INSTRUCTIONS:
1. You MUST check the "TRUST BADGES CHECK" section in KEY ELEMENTS
2. Follow the step-by-step process above (Identify CTA → Check Proximity → Check Visibility → Check Design)
3. Be SPECIFIC about which trust badges are found (SSL, Visa, PayPal, Money-back Guarantee, etc.)
4. If FAILED: Specify which step failed (proximity, visibility, or design)
5. If PASSED: Confirm all 4 steps passed
6. Quote exact badge names from "Trust Badges List" if available
7. Mention the CTA text from "CTA Text" field
8. For design check, analyze if badges are muted/monochromatic based on content description
`
          } else if (isCTAProminenceRule) {
            specialInstructions = `
CTA PROMINENCE RULE - STEP-BY-STEP AUDIT:

Task: Audit the "CTA Prominence" of this product page.

You are an expert E-commerce UX Auditor. Follow these steps strictly:

STEP 1 (Identify - Find Primary CTA):
- Look for the primary "Add to Cart" or "Buy Now" button
- Check "CTA CONTEXT" section in KEY ELEMENTS for CTA information
- Identify the main call-to-action button (not secondary buttons like "Wishlist" or "Compare")

STEP 2 (Check Position - Above the Fold):
- Verify if the button is "Above the Fold" (visible without scrolling)
- Check if button is immediately visible when page loads
- If button requires scrolling to see → FAIL (must be above the fold)
- If button is visible at the top of the page without scrolling → PASS this step

STEP 3 (Analyze Contrast - Color Stands Out):
- Check if the button color stands out clearly from the page background
- Good examples: Solid electric blue button on white background, bright green on white, high-contrast colors
- Bad examples: Ghost button (transparent with thin border), light gray on white, low-contrast colors
- Button should have high visual contrast against background
- If button blends into background → FAIL
- If button has clear, high-contrast color → PASS this step

STEP 4 (Check Size - Largest Clickable Element):
- Verify if the button is the largest, most clickable element in the product section
- Compare button size with other buttons (Wishlist, Compare, etc.)
- Button should be larger than secondary buttons
- Button should be easily clickable (not too small)
- If button is smaller than other elements or too small → FAIL
- If button is the largest clickable element → PASS this step

STEP 5 (Final Verdict):
- PASS if ALL 4 steps pass:
  1. Primary CTA identified ✓
  2. Above the fold (visible without scrolling) ✓
  3. High-contrast color (stands out from background) ✓
  4. Largest clickable element (bigger than secondary buttons) ✓
- FAIL if ANY step fails

EXAMPLES FOR AI TRAINING:

✅ Example 1 - PASS (Good - Solid Electric Blue Button):
Analysis:
- STEP 1: Found primary "Add to Cart" button
- STEP 2: Button is above the fold, visible immediately without scrolling
- STEP 3: Button uses solid electric blue color on white background - high contrast, clearly stands out
- STEP 4: Button is the largest clickable element in product section, bigger than "Wishlist" and "Compare" buttons
- STEP 5: All requirements met

Output: {"passed": true, "reason": "The 'Add to Cart' button is prominently displayed above the fold with a solid electric blue color on white background, providing high contrast. It is the largest clickable element in the product section and is immediately visible without scrolling, meeting all prominence requirements."}

❌ Example 2 - FAIL (Bad - Ghost Button):
Analysis:
- STEP 1: Found primary "Add to Cart" button
- STEP 2: Button is above the fold, visible without scrolling
- STEP 3: Button is a ghost button (transparent with thin border) that blends into the white background - low contrast
- STEP 4: Button size is reasonable but lacks visual prominence due to low contrast
- STEP 5: Contrast requirement failed

Output: {"passed": false, "reason": "The 'Add to Cart' button is above the fold but uses a ghost button design (transparent with thin border) that blends into the white background. The low contrast makes it less prominent than required. The button should use a solid, high-contrast color to stand out clearly."}

❌ Example 3 - FAIL (Bad - Below the Fold):
Analysis:
- STEP 1: Found primary "Add to Cart" button
- STEP 2: Button requires scrolling to be visible - located below the fold
- STEP 3: Button has good contrast (green on white)
- STEP 4: Button is large and prominent
- STEP 5: Position requirement failed

Output: {"passed": false, "reason": "The 'Add to Cart' button requires scrolling to be visible and is located below the fold. While it has good contrast and size, it must be positioned above the fold (visible without scrolling) to meet the prominence requirement."}

✅ Example 4 - PASS (Good - High Contrast, Large Size):
Analysis:
- STEP 1: Found primary "Buy Now" button
- STEP 2: Button is above the fold, immediately visible
- STEP 3: Button uses bright orange color on dark background - excellent contrast
- STEP 4: Button is significantly larger than other buttons in the section
- STEP 5: All requirements met

Output: {"passed": true, "reason": "The 'Buy Now' button is prominently displayed above the fold with a bright orange color on dark background, providing excellent contrast. It is the largest clickable element in the product section and is immediately visible, meeting all prominence requirements."}

CRITICAL INSTRUCTIONS:
1. You MUST check ALL 4 steps: Identify → Position → Contrast → Size
2. Above the fold means visible WITHOUT scrolling
3. High contrast means button color clearly stands out from background
4. Largest element means bigger than secondary buttons in the same section
5. Ghost buttons (transparent with borders) typically FAIL contrast check
6. Solid, bright colors on contrasting backgrounds typically PASS
7. If PASSED: Mention position (above fold), contrast (color description), and size
8. If FAILED: Specify which step failed (position, contrast, or size) and why
9. Do NOT mention currency symbols, prices, or amounts in the reason
10. Focus on visual prominence: position, contrast, and size
`
          } else if (isFreeShippingThresholdRule) {
            specialInstructions = `
FREE SHIPPING THRESHOLD RULE - STEP-BY-STEP AUDIT:

Task: Audit the "Free Shipping Threshold" visibility on this product page.

You are an expert E-commerce UX Auditor. Follow these steps strictly:

STEP 1 (Locate - Find CTA Button):
- Identify the main "Add to Cart" button
- Check "CTA CONTEXT" section in KEY ELEMENTS for CTA location
- Note the button's position on the page

STEP 2 (Verify Proximity - Within 50-100 pixels):
- Look at the area immediately surrounding the main "Add to Cart" button
- Check if free shipping message is within 50-100 pixels of the button
- Check if message is directly above or below the button
- Check "CTA CONTEXT" section for shipping information near CTA
- If shipping info is in header banner or footer (far from button) → FAIL
- If shipping info is within 50-100px of button → PASS this step

STEP 3 (Check Language - Threshold Language):
- Verify if the message uses "Threshold Language"
- Look for phrases like:
  * "Add $X more for Free Shipping"
  * "Free shipping over $50"
  * "You are $X away from FREE shipping"
  * "Spend $X more to get free shipping"
- Generic messages like "Free shipping available" or "Free shipping on all orders" do NOT count
- Must include specific threshold amount or "add X more" language
- If threshold language is present → PASS this step
- If only generic shipping info → FAIL

STEP 4 (Visual Check - Clear and Readable):
- Verify if the text is clear and easy to read
- Check if text is not more distracting than the main CTA
- Text should be visible but not compete with CTA for attention
- Text should be readable (good font size, contrast)
- If text is too small or hard to read → FAIL
- If text is clear and readable without distracting from CTA → PASS this step

STEP 5 (Final Verdict):
- PASS if ALL 4 steps pass:
  1. CTA button located ✓
  2. Free shipping message within 50-100px of CTA ✓
  3. Threshold language used (e.g., "Add $X more") ✓
  4. Text is clear and readable without distracting from CTA ✓
- FAIL if ANY step fails

EXAMPLES FOR AI TRAINING:

✅ Example 1 - PASS (Good - Threshold Language Near CTA):
Analysis:
- STEP 1: Found "Add to Cart" button in product section
- STEP 2: Free shipping message "You are $12 away from FREE shipping" is placed directly above the Add to Cart button, within 50-100px
- STEP 3: Message uses threshold language ("$12 away from FREE shipping") - specific amount mentioned
- STEP 4: Text is clear, readable, and doesn't distract from the main CTA
- STEP 5: All requirements met

Output: {"passed": true, "reason": "Free shipping threshold message 'You are $12 away from FREE shipping' is displayed directly above the 'Add to Cart' button within 50-100px. The message uses persuasive threshold language with a specific amount and is clear and readable without distracting from the main CTA."}

❌ Example 2 - FAIL (Bad - Only in Header Banner):
Analysis:
- STEP 1: Found "Add to Cart" button in product section
- STEP 2: Free shipping information "Free shipping on orders over $50" is only mentioned in the header banner at the top of the page, far from the CTA button
- STEP 3: Message uses threshold language but location is wrong
- STEP 4: Text is readable but not near CTA
- STEP 5: Proximity requirement failed

Output: {"passed": false, "reason": "Free shipping information 'Free shipping on orders over $50' is only mentioned in the header banner at the top of the page, far from the 'Add to Cart' button. The message must be located within 50-100 pixels of the CTA button (directly above or below) to be in the immediate eye-path and increase Average Order Value."}

❌ Example 3 - FAIL (Bad - Generic Language):
Analysis:
- STEP 1: Found "Add to Cart" button
- STEP 2: Shipping message "Free shipping available" is near the button, within 50-100px
- STEP 3: Message does NOT use threshold language - it's generic ("Free shipping available" instead of "Add $X more for Free Shipping")
- STEP 4: Text is readable
- STEP 5: Language requirement failed

Output: {"passed": false, "reason": "Shipping message 'Free shipping available' is located near the 'Add to Cart' button but does not use threshold language. The message should use persuasive language like 'Add $X more for Free Shipping' or 'You are $X away from FREE shipping' with a specific amount to encourage higher order values."}

✅ Example 4 - PASS (Good - Below CTA with Threshold):
Analysis:
- STEP 1: Found "Add to Cart" button
- STEP 2: Free shipping message "Spend $25 more to get free shipping" is placed directly below the Add to Cart button, within 50-100px
- STEP 3: Message uses threshold language ("Spend $25 more") with specific amount
- STEP 4: Text is clear, readable, and appropriately sized
- STEP 5: All requirements met

Output: {"passed": true, "reason": "Free shipping threshold message 'Spend $25 more to get free shipping' is displayed directly below the 'Add to Cart' button within 50-100px. The message uses persuasive threshold language with a specific amount ($25) and is clear and readable, effectively encouraging higher order values."}

❌ Example 4 - FAIL (Bad - Too Far from CTA):
Analysis:
- STEP 1: Found "Add to Cart" button in product section
- STEP 2: Free shipping message "Free shipping over $50" is in the page footer, more than 100px away from the CTA button
- STEP 3: Message uses threshold language
- STEP 4: Text is readable but location is wrong
- STEP 5: Proximity requirement failed

Output: {"passed": false, "reason": "Free shipping message 'Free shipping over $50' is located in the page footer, more than 100px away from the 'Add to Cart' button. The message must be within 50-100 pixels of the CTA button (directly above or below) to be in the immediate eye-path and effectively increase Average Order Value."}

CRITICAL INSTRUCTIONS:
1. You MUST check ALL 4 steps: Locate CTA → Verify Proximity → Check Language → Visual Check
2. Proximity means within 50-100 pixels, directly above or below the CTA button
3. Threshold language means specific phrases like "Add $X more" or "Free shipping over $X"
4. Generic messages like "Free shipping available" do NOT count as threshold language
5. Message must be in immediate eye-path of CTA, not in header banners or footers
6. If PASSED: Mention proximity (within 50-100px), threshold language used, and location
7. If FAILED: Specify which step failed (proximity, language, or visibility) and suggest exact text to use
8. Do NOT mention currency symbols in the reason unless necessary for clarity
9. Focus on proximity, language, and visibility requirements
10. Suggest specific threshold language if missing (e.g., "Add $X more for Free Shipping")
`
          }

          const prompt = `
URL: ${validUrl}
Content: ${contentForAI}

=== RULE TO CHECK (ONLY THIS RULE) ===
Rule ID: ${rule.id}
Rule Title: ${rule.title}
Rule Description: ${rule.description}

${specialInstructions}

CRITICAL:
You are analyzing ONLY the rule above:
Rule ID: ${rule.id}
Rule Title: "${rule.title}"

Do NOT analyze any other rule.
Do NOT mention or compare with other rules.

IMPORTANT - REASON FORMAT REQUIREMENTS:
- Be SPECIFIC: Mention exact elements found or missing
- Be HUMAN READABLE: Simple, clear language
- Tell WHERE: Specify exact page section (e.g. homepage, product page, below product description, reviews section)
- Tell WHAT: Describe what exists or what is missing (e.g. no video testimonials, only text reviews, promotional video instead of customer testimonial)
- Tell WHY: Explain why this matters FOR VIDEO TESTIMONIALS ONLY
- Be ACTIONABLE: Clearly say what the user should add or fix
- Do NOT mention prices, currency symbols, or amounts
- Do NOT assume things not visible on the page

If PASSED:
- Mention where video testimonials are located
- Mention what makes them valid (real customer, face visible, customer experience shared)
- Mention video type if visible (YouTube embed, Vimeo, self-hosted)

If FAILED:
- Clearly state that no video testimonials were found OR
- State that only text testimonials exist OR
- State that videos exist but are promotional, not customer testimonials
- Mention exact locations where testimonials are missing (homepage, product page, reviews section)

IMPORTANT:
You MUST respond with ONLY valid JSON.
No extra text.
No markdown.
No explanations outside JSON.

Required JSON format (copy exactly, replace values):

{"passed": true, "reason": "brief explanation under 400 characters, specific to video testimonials only"}

OR

{"passed": false, "reason": "brief explanation under 400 characters, specific to video testimonials only"}

Reason must:
1. Be under 400 characters
2. Be accurate to visible content
3. Mention exact locations on the page
4. Be clear and human readable
5. Be actionable (tell what to add or fix)
6. Be relevant ONLY to the rule "${rule.title}" (Rule ID: ${rule.id})
7. Not include currency or prices
8. Not mention any other rules
`;


          // Call OpenRouter API directly with image support
          // Build content array with text and optional image
          // OpenRouter format: content can be string or array of content parts
          let messageContent: string | any[] = prompt
          console.log(messageContent, "messageContent")
          // Add screenshot if available (for AI vision analysis)
          // Always include screenshot for customer photos rule, and other visual rules
          if (screenshotDataUrl && (isCustomerPhotoRule || isCTAProminenceRule || isFreeShippingThresholdRule || isVariantRule)) {
            // Convert screenshot data URL to protocol-relative format if it's a regular URL
            // (data URLs stay as is, but if we had HTTP URLs, convert to //)
            let imageUrl = screenshotDataUrl
            console.log(imageUrl, "imageUrl");
            // If it's not a data URL, convert to protocol-relative
            if (!screenshotDataUrl.startsWith('data:')) {
              imageUrl = toProtocolRelativeUrl(screenshotDataUrl, validUrl)
            }

            // For multimodal content, use array format
            messageContent = [
              {
                type: 'text',
                text: prompt,
              },
              {
                type: 'image_url',
                imageUrl: {
                  url: imageUrl,
                },
              },
            ]
            console.log(`Including screenshot for ${rule.id} rule (visual analysis required)`)


          }



          const chatCompletion = await openRouter.chat.send({
            model: modelName,
            messages: [
              {
                role: "user",
                content: messageContent,
              },
            ],
            temperature: 0.0,
            maxTokens: 256,
            topP: 1.0,
            stream: false,
          });
          const responseTextsss =
            chatCompletion.choices?.[0]?.message?.content?.[0];
          console.log("AI:", responseTextsss);

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
          } else if (isProductTitleRule && !reasonLower.includes('title') && !reasonLower.includes('product name') && !reasonLower.includes('heading')) {
            console.warn(`Warning: Product title rule but reason doesn't mention title: ${analysis.reason.substring(0, 50)}`)
            isRelevant = false
          } else if (isVariantRule) {
            // Variant rule must mention variant/preselect/selected
            const hasVariantMention = reasonLower.includes('variant') || reasonLower.includes('preselect') || reasonLower.includes('selected') || reasonLower.includes('default')
            if (!hasVariantMention) {
              console.warn(`Warning: Variant rule but reason doesn't mention variant/preselect: ${analysis.reason.substring(0, 50)}`)
              isRelevant = false
            }
            // Check if response mentions "Selected Variant:" check
            if (!reasonLower.includes('selected variant') && !reasonLower.includes('preselected')) {
              console.warn(`Warning: Variant rule response should mention checking Selected Variant`)
            }
          } else if (isTrustBadgesRule) {
            // Trust badges rule must mention trust/badge/security/payment/ssl
            const hasTrustMention = reasonLower.includes('trust') || reasonLower.includes('badge') || reasonLower.includes('security') || reasonLower.includes('payment') || reasonLower.includes('ssl') || reasonLower.includes('visa') || reasonLower.includes('paypal') || reasonLower.includes('guarantee')
            if (!hasTrustMention) {
              console.warn(`Warning: Trust badges rule but reason doesn't mention trust/badge/security: ${analysis.reason.substring(0, 50)}`)
              isRelevant = false
            }
            // Check if response mentions proximity (50px) or CTA
            const mentionsProximity = reasonLower.includes('50px') || reasonLower.includes('proximity') || reasonLower.includes('near') || reasonLower.includes('within')
            const mentionsCTA = reasonLower.includes('cta') || reasonLower.includes('add to cart') || reasonLower.includes('checkout') || reasonLower.includes('button')
            if (!mentionsProximity && !mentionsCTA) {
              console.warn(`Warning: Trust badges rule response should mention proximity to CTA`)
            }
          }

          // If reason is not relevant, keep original reason (no prefix)
          if (!isRelevant) {
            // Keep original reason without prefix - just log warning
            console.warn(`Warning: Response may not be fully relevant to rule ${rule.id}, but keeping original reason`)
          }

          // Additional validation: Check if reason mentions other rules (cross-contamination check)
          // Use existing reasonLower variable from line 873
          const currentRuleKeywords = rule.title.toLowerCase().split(' ').filter(w => w.length > 3)
          const otherRuleKeywords = ['breadcrumb', 'lazy loading', 'rating', 'color', 'variant', 'cta', 'shipping', 'discount', 'testimonial', 'comparison', 'benefits', 'title']
          const mentionedOtherRules = otherRuleKeywords.filter(keyword =>
            keyword !== rule.title.toLowerCase() &&
            !currentRuleKeywords.some(ck => keyword.includes(ck) || ck.includes(keyword)) &&
            reasonLower.includes(keyword)
          )

          if (mentionedOtherRules.length > 0 && !currentRuleKeywords.some(ck => reasonLower.includes(ck))) {
            console.warn(`Warning: Rule ${rule.id} reason may be for another rule. Mentioned: ${mentionedOtherRules.join(', ')}`)
            // Don't change the reason, just log - but ensure it's for the right rule
          }

          // Create result object with explicit rule identification
          const result = {
            ruleId: rule.id, // Explicitly use current rule.id
            ruleTitle: rule.title, // Explicitly use current rule.title
            passed: analysis.passed === true,
            reason: analysis.reason || 'No reason provided',
          }

          // Final validation: Ensure result matches the rule being processed
          if (result.ruleId !== rule.id) {
            console.error(`CRITICAL: Result ruleId (${result.ruleId}) does not match current rule (${rule.id})`)
            // Force correct ruleId
            result.ruleId = rule.id
            result.ruleTitle = rule.title
          }

          // Log for debugging rule mixing issues
          console.log(`[Rule ${rule.id}] Result: passed=${result.passed}, reason preview: ${result.reason.substring(0, 50)}...`)

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

      // Wait 300ms between batches (except after last batch) - minimal delay for speed
      if (batchIndex < batches.length - 1) {
        await sleep(300)
      }
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

