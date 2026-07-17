import puppeteerCore from 'puppeteer-core'
import chromium from '@sparticuz/chromium'

export type LaunchedBrowser = Awaited<ReturnType<typeof puppeteerCore.launch>>

/**
 * Launch Chromium for Next.js API routes.
 * - **Vercel:** `@sparticuz/chromium` (serverless has no bundled Chrome).
 * - **Local:** `puppeteer`’s downloaded Chrome, or `CHROME_EXECUTABLE_PATH`.
 */
export async function launchPuppeteerBrowser(options?: {
  windowSizeArg?: string
}): Promise<LaunchedBrowser> {
  const windowSizeArg = options?.windowSizeArg ?? '--window-size=1280,800'

  const baseArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-blink-features=AutomationControlled',
    '--disable-infobars',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--disable-gpu',
    '--disable-translate',
    '--disable-web-security',
    windowSizeArg,
  ]

  if (process.env.VERCEL) {
    chromium.setGraphicsMode = false
    return puppeteerCore.launch({
      // `@sparticuz/chromium` runs chrome-headless-shell on serverless.
      headless: 'shell',
      executablePath: await chromium.executablePath(),
      // Sparticuz-recommended args for AWS/Vercel serverless
      args: [...chromium.args, windowSizeArg, '--disable-web-security'],
    })
  }

  const chromePath = process.env.CHROME_EXECUTABLE_PATH?.trim()
  if (chromePath) {
    return puppeteerCore.launch({
      headless: true,
      executablePath: chromePath,
      args: baseArgs,
    })
  }

  const { default: puppeteer } = await import('puppeteer')
  return puppeteerCore.launch({
    headless: true,
    executablePath: puppeteer.executablePath(),
    args: baseArgs,
  })
}

/**
 * Reuse one Chromium process across requests in the same (warm) server process,
 * launching on first use and relaunching automatically if it has disconnected.
 * Saves the per-scan cold-start. Callers MUST isolate each scan with its own
 * `browser.createBrowserContext()` so cookies/cache/storage never leak between
 * scans — behaviour stays identical to a fresh browser, only startup is skipped.
 */
let sharedBrowserPromise: Promise<LaunchedBrowser> | null = null

export async function getReusableBrowser(options?: {
  windowSizeArg?: string
}): Promise<LaunchedBrowser> {
  if (sharedBrowserPromise) {
    try {
      const existing = await sharedBrowserPromise
      if (existing.connected) return existing
    } catch {
      // Previous launch failed; fall through and relaunch a fresh instance.
    }
    sharedBrowserPromise = null
  }

  const launching = launchPuppeteerBrowser(options)
  sharedBrowserPromise = launching
  try {
    return await launching
  } catch (err) {
    if (sharedBrowserPromise === launching) sharedBrowserPromise = null
    throw err
  }
}

/**
 * Close and forget the shared browser. Call this only after the browser has
 * actually crashed/disconnected so the next scan gets a clean instance.
 */
export async function disposeSharedBrowser(): Promise<void> {
  const pending = sharedBrowserPromise
  sharedBrowserPromise = null
  if (!pending) return
  try {
    const browser = await pending
    await browser.close()
  } catch {
    // Already gone; nothing to clean up.
  }
}
