import { NextRequest, NextResponse } from 'next/server'
import puppeteer from 'puppeteer-core'
import chromium from '@sparticuz/chromium'

export async function POST(request: NextRequest) {
  try {
    console.log('Screenshot API called')

    const body = await request.json()
    const { url } = body

    if (!url) {
      console.error('No URL provided')
      return NextResponse.json(
        { error: 'URL is required' },
        { status: 400 }
      )
    }

    // Normalize URL
    let validUrl = url.trim()
    if (!validUrl.startsWith('http://') && !validUrl.startsWith('https://')) {
      validUrl = 'https://' + validUrl
    }

    console.log('Taking screenshot for URL:', validUrl)

    let browser
    let screenshotDataUrl: string | null = null

    try {
      // Check if running on Vercel
      const isVercel = !!process.env.VERCEL

      const launchConfig: any = {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      }

      if (isVercel) {
        console.log('Running on Vercel, using chromium executable')
        launchConfig.executablePath = await chromium.executablePath()
        launchConfig.args = [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu'
        ]
      } else {
        console.log('Running locally, trying to find Chrome/Chromium...')
        // Try to find Chrome on Windows
        const possiblePaths = [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
          process.env.PROGRAMFILES + '\\Google\\Chrome\\Application\\chrome.exe',
        ].filter(Boolean)

        let chromePath = null
        for (const path of possiblePaths) {
          try {
            const fs = await import('fs')
            if (fs.existsSync(path)) {
              chromePath = path
              console.log('Found Chrome at:', path)
              break
            }
          } catch (e) {
            // Ignore
          }
        }

        if (chromePath) {
          launchConfig.executablePath = chromePath
        } else {
          console.warn('Chrome not found locally, screenshot will be skipped')
          // Return empty response - frontend will handle gracefully
          return NextResponse.json({
            screenshot: null,
            message: 'Screenshot not available in local development - Chrome not found'
          })
        }
      }

      console.log('Launching browser...')
      browser = await puppeteer.launch(launchConfig)

      const page = await browser.newPage()

      // Set viewport
      await page.setViewport({ width: 1920, height: 1080 })

      // Set extra headers to avoid detection
      await page.setExtraHTTPHeaders({
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
      })

      // Override navigator.webdriver to avoid detection
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
        })
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5],
        })
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en'],
        })
        // Remove headless from user agent
        const ua = navigator.userAgent.replace(/headless/gi, '')
        Object.defineProperty(navigator, 'userAgent', {
          get: () => ua,
        })
      })

      // Set user agent after page creation
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')

      console.log('Navigating to page...')

      // Intercept and block certain redirects (like to Google)
      await page.setRequestInterception(true)
      page.on('request', (req) => {
        const url = req.url()
        // Block common tracking/analytics that might cause redirects
        if (url.includes('google.com') && !url.includes(validUrl)) {
          console.log('Blocking request to:', url)
          req.abort()
        } else {
          req.continue()
        }
      })

      // Navigate to the page
      const response = await page.goto(validUrl, {
        waitUntil: 'networkidle2',
        timeout: 30000,
      })

      // Check if we got redirected to Google or error page
      const currentUrl = page.url()
      if (currentUrl.includes('google.com') || currentUrl.includes('captcha')) {
        console.warn('Redirected to Google/Captcha, trying alternative approach...')
        // Try again with different approach
        await page.goto(validUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        })
      }

      console.log('Page loaded, waiting for content...')

      // Extra wait for Amazon and lazy-loaded images
      const isAmazon = validUrl.includes('amazon.')
      if (isAmazon) {
        console.log('Amazon detected, waiting extra for images...')
        await new Promise(resolve => setTimeout(resolve, 3000))

        // Scroll to trigger lazy loading
        try {
          const scrollHeight = await page.evaluate(() => document.body.scrollHeight)
          for (let i = 0; i <= 5; i++) {
            await page.evaluate((step, height) => {
              window.scrollTo(0, (step / 5) * height)
            }, i, scrollHeight)
            await new Promise(resolve => setTimeout(resolve, 500))
          }
          await page.evaluate(() => window.scrollTo(0, 0))
          await new Promise(resolve => setTimeout(resolve, 2000))
        } catch (e) {
          console.warn('Amazon scroll failed')
        }
      }

      // Wait a bit for any dynamic content
      await new Promise(resolve => setTimeout(resolve, 2000))

      console.log('Taking screenshot...')
      // Take screenshot
      const screenshot = await page.screenshot({
        type: 'jpeg',
        fullPage: true,
        encoding: 'base64',
        quality: 75,
      }) as string

      screenshotDataUrl = `data:image/jpeg;base64,${screenshot}`
      console.log('Screenshot captured successfully, length:', screenshotDataUrl.length)

    } catch (error) {
      console.error('Screenshot error:', error)
      // Return null instead of 500 error - frontend will handle gracefully
      return NextResponse.json({
        screenshot: null,
        message: `Screenshot failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      })
    } finally {
      if (browser) {
        console.log('Closing browser...')
        await browser.close()
      }
    }

    return NextResponse.json({
      screenshot: screenshotDataUrl
    })

  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'An error occurred' },
      { status: 500 }
    )
  }
}
