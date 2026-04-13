import { NextRequest, NextResponse } from 'next/server'
import { launchPuppeteerBrowser } from '@/lib/puppeteer/launchPuppeteer'

/** Edge runtime cannot run Puppeteer — must be Node. */
export const runtime = 'nodejs'

/** Vercel: allow time for Chromium cold start + navigation + full-page capture. */
export const maxDuration = 60

/**
 * Full-page PNG for the scanned URL. Returns JSON `{ screenshot: data:image/png;base64,... }`
 * so `app/page.tsx` can `res.json()` — not a raw image body.
 */
export async function POST(request: NextRequest) {
  let browser: Awaited<ReturnType<typeof launchPuppeteerBrowser>> | null = null
  try {
    const body = (await request.json().catch(() => ({}))) as { url?: string }
    const raw = typeof body?.url === 'string' ? body.url.trim() : ''
    if (!raw) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 })
    }
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`

    browser = await launchPuppeteerBrowser({ windowSizeArg: '--window-size=1440,900' })
    const page = await browser.newPage()
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    )
    await page.setDefaultNavigationTimeout(55_000)
    await page.setDefaultTimeout(55_000)

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 55_000 })
    } catch {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    }
    await new Promise((r) => setTimeout(r, 800))

    const screenshotBuf = await page.screenshot({ fullPage: true, type: 'png' })
    const base64 = Buffer.from(screenshotBuf).toString('base64')
    const screenshot = `data:image/png;base64,${base64}`

    return NextResponse.json({ screenshot })
  } catch (error) {
    console.error('/api/screenshot error:', error)
    return NextResponse.json(
      {
        error: 'Failed to capture screenshot',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    )
  } finally {
    if (browser) {
      await browser.close().catch(() => undefined)
    }
  }
}
