import puppeteer from 'puppeteer-core'
import chromium from '@sparticuz/chromium'
import { execSync } from 'child_process'

export interface BrowserContext {
  browser: any
  page: any
}

export interface ScreenshotResult {
  screenshotDataUrl: string | null
  earlyScreenshot: string | null
  fullVisibleText: string
  keyElements: string
}

// Helper to find Chrome executable on local machine
function findChromeExecutable(): string | null {
  const platform = process.platform

  try {
    if (platform === 'win32') {
      // Windows - try common Chrome paths
      const paths = [
        process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
        process.env.PROGRAMFILES + '\\Google\\Chrome\\Application\\chrome.exe',
        process.env['PROGRAMFILES(X86)'] + '\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      ]
      for (const path of paths) {
        try {
          if (path && require('fs').existsSync(path)) {
            return path
          }
        } catch (e) {
          // Continue to next path
        }
      }
    } else if (platform === 'darwin') {
      // macOS
      return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    } else {
      // Linux - try to find chrome/chromium
      try {
        return execSync('which google-chrome || which chromium-browser || which chromium').toString().trim()
      } catch (e) {
        return null
      }
    }
  } catch (e) {
    console.warn('Failed to find Chrome executable:', e)
  }

  return null
}

export async function launchBrowser(): Promise<BrowserContext> {
  const isVercel = !!process.env.VERCEL

  const launchConfig: any = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  }

  if (isVercel) {
    // Vercel environment - use @sparticuz/chromium
    launchConfig.executablePath = await chromium.executablePath()
    launchConfig.args = [
      ...launchConfig.args,
      '--single-process',
      '--font-render-hinting=medium',
    ]
  } else {
    // Local development - find Chrome or use env variable
    const chromePath = process.env.PUPPETEER_EXECUTABLE_PATH || findChromeExecutable()

    if (chromePath) {
      launchConfig.executablePath = chromePath
      console.log('Using Chrome executable:', chromePath)
    } else {
      // Fallback: try to use puppeteer without specifying path (will download Chromium)
      console.warn('No Chrome executable found. Please set PUPPETEER_EXECUTABLE_PATH environment variable.')
      console.warn('Example: PUPPETEER_EXECUTABLE_PATH="C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"')
      throw new Error(
        'Chrome executable not found. Please install Chrome or set PUPPETEER_EXECUTABLE_PATH environment variable.'
      )
    }
  }

  const browser = await puppeteer.launch(launchConfig)
  const page = await browser.newPage()

  await page.setViewport({ width: 1920, height: 1080 })

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

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] })
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] })
    const ua = navigator.userAgent.replace(/headless/gi, '')
    Object.defineProperty(navigator, 'userAgent', { get: () => ua })
  })

  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')

  return { browser, page }
}

export async function navigateToPage(page: any, url: string): Promise<void> {
  // Try multiple navigation strategies with increasing timeouts
  const strategies = [
    { waitUntil: 'domcontentloaded', timeout: 45000 }, // Fastest - just wait for DOM
    { waitUntil: 'networkidle0', timeout: 60000 },     // Wait for no network activity
    { waitUntil: 'load', timeout: 60000 },             // Wait for full load
  ]

  let lastError: Error | null = null

  for (const strategy of strategies) {
    try {
      console.log(`Trying navigation with waitUntil: ${strategy.waitUntil}, timeout: ${strategy.timeout}ms`)
      const response = await page.goto(url, {
        waitUntil: strategy.waitUntil as any,
        timeout: strategy.timeout,
      })

      // Check if we got redirected to Google or error page
      const currentUrl = page.url()
      if (currentUrl.includes('google.com') || currentUrl.includes('captcha') || !response) {
        console.warn(`Redirected to Google/Captcha or no response with ${strategy.waitUntil}, trying next strategy...`)
        continue
      }

      console.log(`Navigation successful with ${strategy.waitUntil}`)
      await new Promise(resolve => setTimeout(resolve, 1000))
      return
    } catch (error) {
      lastError = error as Error
      console.warn(`Navigation failed with ${strategy.waitUntil}:`, (error as Error).message)

      // If it's a timeout, try next strategy
      if ((error as Error).message.includes('timeout')) {
        continue
      }

      // For other errors, throw immediately
      throw error
    }
  }

  // If all strategies failed, throw the last error
  if (lastError) {
    throw new Error(`All navigation strategies failed. Last error: ${lastError.message}`)
  }
}

