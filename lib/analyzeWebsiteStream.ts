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
const READY_COMPLETE_WAIT_MS = 3_500
const POST_NAV_SETTLE_MS = 450

const DESKTOP_VIEWPORT = { width: 1280, height: 800, deviceScaleFactor: 1 as const }
/**
 * Width/height only — do NOT set isMobile/hasTouch on the shared desktop page.
 * Those flags change client-hints and often re-trigger Cloudflare after the mobile shot,
 * which used to poison the later quadrant thumbnails.
 */
const MOBILE_VIEWPORT = {
  width: 390,
  height: 844,
  deviceScaleFactor: 2 as const,
}
/** Brief CSS reflow after viewport swap — no second navigation (keeps speed + CF cookies). */
const MOBILE_REFLOW_MS = 220

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Detect Cloudflare interstitial / managed challenge HTML.
 * Challenge pages often return HTTP 200, so we must inspect DOM rather than status.
 */
async function pageLooksLikeCloudflareChallenge(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(() => {
      const title = (document.title || '').toLowerCase()
      const bodyText = (document.body?.innerText || '').slice(0, 2500).toLowerCase()
      const html = (document.documentElement?.innerHTML || '').slice(0, 8000).toLowerCase()
      return (
        title.includes('just a moment') ||
        title.includes('attention required') ||
        title.includes('security verification') ||
        bodyText.includes('performing security verification') ||
        bodyText.includes('checking your browser') ||
        bodyText.includes('verify you are human') ||
        bodyText.includes('verify you are not a bot') ||
        bodyText.includes('this website uses a security service to protect against malicious bots') ||
        html.includes('cf-challenge') ||
        html.includes('challenge-platform') ||
        html.includes('cdn-cgi/challenge') ||
        html.includes('cf-browser-verification')
      )
    })
  } catch {
    return false
  }
}

/**
 * Detect any bot-wall / rate-limit / error / empty capture (not just Cloudflare),
 * e.g. an Envoy "local_rate_limited" body, an access-denied page, or a near-empty
 * response. When true, the client keeps the logo loading screen instead of
 * replacing it with the useless block/white screenshot.
 */
async function pageLooksBlocked(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(() => {
      const text = (document.body?.innerText || '').trim()
      const lower = text.toLowerCase()
      const markers = [
        'local_rate_limited', 'rate limited', 'too many requests',
        'access denied', 'access to this page has been denied', 'request blocked',
        'you have been blocked', 'ip address has been blocked', 'forbidden',
        'are you a robot', 'verify you are human', 'verify you are a human',
        'captcha', 'checking your browser', 'just a moment',
        'attention required', 'pardon our interruption', 'unusual traffic',
        'bot detection', 'ddos protection', 'ray id', 'cf-ray',
        'enable javascript and cookies', 'please enable javascript',
        'not available in your', 'this content is not available',
        'service unavailable', 'temporarily unavailable',
      ]
      return text.length < 120 || markers.some((m) => lower.includes(m))
    })
  } catch {
    return false
  }
}

function isExecutionContextResetError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? '')
  const lower = msg.toLowerCase()
  return (
    lower.includes('execution context was destroyed') ||
    lower.includes('cannot find context with specified id') ||
    lower.includes('execution context is not available')
  )
}

async function stabilizeAfterPossibleNavigation(page: Page): Promise<void> {
  try {
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 7_000 })
  } catch {
    // It's fine if there is no active navigation.
  }
  try {
    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 4_000 })
  } catch {
    // Many storefronts keep loading trackers forever.
  }
  await sleep(240)
}

