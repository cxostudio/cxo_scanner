import type { Page } from 'puppeteer-core'
import { NextRequest } from 'next/server'
import { launchPuppeteerBrowser } from '@/lib/puppeteer/launchPuppeteer'

export interface AnalyzeWebsiteStreamBody {
  url: string
}

const QUADRANT_LABELS = ['Top', 'Upper middle', 'Lower middle', 'Bottom'] as const

/** Ecommerce sites rarely reach networkidle; domcontentloaded + settle is reliable for previews. */
const PREVIEW_GOTO_TIMEOUT_MS = 60_000
const PREVIEW_GOTO_RETRY_MS = 45_000
/** Shorter than before so first desktop preview reaches the client sooner (tradeoff: rare mid-paint captures). */
const READY_COMPLETE_WAIT_MS = 8_000
const POST_NAV_SETTLE_MS = 1_100

/**
 * Navigate for screenshot capture: prefer domcontentloaded (fast), wait for load where possible,
 * then allow JS/layout to settle (Spacegoods-class Shopify apps).
 */
async function gotoForPreview(page: Page, targetUrl: string): Promise<void> {
  const runGoto = (timeout: number) =>
    page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout })

  try {
    await runGoto(PREVIEW_GOTO_TIMEOUT_MS)
  } catch (err) {
    console.warn('[analyzeWebsiteStream] navigation failed, retrying domcontentloaded:', err)
    await runGoto(PREVIEW_GOTO_RETRY_MS)
  }

  try {
    await page.waitForFunction(() => document.readyState === 'complete', {
      timeout: READY_COMPLETE_WAIT_MS,
    })
  } catch {
    // Many storefronts never reach "complete" due to analytics / long-polling.
  }

  await new Promise((r) => setTimeout(r, POST_NAV_SETTLE_MS))
}