export async function waitForImages(page: any): Promise<void> {
  console.log('Waiting for images to load...')
  try {
    await Promise.race([
      page.evaluate(async () => {
        const images = Array.from(document.querySelectorAll('img')).slice(0, 15)
        const imagePromises = images.map((img) => {
          if (img.complete) return Promise.resolve()
          return new Promise((resolve) => {
            img.onload = resolve
            img.onerror = resolve
            setTimeout(resolve, 2000)
          })
        })
        await Promise.all(imagePromises)
      }),
      new Promise(resolve => setTimeout(resolve, 8000))
    ])
  } catch (e) {
    console.warn('Image loading timeout, proceeding with screenshot')
  }
}

export async function scrollPage(page: any, url: string): Promise<void> {
  try {
    const scrollHeight = await page.evaluate(() => document.body.scrollHeight)
    const viewportHeight = await page.evaluate(() => window.innerHeight)
    if (scrollHeight > viewportHeight) {
      console.log(`Scrolling to trigger lazy loading. Page height: ${scrollHeight}`)
      const steps = 5
      for (let i = 0; i <= steps; i++) {
        await page.evaluate((step: number, totalSteps: number, height: number) => {
          window.scrollTo(0, (step / totalSteps) * height)
        }, i, steps, scrollHeight)
        await new Promise(resolve => setTimeout(resolve, 500))
      }
      await page.evaluate(() => window.scrollTo(0, 0))
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  } catch (e) {
    console.warn('Scroll failed, proceeding with screenshot')
  }

  // Extra wait for Amazon
  if (url.includes('amazon.')) {
    console.log('Amazon detected, waiting extra for lazy-loaded images...')
    await new Promise(resolve => setTimeout(resolve, 3000))
    try {
      await page.evaluate(() => {
        document.querySelectorAll('img[data-src], img[data-lazy], img[lazy]').forEach((img: any) => {
          if (img.dataset.src) img.src = img.dataset.src
          if (img.dataset.lazy) img.src = img.dataset.lazy
          img.loading = 'eager'
        })
      })
      await new Promise(resolve => setTimeout(resolve, 2000))
    } catch (e) {
      console.warn('Failed to force load images')
    }
  }
}

export async function captureScreenshot(page: any): Promise<string | null> {
  try {
    console.log('Capturing screenshot...')
    const screenshotBuffer = await page.screenshot({
      type: 'jpeg',
      fullPage: true,
      encoding: 'base64',
      quality: 75,
    }) as string
    return `data:image/jpeg;base64,${screenshotBuffer}`
  } catch (error) {
    console.warn('Failed to capture screenshot:', error)
    return null
  }
}

export async function getPageContent(page: any): Promise<string> {
  return await page.evaluate(() => {
    return document.body.innerText || document.body.textContent || ''
  })
}

export async function getKeyElements(page: any): Promise<string> {
  return await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button, a[href], [role="button"]'))
      .map(el => el.textContent?.trim() || el.getAttribute('href') || el.getAttribute('aria-label') || '')
      .filter(text => text.length > 0)
      .sort()
      .slice(0, 30)
      .join(' | ')

    const headings = Array.from(document.querySelectorAll('h1, h2, h3'))
      .map(h => h.textContent?.trim())
      .filter(text => text && text.length > 0)
      .sort()
      .slice(0, 15)
      .join(' | ')

    return `Buttons/Links: ${buttons}\nHeadings: ${headings}`
  })
}

export async function closeBrowser(browser: any): Promise<void> {
  if (browser) {
    await browser.close()
  }
}
