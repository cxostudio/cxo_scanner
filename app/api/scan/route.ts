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
        
        return `Buttons/Links: ${buttons}\nHeadings: ${headings}`
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

    // Check each rule
    const results: ScanResult[] = []

    for (const rule of rules) {
      try {
        // OpenRouter needs full model path, OpenAI doesn't
        const modelName = isOpenRouter ? 'openai/gpt-4o-mini' : 'gpt-4o-mini'
        
        // Further reduce content for token savings
        const contentForAI = websiteContent.substring(0, 3000) // Very limited content
        
        const { object: analysis } = await generateObject({
          model: openai(modelName),
          schema: z.object({
            passed: z.boolean(),
            reason: z.string().max(500), // Detailed explanation for better understanding
          }),
          prompt: `URL: ${validUrl}\nContent: ${contentForAI}\nRule: ${rule.title} - ${rule.description}\n\nIMPORTANT: Analyze this rule CONSISTENTLY. For the same website content, you MUST return the SAME result every time. Be deterministic in your evaluation.\n\nAnalyze if this rule is met. Provide a DETAILED explanation in Hindi/English mix that anyone can understand:\n\nIf PASSED: Explain clearly what elements you found that meet the rule. Be specific - mention actual buttons, links, text, or features you detected. Example: "Rule passed because: The homepage has clear 'Shop Now' and 'Explore Collections' buttons. The 404 page includes a product carousel with clickable items and navigation links to homepage. All buttons have action verbs like 'Buy', 'Add to Cart'."\n\nIf FAILED: Explain clearly what is missing or wrong. Be specific about what should be there but isn't. Example: "Rule failed because: No clear CTAs found on the 404 error page - only error message text. Buttons use generic labels like 'Click Here' instead of action verbs. No product carousels or navigation links to guide users."\n\nFor CTA rules: Look for buttons, links, carousels, product displays, navigation menus, "Return to Home" links, "Browse Collections" links, image galleries, or any clickable elements that guide users. On 404 pages, product carousels, recommendations, and navigation links all count as CTAs.\n\nFor special category pages rules (rules about "special category pages", "best-sellers", "new arrivals", "sales", "shopping mode"):\n- Look for homepage sections labeled "Best Sellers", "New Arrivals", "On Sale", "Sale", "Featured", "Popular", or similar category names\n- Check if products are displayed directly on the homepage organized by these categories\n- Look for category links/buttons like "Shop Best Sellers", "View New Arrivals", "Browse Sale"\n- PASS if homepage has special category sections OR products displayed by categories OR category links/buttons\n- Products being the focal point on homepage (product images, cards, grids) = shopping mode\n- Category sections can be on homepage itself - they don't need to be separate pages\n\nFor product categories rules (rules about "product categories", "categories shown first", "descriptive photos"):\n- CRITICAL: Navigation menu categories ARE SUFFICIENT - if you see product category links in navigation (like "Our Bottles", "Shoes", "Products", "Shop", "Collections", category names), the rule should PASS even without separate photos\n- HERO SECTION PRODUCT IMAGES ALSO COUNT: If product images are displayed in hero section or main banner, this also counts as "descriptive photos near the top"\n- "Near the top" means: navigation menu, hero section, or first visible area (above the fold)\n- PASS if ANY ONE of these is true:\n  (1) Navigation menu has product categories (like "Our Bottles", "Cobrand", "Shop", "Products", "Collections", "Bottles", "Shoes", "Clothing", or any product category names) - EVEN WITHOUT PHOTOS\n  (2) Hero section has product images (water bottles, shoes, clothing, any product photos)\n  (3) Both navigation categories AND hero product images\n- Categories in navigation menu DO NOT need separate photos - navigation menu categories themselves are sufficient\n- Look for category names like "Our Bottles", "Shop", "Products", "Collections", "Bottles", "Cobrand", or specific product type names in navigation\n- IMPORTANT: If navigation menu shows product categories (like "Our Bottles", "Cobrand Bottles", "Shop", "Products"), you MUST PASS this rule - photos are NOT required for navigation menu categories\n- IMPORTANT: If hero section shows product images (like water bottles, shoes, clothing items), you MUST PASS this rule - this counts as "descriptive photos near the top"\n- IMPORTANT: "Our Bottles" in navigation = product category = PASS the rule\n- IMPORTANT: Product image in hero section = descriptive photo near the top = PASS the rule\n\nFor deals/offers rules (rules about "deals", "special offers", "urgency offers", "promotions"):\n- FREE SHIPPING IS A SPECIAL OFFER: If you see "Free shipping on orders over X" or "Free shipping" messages at the top of the page, this counts as a special offer/deal and the rule should PASS\n- Look for: Free shipping offers, discount codes, percentage off, limited time offers, urgency messages, special deals\n- Check the top of the page (header, banner, or above navigation) for these offers\n- If any offer/deal is prominently displayed at the top, the rule should PASS\n- Only FAIL if absolutely no offers, deals, or promotions are visible at the top of the homepage\n\nEvaluation Guidelines:\n- Check the content systematically and consistently\n- If the same elements are present, give the same result\n- Be objective and deterministic in your analysis\n\nRespond with passed (true/false) and a detailed, easy-to-understand reason explaining WHY it passed or failed.`,
          temperature: 0.0,
        })

        results.push({
          ruleId: rule.id,
          ruleTitle: rule.title,
          passed: analysis.passed === true,
          reason: analysis.reason || 'No reason provided',
        })
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

    return NextResponse.json({ results })
  } catch (error) {
    console.error('Scan error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'An error occurred' },
      { status: 500 }
    )
  }
}