async function retryOnContextReset<T>(
  page: Page,
  label: string,
  run: () => Promise<T>,
  retries = 2,
): Promise<T> {
  let attempt = 0
  while (true) {
    try {
      return await run()
    } catch (error) {
      if (!isExecutionContextResetError(error) || attempt >= retries) throw error
      attempt += 1
      console.warn(`[analyzeWebsiteStream] ${label} failed due to navigation/context reset; retry ${attempt}/${retries}`)
      await stabilizeAfterPossibleNavigation(page)
    }
  }
}

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
      let fallbackDesktopDataUrl: string | null = null
      let fallbackMobileDataUrl: string | null = null
      let fallbackFinalUrl = url
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
        await page.setViewport(DESKTOP_VIEWPORT)

        await page.setExtraHTTPHeaders({
          'Accept-Language': 'en-GB,en;q=0.9',
        })
        await page.setUserAgent(
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        )

        await gotoForPreview(page, url)

        // Ensure desktop preview is above-the-fold (same as fresh mobile tab). Some sites
        // restore scroll or paint mid-page before first capture without this.
        await retryOnContextReset(page, 'desktop scroll reset', async () => {
          await page.evaluate(() => {
            window.scrollTo(0, 0)
            document.documentElement.scrollTop = 0
            document.body.scrollTop = 0
          })
        })
        await sleep(100)

        const desktopB64 = (await retryOnContextReset(page, 'desktop screenshot', async () => {
          return (await page.screenshot({
            type: 'jpeg',
            quality: 82,
            encoding: 'base64',
            fullPage: false,
          })) as string
        })) as string

        let desktopDataUrl = `data:image/jpeg;base64,${desktopB64}`
        fallbackDesktopDataUrl = desktopDataUrl
        // If the capture is a bot-wall / rate-limit / error / empty page, tell the
        // client so it keeps the logo loading screen instead of showing this shot.
        const previewBlocked = await pageLooksBlocked(page)
        send(controller, {
          type: 'preview',
          previewDesktop: desktopDataUrl,
          // Immediate mobile placeholder: replaced by real mobile frame below.
          previewMobile: desktopDataUrl,
          blocked: previewBlocked,
        })

        const finalUrl = page.url()
        fallbackFinalUrl = finalUrl

        let wasRedirected = false
        try {
          const requestedHost = new URL(url).hostname.replace(/^www\./, '')
          const finalHost = new URL(finalUrl).hostname.replace(/^www\./, '')
          wasRedirected = requestedHost !== finalHost
        } catch {
          // ignore
        }

        // Capture quadrants BEFORE any mobile viewport swap on this shared page.
        // Mobile resize previously re-triggered Cloudflare and poisoned these bottom thumbs.
        await retryOnContextReset(page, 'desktop pre-quadrant scroll reset', async () => {
          await page.evaluate(() => {
            window.scrollTo(0, 0)
          })
        })

        if (await pageLooksLikeCloudflareChallenge(page)) {
          console.warn(
            '[analyzeWebsiteStream] Cloudflare before quadrants; recovering with same-session reload',
          )
          await gotoForPreview(page, url)
          await page.setViewport(DESKTOP_VIEWPORT)
          await retryOnContextReset(page, 'post-cf-recovery scroll reset', async () => {
            await page.evaluate(() => {
              window.scrollTo(0, 0)
              document.documentElement.scrollTop = 0
              document.body.scrollTop = 0
            })
          })
        }

        const { height, innerHeight } = await retryOnContextReset(
          page,
          'measure viewport/document height',
          async () =>
            await page.evaluate(() => ({
              height: document.documentElement.scrollHeight,
              innerHeight: window.innerHeight,
            })),
        )

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
        let lastGoodQuadrant: string | null = null
        for (let i = 0; i < 4; i++) {
          try {
            if (await pageLooksLikeCloudflareChallenge(page)) {
              console.warn(
                `[analyzeWebsiteStream] Cloudflare during quadrant ${i + 1}; using last good frame`,
              )
              quadrants.push(lastGoodQuadrant || desktopDataUrl)
              continue
            }
            const targetY = scrollTargets[i] ?? 0
            await retryOnContextReset(page, `quadrant ${i + 1} scroll`, async () => {
              await page.evaluate((y) => {
                window.scrollTo(0, y)
                document.documentElement.scrollTop = y
                document.body.scrollTop = y
              }, targetY)
            })
            await sleep(280)
            if (await pageLooksLikeCloudflareChallenge(page)) {
              console.warn(
                `[analyzeWebsiteStream] Cloudflare after quadrant ${i + 1} scroll; using last good frame`,
              )
              quadrants.push(lastGoodQuadrant || desktopDataUrl)
              continue
            }
            const b64 = (await retryOnContextReset(page, `quadrant ${i + 1} screenshot`, async () => {
              return (await page.screenshot({
                type: 'png',
                encoding: 'base64',
                fullPage: false,
              })) as string
            })) as string
            const dataUrl = `data:image/png;base64,${b64}`
            quadrants.push(dataUrl)
            lastGoodQuadrant = dataUrl
          } catch (quadrantErr) {
            console.warn(`[analyzeWebsiteStream] quadrant ${i + 1} capture failed:`, quadrantErr)
            quadrants.push(lastGoodQuadrant || desktopDataUrl)
          }
        }

        await retryOnContextReset(page, 'desktop post-quadrant scroll reset', async () => {
          await page.evaluate(() => {
            window.scrollTo(0, 0)
            document.documentElement.scrollTop = 0
            document.body.scrollTop = 0
          })
        })

        // Mobile preview last: same session, width-only resize (no Safari UA / no isMobile flags).
        // Preview-only path — does not affect /api/scan rules.
        let mobileDataUrl = desktopDataUrl
        try {
          await page.setViewport(MOBILE_VIEWPORT)
          await retryOnContextReset(page, 'mobile scroll reset', async () => {
            await page.evaluate(() => {
              window.scrollTo(0, 0)
              document.documentElement.scrollTop = 0
              document.body.scrollTop = 0
            })
          })
          await sleep(MOBILE_REFLOW_MS)

          if (await pageLooksLikeCloudflareChallenge(page)) {
            console.warn(
              '[analyzeWebsiteStream] Cloudflare challenge in mobile viewport; keeping desktop frame for mobile preview',
            )
          } else {
            const mobB64 = (await retryOnContextReset(page, 'mobile screenshot', async () => {
              return (await page.screenshot({
                type: 'jpeg',
                quality: 82,
                encoding: 'base64',
                fullPage: false,
              })) as string
            })) as string
            mobileDataUrl = `data:image/jpeg;base64,${mobB64}`
          }
        } catch (mobileErr) {
          console.warn('Mobile viewport capture failed, using desktop frame for both:', mobileErr)
        } finally {
          try {
            await page.setViewport(DESKTOP_VIEWPORT)
          } catch (restoreErr) {
            console.warn('[analyzeWebsiteStream] failed to restore desktop viewport:', restoreErr)
          }
        }

        send(controller, {
          type: 'preview',
          previewMobile: mobileDataUrl,
        })
        fallbackMobileDataUrl = mobileDataUrl

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
        const canFallbackWithFrames = !!fallbackDesktopDataUrl
        if (canFallbackWithFrames) {
          const fallbackDesktop = fallbackDesktopDataUrl!
          const fallbackMobile = fallbackMobileDataUrl || fallbackDesktop
          const fallbackQuadrants = [fallbackDesktop, fallbackDesktop, fallbackDesktop, fallbackDesktop]
          try {
            send(controller, { type: 'preview', previewDesktop: fallbackDesktop })
            send(controller, { type: 'preview', previewMobile: fallbackMobile })
            send(controller, {
              type: 'complete',
              message: 'Capture completed with fallback frames',
              quadrants: fallbackQuadrants,
              quadrantLabels: [...QUADRANT_LABELS],
              url: fallbackFinalUrl,
              previewMobile: fallbackMobile,
              redirectWarning: `Preview capture partially failed (${msg}). Showing fallback frames.`,
            })
            controller.close()
            return
          } catch (fallbackErr) {
            console.warn('[analyzeWebsiteStream] fallback frame response failed:', fallbackErr)
          }
        }
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