function ndjsonResponse(stream: ReadableStream<Uint8Array>) {
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

/**
 * NDJSON stream: desktop/mobile preview frames, then quadrant screenshots + metadata.
 * Used by POST /api/preview_website and by POST /api/analyze_image with `stream: true`.
 */
export async function analyzeWebsiteStream(request: NextRequest): Promise<Response> {
  let body: AnalyzeWebsiteStreamBody
  try {
    body = (await request.json()) as AnalyzeWebsiteStreamBody
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { url } = body
  if (!url) {
    return new Response(JSON.stringify({ error: 'URL is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const encoder = new TextEncoder()
  const send = (controller: ReadableStreamDefaultController<Uint8Array>, obj: unknown) => {
    controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`))
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let browser: Awaited<ReturnType<typeof launchPuppeteerBrowser>> | null = null
      try {
        // First NDJSON chunk ASAP so the client can show URL / favicon strategy before Puppeteer cold start.
        send(controller, { type: 'meta', url })

        browser = await launchPuppeteerBrowser({ windowSizeArg: '--window-size=1280,800' })
        const page = await browser.newPage()

        await page.evaluateOnNewDocument(() => {
          Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true })
        })

        await page.setDefaultNavigationTimeout(90_000)
        await page.setDefaultTimeout(90_000)
        await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 })

        await page.setExtraHTTPHeaders({
          'Accept-Language': 'en-GB,en;q=0.9',
        })
        await page.setUserAgent(
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        )

        await gotoForPreview(page, url)

        // Ensure desktop preview is above-the-fold (same as fresh mobile tab). Some sites
        // restore scroll or paint mid-page before first capture without this.
        await page.evaluate(() => {
          window.scrollTo(0, 0)
          document.documentElement.scrollTop = 0
          document.body.scrollTop = 0
        })
        await new Promise((r) => setTimeout(r, 100))

        const desktopB64 = (await page.screenshot({
          type: 'jpeg',
          quality: 82,
          encoding: 'base64',
          fullPage: false,
        })) as string

        let desktopDataUrl = `data:image/jpeg;base64,${desktopB64}`
        send(controller, {
          type: 'preview',
          previewDesktop: desktopDataUrl,
        })

        let mobileDataUrl = desktopDataUrl
        let mobilePage: Awaited<ReturnType<typeof browser.newPage>> | null = null
        try {
          mobilePage = await browser.newPage()
          await mobilePage.setViewport({
            width: 390,
            height: 844,
            deviceScaleFactor: 2,
            isMobile: true,
            hasTouch: true,
          })
          await mobilePage.setUserAgent(
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
          )
          await mobilePage.setExtraHTTPHeaders({
            'Accept-Language': 'en-GB,en;q=0.9',
          })
          await mobilePage.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true })
          })
          await mobilePage.setDefaultNavigationTimeout(90_000)
          await mobilePage.setDefaultTimeout(90_000)
          await gotoForPreview(mobilePage, url)
          await mobilePage.evaluate(() => {
            window.scrollTo(0, 0)
            document.documentElement.scrollTop = 0
            document.body.scrollTop = 0
          })
          await new Promise((r) => setTimeout(r, 380))
          const mobB64 = (await mobilePage.screenshot({
            type: 'jpeg',
            quality: 82,
            encoding: 'base64',
            fullPage: false,
          })) as string
          mobileDataUrl = `data:image/jpeg;base64,${mobB64}`
        } catch (mobileErr) {
          console.warn('Mobile viewport capture failed, using desktop frame for both:', mobileErr)
        } finally {
          if (mobilePage) {
            await mobilePage.close().catch(() => undefined)
          }
        }

        send(controller, {
          type: 'preview',
          previewMobile: mobileDataUrl,
        })

        await page.evaluate(() => {
          window.scrollTo(0, 0)
        })

        const finalUrl = page.url()

        let wasRedirected = false
        try {
          const requestedHost = new URL(url).hostname.replace(/^www\./, '')
          const finalHost = new URL(finalUrl).hostname.replace(/^www\./, '')
          wasRedirected = requestedHost !== finalHost
        } catch {
          // ignore
        }

        const { height, innerHeight } = await page.evaluate(() => ({
          height: document.documentElement.scrollHeight,
          innerHeight: window.innerHeight,
        }))

        const safeH = Math.max(4, height)
        const vh = Math.max(1, innerHeight)
        const maxScrollY = Math.max(0, safeH - vh)

        // Viewport screenshots at scroll positions (clip with fullPage:false only captures the
        // viewport, so y offsets beyond the viewport produced blank tiles before).
        const scrollTargets = [0, 1, 2, 3].map((i) => {
          if (maxScrollY <= 0) return 0
          if (i === 3) return maxScrollY
          return Math.min(Math.floor((i * maxScrollY) / 3), maxScrollY)
        })

        const quadrants: string[] = []
        for (let i = 0; i < 4; i++) {
          const targetY = scrollTargets[i] ?? 0
          await page.evaluate((y) => {
            window.scrollTo(0, y)
            document.documentElement.scrollTop = y
            document.body.scrollTop = y
          }, targetY)
          await new Promise((r) => setTimeout(r, 280))
          const b64 = (await page.screenshot({
            type: 'png',
            encoding: 'base64',
            fullPage: false,
          })) as string
          quadrants.push(`data:image/png;base64,${b64}`)
        }

        await page.evaluate(() => {
          window.scrollTo(0, 0)
          document.documentElement.scrollTop = 0
          document.body.scrollTop = 0
        })

        await browser.close()
        browser = null

        send(controller, {
          type: 'complete',
          message: 'Capture complete',
          quadrants,
          quadrantLabels: [...QUADRANT_LABELS],
          url: finalUrl,
          /** For /scanner mobile frame — desktop already sent on first preview + batch screenshot */
          previewMobile: mobileDataUrl,
          redirectWarning: wasRedirected
            ? `The site did not stay on your requested URL and redirected to "${finalUrl}" (possible geo-block or login wall). Screenshots are from that final page. If you use VPN/proxy, run the app on the same network: set PUPPETEER_PROXY in .env or enable VPN before npm run dev.`
            : undefined,
        })
        controller.close()
      } catch (error: unknown) {
        console.error('Error in analyzeWebsiteStream:', error)
        const msg = error instanceof Error ? error.message : 'An unknown error occurred'
        try {
          send(controller, {
            type: 'error',
            error: 'Failed to capture page',
            details: msg,
          })
        } catch {
          /* stream may be closed */
        }
        try {
          controller.close()
        } catch {
          /* */
        }
      } finally {
        if (browser) {
          await browser.close()
        }
      }
    },
  })

  return ndjsonResponse(stream)
}
