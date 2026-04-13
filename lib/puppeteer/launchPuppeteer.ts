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
