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
        console.log('Running locally, using default puppeteer')
      }

      console.log('Launching browser...')
      browser = await puppeteer.launch(launchConfig)

      const page = await browser.newPage()

      // Set viewport and user agent
      await page.setViewport({ width: 1920, height: 1080 })
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')

      console.log('Navigating to page...')
      // Navigate to the page
      await page.goto(validUrl, {
        waitUntil: 'load',
        timeout: 30000,
      })

      console.log('Page loaded, waiting for content...')
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
      return NextResponse.json(
        { error: `Failed to capture screenshot: ${error instanceof Error ? error.message : 'Unknown error'}` },
        { status: 500 }
      )
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