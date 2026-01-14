import { NextRequest, NextResponse } from 'next/server'
import { createOpenAI } from '@ai-sdk/openai'
import { generateObject } from 'ai'
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
    // OpenRouter uses different base URL
    const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { error: 'API key is not configured. Please set OPENROUTER_API_KEY or OPENAI_API_KEY in .env.local file' },
        { status: 500 }
      )
    }

    // Check if it's OpenRouter API key (starts with sk-or-v1)
    const isOpenRouter = apiKey.startsWith('sk-or-v1')
    
    // Validate API key format
    if (!isOpenRouter && !apiKey.startsWith('sk-')) {
      return NextResponse.json(
        { error: 'Invalid API key format. Please check your API key configuration.' },
        { status: 500 }
      )
    }
    
    const openai = createOpenAI({
      apiKey: apiKey,
      baseURL: isOpenRouter ? 'https://openrouter.ai/api/v1' : undefined,
      // OpenRouter requires HTTP-Referer header
      headers: isOpenRouter ? {
        'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER || 'https://localhost:3000',
        'X-Title': 'Website Rule Checker',
      } : undefined,
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
    
    // Process each batch sequentially
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex]
      console.log(`Processing batch ${batchIndex + 1}/${batches.length} with ${batch.length} rules`)
      
      // Process rules in current batch
      for (const rule of batch) {
        try {
          // OpenRouter needs full model path, OpenAI doesn't
          // Using gpt-4o-mini-search-preview for scanning (as per user requirement)
          const modelName = isOpenRouter ? 'openai/gpt-4o-mini-search-preview' : 'gpt-4o-mini'
          
          // Further reduce content for token savings
          const contentForAI = websiteContent.substring(0, 3000) // Very limited content
          
          const { object: analysis } = await generateObject({
            model: openai(modelName),
            schema: z.object({
              passed: z.boolean(),
              reason: z.string().max(500), // Detailed explanation for better understanding
            }),
            prompt: `URL: ${validUrl}\nContent: ${contentForAI}\nRule: ${rule.title} - ${rule.description}\n\nIMPORTANT: Analyze this rule CONSISTENTLY. For the same website content, you MUST return the SAME result every time. Be deterministic in your evaluation.\n\nThe content includes a "--- KEY ELEMENTS ---" section with pre-extracted information. Use ONLY the relevant parts for this specific rule.\n\n${rule.title.toLowerCase().includes('breadcrumb') || rule.description.toLowerCase().includes('breadcrumb') ? `\n*** THIS IS A BREADCRUMB RULE - SPECIAL INSTRUCTIONS ***\n\nCRITICAL FOR BREADCRUMB RULES:\n1. ALWAYS check the "--- KEY ELEMENTS ---" section FIRST - this is MANDATORY\n2. Look for the line that starts with "Breadcrumbs:" in KEY ELEMENTS\n3. READ THE BREADCRUMBS LINE CAREFULLY:\n   - If it says "Breadcrumbs: Not found" → Rule FAILS\n   - If it says "Breadcrumbs: [any text]" where [any text] is NOT "Not found" → Rule PASSES\n4. Breadcrumbs can be in ANY format - ALL are valid:\n   - "Home / Category / Page"\n   - "1. Home 2. / mens 3. / New Arrivals"\n   - "Home > Category > Page"\n   - "1. Home 2. / mens 3. / New Arrivals" (numbered format)\n   - Any text showing navigation path with "Home" and "/" or numbers\n5. EXAMPLES OF VALID BREADCRUMBS (all should PASS):\n   - "Breadcrumbs: 1. Home 2. / mens 3. / New Arrivals" → PASS ✅\n   - "Breadcrumbs: Home / mens / New Arrivals" → PASS ✅\n   - "Breadcrumbs: Home > Category > Page" → PASS ✅\n   - "Breadcrumbs: 1. Home 2. / mens" → PASS ✅\n6. ONLY FAIL if KEY ELEMENTS shows "Breadcrumbs: Not found"\n7. Breadcrumbs don't need to be clickable - visible breadcrumb trail is sufficient\n8. Numbered format like "1. Home 2. / mens 3. / New Arrivals" IS VALID and should PASS\n9. If you see ANY text after "Breadcrumbs:" that is NOT "Not found", the rule MUST PASS\n\nDECISION LOGIC:\n- Step 1: Find "Breadcrumbs:" line in KEY ELEMENTS\n- Step 2: Read what comes after "Breadcrumbs:"\n- Step 3: If it's "Not found" → passed: false\n- Step 4: If it's ANYTHING ELSE (even partial text) → passed: true\n\nIf breadcrumbs are found in KEY ELEMENTS section (shows anything other than "Not found"), respond with passed: true and explain what breadcrumbs were found.\nIf breadcrumbs are NOT found (shows "Not found"), respond with passed: false and explain that breadcrumbs are missing.\n\n` : rule.title.toLowerCase().includes('color') || rule.title.toLowerCase().includes('black') || rule.description.toLowerCase().includes('color') || rule.description.toLowerCase().includes('#000000') || rule.description.toLowerCase().includes('pure black') ? `\n*** THIS IS A COLOR RULE - SPECIAL INSTRUCTIONS ***\n\nCRITICAL FOR COLOR RULES:\n1. ALWAYS check the "--- KEY ELEMENTS ---" section FIRST\n2. Look for the "Colors found:" and "Pure black (#000000) detected:" lines in KEY ELEMENTS\n3. If KEY ELEMENTS shows "Pure black (#000000) detected: NO", the rule MUST PASS (site is not using pure black)\n4. If KEY ELEMENTS shows "Pure black (#000000) detected: YES", the rule MUST FAIL (site is using pure black)\n5. If color information is not available, check the visible content for color codes like #000000, rgb(0,0,0), or "black"\n6. The rule requires avoiding pure black (#000000) - if no pure black is detected, the rule PASSES\n7. Softer dark tones like #333333, #121212, #212121 are acceptable and should PASS\n\nIf pure black is NOT detected, respond with passed: true and explain that the site uses softer tones or no pure black.\nIf pure black IS detected, respond with passed: false and explain where pure black is being used.\n\n` : rule.title.toLowerCase().includes('lazy') || rule.description.toLowerCase().includes('lazy') || rule.description.toLowerCase().includes('lazy loading') ? `\n*** THIS IS A LAZY LOADING RULE - SPECIAL INSTRUCTIONS ***\n\nCRITICAL FOR LAZY LOADING RULES:\n1. ALWAYS check the "--- KEY ELEMENTS ---" section FIRST - this is MANDATORY\n2. Look for lines starting with "Images (below-fold):", "Videos (below-fold):", "Lazy loading status:" in KEY ELEMENTS\n3. READ THE LAZY LOADING INFORMATION CAREFULLY:\n   - If KEY ELEMENTS shows "Lazy loading status: PASS - All below-fold images/videos have lazy loading" → Rule PASSES ✅\n   - If KEY ELEMENTS shows "Lazy loading status: FAIL - Some below-fold images/videos missing lazy loading" → Rule FAILS ❌\n   - If KEY ELEMENTS shows "Lazy loading: No below-fold images or videos found" → Rule PASSES ✅ (nothing to lazy load)\n4. IMPORTANT: Above-fold images/videos should NOT have lazy loading (they must load immediately)\n5. Only below-fold (not visible initially) images/videos need lazy loading\n6. Check the "Images without lazy loading:" and "Videos without lazy loading:" lines for specific hints\n7. Lazy loading can be implemented via:\n   - loading="lazy" attribute\n   - data-lazy attribute\n   - .lazy CSS class\n   - JavaScript lazy loading libraries\n8. If KEY ELEMENTS shows specific images/videos without lazy loading, mention them in your reason\n\nDECISION LOGIC:\n- Step 1: Find "Lazy loading status:" line in KEY ELEMENTS\n- Step 2: If it says "PASS" → passed: true\n- Step 3: If it says "FAIL" → passed: false\n- Step 4: If it says "No below-fold images or videos found" → passed: true\n- Step 5: If specific images/videos are listed without lazy loading, mention them in the reason\n\nIf lazy loading is properly implemented (all below-fold images/videos have lazy loading), respond with passed: true and explain.\nIf some images/videos are missing lazy loading, respond with passed: false and list which images/videos are missing lazy loading (use the hints from KEY ELEMENTS).\n\n` : `\nALWAYS check the KEY ELEMENTS section FIRST before analyzing. Use it only if relevant to the current rule.\n\n`}\nAnalyze if this rule is met. Provide a DETAILED explanation in Hindi/English mix that anyone can understand:\n\nIf PASSED: Explain clearly what elements you found that meet the rule. Be specific - mention actual elements relevant to the rule. Do NOT mention elements that are not related to this rule.\n\nIf FAILED: Explain clearly what is missing or wrong. Be specific about what should be there but isn't. Do NOT mention elements that are not related to this rule.\n\nSPECIFIC RULE GUIDELINES:\n\n1. BREADCRUMB RULES (ONLY if rule title/description mentions "breadcrumb"):\n- CRITICAL: Check "Breadcrumbs:" in KEY ELEMENTS section FIRST. If breadcrumbs are found (showing navigation path like "Home / Category / Page" or "1. Home 2. / mens 3. / New Arrivals" or similar), the rule MUST PASS.\n- Breadcrumbs can be in various formats:\n  * Text format: "Home / Category / Page"\n  * Numbered format: "1. Home 2. / Category 3. / Page" or "1. Home 2. / mens 3. / New Arrivals"\n  * Link format: Clickable breadcrumb links\n  * Any visible breadcrumb trail showing site hierarchy\n- PASS if breadcrumbs are visible in KEY ELEMENTS section, even if format is slightly different\n- Breadcrumbs don't need to be clickable - visible breadcrumb trail is sufficient\n- Look for patterns like: "Home", "/", category names, page names in sequence\n- If you see "Home / mens / New Arrivals" or "1. Home 2. / mens 3. / New Arrivals" in KEY ELEMENTS, the rule PASSES\n- Examples that should PASS: "Home / mens / New Arrivals", "1. Home 2. / mens 3. / New Arrivals", "Home > Category > Page"\n- IMPORTANT: Numbered format "1. Home 2. / mens 3. / New Arrivals" IS A VALID BREADCRUMB and should PASS\n- IMPORTANT: If KEY ELEMENTS shows "Breadcrumbs: 1. Home 2. / mens 3. / New Arrivals", the rule MUST PASS\n- IMPORTANT: If KEY ELEMENTS shows "Breadcrumbs: Not found", the rule MUST FAIL\n\n2. COLOR RULES (ONLY if rule mentions colors, black, backgrounds, text colors, #000000, pure black):\n- CRITICAL: Check "Colors found:" and "Pure black (#000000) detected:" in KEY ELEMENTS section FIRST\n- If KEY ELEMENTS shows "Pure black (#000000) detected: NO", the rule MUST PASS (site is not using pure black)\n- If KEY ELEMENTS shows "Pure black (#000000) detected: YES", the rule MUST FAIL (site is using pure black)\n- The rule requires avoiding pure black (#000000) - if no pure black is detected, the rule PASSES\n- Softer dark tones like #333333, #121212, #212121 are acceptable and should PASS\n- If color information shows colors like #333333, #121212, #212121, or any color other than #000000, the rule PASSES\n- Do NOT mention breadcrumbs, images, or other unrelated elements\n- IMPORTANT: If no pure black is detected, the rule MUST PASS - do not fail just because color info is limited\n\n3. CTA RULES: Look for buttons, links, carousels, product displays, navigation menus, "Return to Home" links, "Browse Collections" links, image galleries, or any clickable elements that guide users. On 404 pages, product carousels, recommendations, and navigation links all count as CTAs.\n\nFor special category pages rules (rules about "special category pages", "best-sellers", "new arrivals", "sales", "shopping mode"):\n- Look for homepage sections labeled "Best Sellers", "New Arrivals", "On Sale", "Sale", "Featured", "Popular", or similar category names\n- Check if products are displayed directly on the homepage organized by these categories\n- Look for category links/buttons like "Shop Best Sellers", "View New Arrivals", "Browse Sale"\n- PASS if homepage has special category sections OR products displayed by categories OR category links/buttons\n- Products being the focal point on homepage (product images, cards, grids) = shopping mode\n- Category sections can be on homepage itself - they don't need to be separate pages\n\nFor product categories rules (rules about "product categories", "categories shown first", "descriptive photos"):\n- CRITICAL: Navigation menu categories ARE SUFFICIENT - if you see product category links in navigation (like "Our Bottles", "Shoes", "Products", "Shop", "Collections", category names), the rule should PASS even without separate photos\n- HERO SECTION PRODUCT IMAGES ALSO COUNT: If product images are displayed in hero section or main banner, this also counts as "descriptive photos near the top"\n- "Near the top" means: navigation menu, hero section, or first visible area (above the fold)\n- PASS if ANY ONE of these is true:\n  (1) Navigation menu has product categories (like "Our Bottles", "Cobrand", "Shop", "Products", "Collections", "Bottles", "Shoes", "Clothing", or any product category names) - EVEN WITHOUT PHOTOS\n  (2) Hero section has product images (water bottles, shoes, clothing, any product photos)\n  (3) Both navigation categories AND hero product images\n- Categories in navigation menu DO NOT need separate photos - navigation menu categories themselves are sufficient\n- Look for category names like "Our Bottles", "Shop", "Products", "Collections", "Bottles", "Cobrand", or specific product type names in navigation\n- IMPORTANT: If navigation menu shows product categories (like "Our Bottles", "Cobrand Bottles", "Shop", "Products"), you MUST PASS this rule - photos are NOT required for navigation menu categories\n- IMPORTANT: If hero section shows product images (like water bottles, shoes, clothing items), you MUST PASS this rule - this counts as "descriptive photos near the top"\n- IMPORTANT: "Our Bottles" in navigation = product category = PASS the rule\n- IMPORTANT: Product image in hero section = descriptive photo near the top = PASS the rule\n\nFor deals/offers rules (rules about "deals", "special offers", "urgency offers", "promotions"):\n- FREE SHIPPING IS A SPECIAL OFFER: If you see "Free shipping on orders over X" or "Free shipping" messages at the top of the page, this counts as a special offer/deal and the rule should PASS\n- Look for: Free shipping offers, discount codes, percentage off, limited time offers, urgency messages, special deals\n- Check the top of the page (header, banner, or above navigation) for these offers\n- If any offer/deal is prominently displayed at the top, the rule should PASS\n- Only FAIL if absolutely no offers, deals, or promotions are visible at the top of the homepage\n\nEvaluation Guidelines:\n- Check the content systematically and consistently\n- If the same elements are present, give the same result\n- Be objective and deterministic in your analysis\n\nRespond with passed (true/false) and a detailed, easy-to-understand reason explaining WHY it passed or failed.`,
            temperature: 0.0,
          })

          const result = {
            ruleId: rule.id,
            ruleTitle: rule.title,
            passed: analysis.passed === true,
            reason: analysis.reason || 'No reason provided',
          }
          
          results.push(result)

          // Save training data automatically
          try {
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
          } catch (trainingError) {
            console.error('Error saving training data:', trainingError)
          }
        } catch (error) {
          let errorMessage = 'Unknown error occurred'
          
          if (error instanceof Error) {
            errorMessage = error.message
            
            // Handle token limit errors specifically
            if (errorMessage.includes('credits') || errorMessage.includes('tokens') || errorMessage.includes('max_tokens')) {
              errorMessage = `Token limit exceeded. You have limited API credits (6415 tokens available). Please: 1) Scan only 1 rule at a time, 2) Upgrade your API credits at https://openrouter.ai/settings/credits, or 3) Use OpenAI API key directly for more tokens.`
            } else if (errorMessage.includes('rate limit')) {
              errorMessage = 'Rate limit exceeded. Please wait a moment and try again.'
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

