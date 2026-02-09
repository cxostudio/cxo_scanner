import { NextRequest, NextResponse } from 'next/server'
import puppeteer from 'puppeteer-core'
import chromium from '@sparticuz/chromium'

// Lightweight screenshot endpoint, separated from the heavy /api/scan logic.
// Goal: reliably capture a single full-page screenshot for UI preview (even on Vercel),
// without running rule analysis or AI calls.

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const rawUrl = typeof body?.url === 'string' ? body.url.trim() : ''

    if (!rawUrl) {
      return NextResponse.json(
        { error: 'URL is required', screenshot: null },
        { status: 400 },
      )
    }

    // Normalize URL (ensure protocol)
    let validUrl = rawUrl
    if (!validUrl.startsWith('http://') && !validUrl.startsWith('https://')) {
      validUrl = 'https://' + validUrl
    }

    // Basic safety: avoid internal URLs
    try {
      const parsed = new URL(validUrl)
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return NextResponse.json(
          { error: 'Only HTTP/HTTPS URLs are supported', screenshot: null },
          { status: 400 },
        )
      }
    } catch {
      return NextResponse.json(
        { error: 'Invalid URL format', screenshot: null },
        { status: 400 },
      )
    }

    const isVercel = !!process.env.VERCEL

    const launchConfig: any = {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }

    if (isVercel) {
      launchConfig.executablePath = await chromium.executablePath()
      launchConfig.args = [
        ...launchConfig.args,
        '--single-process',
        '--font-render-hinting=medium',
      ]
    }

    let browser: puppeteer.Browser | null = null

    try {
      browser = await puppeteer.launch(launchConfig)
      const page = await browser.newPage()

      await page.setViewport({ width: 1280, height: 720 })
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      )

      // Navigate with modest timeout (shorter than /api/scan to stay within limits)
      await page.goto(validUrl, {
        waitUntil: 'load',
        timeout: 25000,
      })

      // Small wait for above-the-fold content
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // Capture one full-page JPEG screenshot as base64
      const screenshotBuffer = (await page.screenshot({
        type: 'jpeg',
        fullPage: true,
        encoding: 'base64',
        quality: 75,
      })) as string

      const screenshotDataUrl = `data:image/jpeg;base64,${screenshotBuffer}`

      return NextResponse.json({
        screenshot: screenshotDataUrl,
      })
    } catch (error) {
      console.error('Screenshot API error:', error)
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : 'Failed to capture screenshot',
          screenshot: null,
        },
        { status: 500 },
      )
    } finally {
      if (browser) {
        try {
          await browser.close()
        } catch {
          // ignore
        }
      }
    }
  } catch (error) {
    console.error('Screenshot API top-level error:', error)
    return NextResponse.json(
      { error: 'Invalid request body', screenshot: null },
      { status: 400 },
    )
  }
}

