import { NextRequest } from 'next/server'
import { launchPuppeteerBrowser } from '@/lib/puppeteer/launchPuppeteer'

export interface AnalyzeWebsiteStreamBody {
  url: string
}

const QUADRANT_LABELS = ['Top', 'Upper middle', 'Lower middle', 'Bottom'] as const

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
        browser = await launchPuppeteerBrowser({ windowSizeArg: '--window-size=1280,800' })
        const page = await browser.newPage()

        await page.evaluateOnNewDocument(() => {
          Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true })
        })

        await page.setDefaultNavigationTimeout(35000)
        await page.setDefaultTimeout(40000)
        await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 })

        await page.setExtraHTTPHeaders({
          'Accept-Language': 'en-GB,en;q=0.9',
        })
        await page.setUserAgent(
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        )

        try {
          await page.goto(url, { waitUntil: 'networkidle0', timeout: 45000 })
        } catch (navErr: unknown) {
          const isTimeout =
            String(navErr).includes('timeout') || (navErr as Error)?.message?.includes('timeout')
          if (isTimeout) {
            try {
              await page.goto(url, { waitUntil: 'networkidle0', timeout: 25000 })
            } catch {
              throw navErr
            }
          } else {
            throw navErr
          }
        }

        await new Promise((r) => setTimeout(r, 600))

        const desktopB64 = (await page.screenshot({
          type: 'png',
          encoding: 'base64',
          fullPage: false,
        })) as string

        let desktopDataUrl = `data:image/png;base64,${desktopB64}`
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
          await mobilePage.setDefaultNavigationTimeout(45000)
          await mobilePage.setDefaultTimeout(45000)
          try {
            await mobilePage.goto(url, { waitUntil: 'networkidle0', timeout: 45000 })
          } catch (navM: unknown) {
            const isTimeout =
              String(navM).includes('timeout') || (navM as Error)?.message?.includes('timeout')
            if (isTimeout) {
              try {
                await mobilePage.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 })
                await new Promise((r) => setTimeout(r, 2000))
              } catch {
                throw navM
              }
            } else {
              throw navM
            }
          }
          await new Promise((r) => setTimeout(r, 600))
          const mobB64 = (await mobilePage.screenshot({
            type: 'png',
            encoding: 'base64',
            fullPage: false,
          })) as string
          mobileDataUrl = `data:image/png;base64,${mobB64}`
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

        await page.evaluate(async () => {
          const scrollStep = 500
          const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
          const docHeight = document.documentElement.scrollHeight
          for (let y = 0; y < docHeight; y += scrollStep) {
            window.scrollTo(0, y)
            await delay(80)
          }
          window.scrollTo(0, 0)
          await delay(300)
        })

        await new Promise((r) => setTimeout(r, 800))

        // Refresh desktop preview after lazy-load/scroll settles so the top preview
        // matches the same visual state used by quadrant thumbnails.
        const refreshedDesktopB64 = (await page.screenshot({
          type: 'png',
          encoding: 'base64',
          fullPage: false,
        })) as string
        desktopDataUrl = `data:image/png;base64,${refreshedDesktopB64}`
        send(controller, {
          type: 'preview',
          previewDesktop: desktopDataUrl,
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

        const { width, height } = await page.evaluate(() => ({
          width: document.documentElement.scrollWidth,
          height: document.documentElement.scrollHeight,
        }))

        const safeW = Math.max(1, width)
        const safeH = Math.max(4, height)
        const quarterH = Math.ceil(safeH / 4)

        const quadrants: string[] = []
        for (let i = 0; i < 4; i++) {
          const y = i * quarterH
          const clipHeight = i === 3 ? safeH - y : quarterH
          const b64 = (await page.screenshot({
            type: 'png',
            encoding: 'base64',
            clip: { x: 0, y, width: safeW, height: Math.max(1, clipHeight) },
          })) as string
          quadrants.push(`data:image/png;base64,${b64}`)
        }

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
