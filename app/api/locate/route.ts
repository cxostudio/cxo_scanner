import { NextRequest, NextResponse } from 'next/server'
import type { Page } from 'puppeteer-core'
import { OpenRouter } from '@openrouter/sdk'
import { launchPuppeteerBrowser } from '@/lib/puppeteer/launchPuppeteer'
import { prepare as prepareForScan, open as openLikeScan } from '@/lib/scanV2/capture'

/**
 * POST /api/locate: pins scan findings on the page.
 *
 * Runs after the scan, separately from the scan engine (app/api/scan), so it can't change a
 * single pass/fail. One page load, one AI call:
 *   1. open the page at 1440px, close the cookie banner, capture the top of the page
 *   2. list the visible elements with their position (buttons, title, price, reviews, images…)
 *   3. ask the model which listed element each finding is about, or where its fix belongs
 *      (e.g. "no trust badges near the button" → the Add to cart button)
 * The pins are element boxes on that same screenshot, so they always line up.
 */

export const runtime = 'nodejs'
export const maxDuration = 120

const DEVICES = {
  desktop: { width: 1440, height: 900, maxHeight: 2600, mobile: false },
  // a phone: the product area runs much longer, so capture deeper
  mobile: { width: 390, height: 844, maxHeight: 3600, mobile: true },
} as const
type Device = keyof typeof DEVICES
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const MAX_ELEMENTS = 140

type Box = { x: number; y: number; w: number; h: number }
type Candidate = { id: string; kind: string; text: string; box: Box }
type Finding = { id: string; title: string; reason?: string }

const CONSENT_WORDS = ['accept', 'allow all', 'agree', 'aceptar', 'accepter', 'tout accepter', 'akzeptieren', 'accetta', 'aceitar', 'ok', 'got it', 'alle akzeptieren', 'accepteren']

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { url?: string; findings?: Finding[]; device?: string; region?: string; limit?: number }
  const device: Device = body.device === 'mobile' ? 'mobile' : 'desktop'
  const D = DEVICES[device]
  const WIDTH = D.width
  const MAX_HEIGHT = D.maxHeight
  const raw = typeof body.url === 'string' ? body.url.trim() : ''
  const findings = (Array.isArray(body.findings) ? body.findings : [])
    .filter((f) => f && typeof f.id === 'string' && typeof f.title === 'string')
    // the free results page pins up to 30; the full report's product page (product + store-wide findings) up to 60
    .slice(0, Math.min(60, Math.max(1, Number(body.limit) || 30)))
  // lab: region 'bottom' returns only a capture of the end of the page (footer examples), no pins
  const bottomOnly = body.region === 'bottom'
  if (!raw || (!findings.length && !bottomOnly)) return NextResponse.json({ error: 'url and findings are required' }, { status: 400 })
  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`

  let browser: Awaited<ReturnType<typeof launchPuppeteerBrowser>> | null = null
  try {
    browser = await launchPuppeteerBrowser({ windowSizeArg: `--window-size=${WIDTH},${D.height}` })
    const page = await browser.newPage()
    await page.setViewport({ width: WIDTH, height: D.height, deviceScaleFactor: 1, isMobile: D.mobile, hasTouch: D.mobile })
    const debug: string[] = []
    const withDebugEarly = request.nextUrl.searchParams.get('debug') === '1'
    await page.setUserAgent(D.mobile ? MOBILE_UA : DESKTOP_UA)
    // load it exactly as the scan does (language header, heavy third-party scripts blocked, delayed
    // scripts run): some stores render a blank page to a plain headless load (deathwishcoffee.com)
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })
    await prepareForScan(page)
    await openLikeScan(page, url)
    await new Promise((r) => setTimeout(r, 800))

    // close the cookie banner so it doesn't cover the page we pin on
    await page
      .evaluate((words: string[]) => {
        const els = Array.from(document.querySelectorAll<HTMLElement>('button, a, [role="button"], input[type="button"], input[type="submit"]'))
        const hit = els.find((el) => {
          const t = (el.innerText || (el as HTMLInputElement).value || '').trim().toLowerCase()
          const r = el.getBoundingClientRect()
          // never a real link (a footer 'Facebook' link once matched 'ok' and opened Facebook):
          // only buttons, or links that go nowhere; short words like 'ok' must be the whole label
          const href = el.tagName === 'A' ? (el.getAttribute('href') || '').trim() : ''
          if (href && href !== '#' && !href.startsWith('javascript:')) return false
          const word = (w: string) => (w.length <= 3 ? t === w : t === w || t.startsWith(w + ' ') || new RegExp('\\b' + w + '\\b').test(t))
          return t.length > 0 && t.length < 30 && r.width > 0 && r.height > 0 && words.some(word)
        })
        hit?.click()
      }, CONSENT_WORDS)
      .catch(() => undefined)
    await new Promise((r) => setTimeout(r, 700))
    // if a click still took us off the store, go back to the page we were asked to pin
    try {
      if (new URL(page.url()).host !== new URL(url).host) await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    } catch {}

    // newsletter popups and chat bubbles: Escape, then hide anything fixed that covers the page,
    // and undo the scroll lock popups put on <html>/<body>
    await page.keyboard.press('Escape').catch(() => undefined)
    await page
      .evaluate(() => {
        const vw = window.innerWidth
        const vh = window.innerHeight
        for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
          const st = getComputedStyle(el)
          if (st.position !== 'fixed') continue // never sticky: buy boxes are often sticky on desktop
          const r = el.getBoundingClientRect()
          const big = r.width * r.height > vw * vh * 0.25
          const z = parseInt(st.zIndex || '0', 10)
          const isHeader = r.top <= 1 && r.height < 160
          void z
          // floating widgets (chat, promo bubbles) in the lower half; full-width sticky add-to-cart bars stay
          const floating = st.position === 'fixed' && !isHeader && r.top > vh * 0.45 && r.width < vw * 0.9
          if ((big && !isHeader) || floating || (st.position === 'fixed' && z > 1000 && !isHeader && r.height < vh * 0.5 && r.top > vh * 0.5)) {
            el.style.setProperty('display', 'none', 'important')
          }
        }
        for (const el of [document.documentElement, document.body]) {
          el.style.setProperty('overflow', 'visible', 'important')
          el.style.setProperty('height', 'auto', 'important')
          el.style.setProperty('position', 'static', 'important')
        }
      })
      .catch(() => undefined)
    await new Promise((r) => setTimeout(r, 300))

    // backdrops that dim the whole page (cookie walls, modals) are often pseudo-elements or
    // classed overlays rather than big fixed boxes: hide those too
    await page
      .addStyleTag({
        content: `
          html::before, html::after, body::before, body::after { display: none !important; }
          html, body, main, #MainContent { filter: none !important; opacity: 1 !important; }
        `,
      })
      .catch(() => undefined)
    // cookie and popup layers by name, but never the page itself: some stores put a "cookie" class on
    // <html> (deathwishcoffee.com: "csm-cookie-embed"), which once blanked the whole screenshot
    await page
      .evaluate(() => {
        const SEL = '[aria-modal="true"], dialog[open], [class*="modal-backdrop" i], [class*="modal__overlay" i], [class*="popup-overlay" i], [id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i], [id*="onetrust" i], [id*="didomi" i], [class*="klaviyo-form" i], [class*="needsclick" i][role="dialog"], [id*="usercentrics" i]'
        const total = document.body ? document.body.querySelectorAll('*').length : 0
        for (const el of Array.from(document.querySelectorAll<HTMLElement>(SEL))) {
          if (el === document.documentElement || el === document.body || el.tagName === 'MAIN' || el.id === 'MainContent') continue
          if (el.querySelector('main, #MainContent, h1') || el.querySelectorAll('*').length > Math.max(400, total * 0.3)) continue
          el.style.setProperty('display', 'none', 'important')
        }
      })
      .catch(() => undefined)
    await page
      .evaluate(() => {
        // anything fixed or absolute that covers most of the viewport with a see-through dark fill
        for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
          const st = getComputedStyle(el)
          if (st.position !== 'fixed' && st.position !== 'absolute') continue
          const r = el.getBoundingClientRect()
          if (r.width < window.innerWidth * 0.8 || r.height < window.innerHeight * 0.6) continue
          const bg = st.backgroundColor.match(/rgba?\(([^)]+)\)/)
          const parts = bg ? bg[1].split(',').map((x) => parseFloat(x)) : []
          const alpha = parts.length === 4 ? parts[3] : 1
          const dark = parts.length >= 3 && parts[0] + parts[1] + parts[2] < 200
          if (dark && alpha > 0 && alpha < 0.95 && !el.querySelector('img, h1, button')) el.style.setProperty('display', 'none', 'important')
        }
      })
      .catch(() => undefined)

    // Show the page as a shopper sees it after scrolling through it: scroll slowly so lazy sections
    // and scroll-reveal animations fire, then freeze every animation in its finished state.
    await page
      .addStyleTag({
        content: `*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition: none !important; scroll-behavior: auto !important; }`,
      })
      .catch(() => undefined)
    await page.evaluate(async (h: number) => {
      for (let y = 0; y < h; y += 400) {
        window.scrollTo(0, y)
        await new Promise((r) => setTimeout(r, 180))
      }
      window.scrollTo(0, h)
      await new Promise((r) => setTimeout(r, 400))
    }, MAX_HEIGHT)
    await page
      .evaluate(() => {
        // lazy images that are still empty: load them now
        for (const img of Array.from(document.querySelectorAll<HTMLImageElement>('img'))) {
          img.loading = 'eager'
          const lazy = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.getAttribute('data-original')
          if (lazy && (!img.currentSrc || img.currentSrc.startsWith('data:'))) img.src = lazy
          const set = img.getAttribute('data-srcset')
          if (set && !img.srcset) img.srcset = set
        }
        // scroll-reveal content still hidden or half faded (AOS, theme "animate" / "reveal" classes):
        // show it in its final state. Only elements with page content, never empty overlays.
        const reveal = /(^|[\s_-])(aos|animate|animated|animation|reveal|fade|appear|scroll-trigger|motion|wow|in-view|lazy)/i
        for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
          const st = getComputedStyle(el)
          const op = Number(st.opacity)
          if (op >= 1 && st.visibility !== 'hidden') continue
          if (!reveal.test(el.className?.toString() || '') && !el.hasAttribute('data-aos') && !el.hasAttribute('data-cascade')) continue
          if (!(el.innerText || '').trim() && !el.querySelector('img, video, svg')) continue
          // never menus, drawers, pop-ups or anything floating: those are hidden on purpose
          if (st.position === 'fixed' || st.position === 'absolute' || el.closest('header, nav, dialog, aside, [role="dialog"], [aria-modal], [aria-hidden="true"], [class*="drawer" i], [class*="modal" i], [class*="popup" i], [class*="menu" i], [class*="dropdown" i], [class*="tooltip" i]')) continue
          el.style.setProperty('opacity', '1', 'important')
          el.style.setProperty('visibility', 'visible', 'important')
          el.style.setProperty('transform', 'none', 'important')
          el.style.setProperty('clip-path', 'none', 'important')
        }
      })
      .catch(() => undefined)
    await toTop(page)
    await new Promise((r) => setTimeout(r, 600))
    // sticky bars that appear on scroll (add-to-cart bar, back-to-top) would be printed in the middle
    // of a full-page shot: hide everything fixed except the header at the very top
    await page
      .evaluate(() => {
        for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
          const st = getComputedStyle(el)
          // the screenshot is stitched from screen-sized shots down the page: sticky parts (header,
          // gallery column, buy box) are laid out once, where they sit at the top, or they'd repeat
          if (st.position === 'sticky') { el.style.setProperty('position', 'relative', 'important'); el.style.setProperty('top', 'auto', 'important'); continue }
          if (st.position !== 'fixed') continue
          const r = el.getBoundingClientRect()
          if (r.top <= 1 && r.height < 200) { el.style.setProperty('position', 'absolute', 'important'); continue }
          el.style.setProperty('display', 'none', 'important')
        }
      })
      .catch(() => undefined)
    await new Promise((r) => setTimeout(r, 300))

    if (bottomOnly) {
      await page.evaluate(async () => {
        const end = () => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)
        for (let y = 0; y < end(); y += 600) {
          window.scrollTo(0, y)
          await new Promise((r) => setTimeout(r, 120))
        }
        window.scrollTo(0, end())
        await new Promise((r) => setTimeout(r, 600))
        window.scrollTo(0, 0)
      })
      const full = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight))
      const h = Math.min(1800, full)
      const shot = await page.screenshot({ type: 'jpeg', quality: 80, clip: { x: 0, y: full - h, width: WIDTH, height: h }, captureBeyondViewport: true })
      return NextResponse.json({ device, screenshot: `data:image/jpeg;base64,${Buffer.from(shot).toString('base64')}`, width: WIDTH, height: h, pins: [] })
    }

    const { candidates, height } = await page.evaluate(
      (maxH: number, maxN: number) => {
        const out: { id: string; kind: string; text: string; box: { x: number; y: number; w: number; h: number } }[] = []
        const seen = new Set<Element>()
        const rule = (sel: string, kind: string) => ({ sel, kind })
        const rules = [
          rule('h1', 'title'),
          rule('h2, h3', 'heading'),
          rule('button, [role="button"], input[type="submit"], a[class*="btn"], a[class*="button"]', 'button'),
          rule('[class*="price" i], [data-price]', 'price'),
          rule('[class*="review" i], [class*="rating" i], [class*="star" i], [class*="yotpo" i], [class*="judge" i], [class*="okendo" i]', 'reviews'),
          rule('[class*="badge" i], [class*="trust" i], [class*="guarantee" i], [class*="payment" i]', 'trust'),
          rule('[class*="shipping" i], [class*="delivery" i], [class*="announcement" i]', 'shipping'),
          rule('[class*="breadcrumb" i], nav[aria-label*="bread" i]', 'breadcrumb'),
          rule('select, [class*="swatch" i], [class*="variant" i], fieldset, [class*="option" i]', 'variants'),
          rule('[class*="tab" i], details, [class*="accordion" i], [class*="collapsible" i]', 'tabs'),
          rule('[class*="gallery" i], [class*="media" i], [class*="slider" i]', 'gallery'),
          rule('img, video', 'image'),
          rule('header, nav', 'navigation'),
          rule('[class*="upsell" i], [class*="recommend" i], [class*="related" i], [class*="bundle" i]', 'upsell'),
          rule('[class*="description" i], [class*="benefit" i], [class*="feature" i], ul', 'content'),
          rule('form, input[type="email"]', 'form'),
        ]
        for (const { sel, kind } of rules) {
          for (const el of Array.from(document.querySelectorAll(sel))) {
            if (out.length >= maxN) break
            if (seen.has(el)) continue
            const r = el.getBoundingClientRect()
            const y = r.top + window.scrollY
            const st = getComputedStyle(el)
            if (r.width < 24 || r.height < 12 || y > maxH || r.width > window.innerWidth * 0.98 && r.height > 600) continue
            if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) continue
            if (kind === 'image' && (r.width < 120 || r.height < 120)) continue
            seen.add(el)
            const text = ((el as HTMLElement).innerText || el.getAttribute('alt') || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 60)
            out.push({ id: `e${out.length + 1}`, kind, text, box: { x: Math.round(r.left + window.scrollX), y: Math.round(y), w: Math.round(r.width), h: Math.round(r.height) } })
          }
        }
        return { candidates: out, height: Math.min(maxH, Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)) }
      },
      MAX_HEIGHT,
      MAX_ELEMENTS,
    )

    await toTop(page)
    if (withDebugEarly) debug.push(`before shot: ${JSON.stringify(await page.evaluate(() => ({ y: window.scrollY, se: document.scrollingElement?.tagName, seTop: document.scrollingElement?.scrollTop, html: getComputedStyle(document.documentElement).overflowY, body: getComputedStyle(document.body).overflowY, active: (document.activeElement as HTMLElement | null)?.tagName + '.' + String((document.activeElement as HTMLElement | null)?.className || '').slice(0, 40), firstTop: Math.round(document.querySelector('header, [class*="header" i]')?.getBoundingClientRect().top ?? -1), mainTop: Math.round(document.querySelector('main')?.getBoundingClientRect().top ?? -1) })).catch((e) => String(e)))}`)
    const screenshot = await stitchedShot(page, WIDTH, height, D.height, D.mobile ? 70 : 72, withDebugEarly ? debug : undefined)

    debug.push(`${candidates.length} elements`)
    const pins = await matchFindings(findings, candidates as Candidate[], screenshot, debug, device)
    const withDebug = request.nextUrl.searchParams.get('debug') === '1'
    return NextResponse.json({ device, screenshot, width: WIDTH, height, pins, ...(withDebug ? { debug, candidates } : {}) })
  } catch (error) {
    console.error('/api/locate error:', error)
    return NextResponse.json({ error: 'Could not place the findings on the page' }, { status: 500 })
  } finally {
    if (browser) await browser.close().catch(() => undefined)
  }
}

/** One AI call: finding → element id. Unknown ids and low-confidence matches are dropped. */


/** One tall screenshot made of screen-sized shots taken while scrolling down, like a shopper sees
 *  the page. A single shot "beyond the viewport" leaves the lower page blank on themes that only
 *  paint what's on screen (brooklinen.com, geteasybird.com): pins then float on an empty page. */
async function stitchedShot(page: Page, width: number, height: number, vh: number, quality: number, log?: string[]): Promise<string> {
  const parts: { y: number; b64: string }[] = []
  await freezeScroll(page, true)
  for (let y = 0; y < height; y += vh) {
    const top = Math.min(y, Math.max(0, height - vh))
    // the page didn't stay there (locked, or its scripts moved it): shoot that band the old way
    let b64 = await shotAt(page, top, quality)
    log?.push(`band ${top}: ${b64 ? 'on screen' : 'fallback'}`)
    if (!b64) {
      await toTop(page) // a clip beyond the viewport is only right from the top of the page
      b64 = (await page.screenshot({ type: 'jpeg', quality, encoding: 'base64', clip: { x: 0, y: top, width, height: Math.min(vh, height - top) }, captureBeyondViewport: true }).catch(() => null)) as string | null
    }
    if (b64) parts.push({ y: top, b64 })
    if (top + vh >= height) break
  }
  await freezeScroll(page, false)
  await toTop(page)
  const canvas = await page.browser().newPage()
  try {
    return await canvas.evaluate(
      async (ps: { y: number; b64: string }[], w: number, h: number, q: number) => {
        const cv = document.createElement('canvas')
        cv.width = w
        cv.height = h
        const ctx = cv.getContext('2d')!
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, w, h)
        for (const p of ps) {
          const img = new Image()
          img.src = `data:image/jpeg;base64,${p.b64}`
          await img.decode()
          ctx.drawImage(img, 0, p.y)
        }
        return cv.toDataURL('image/jpeg', q / 100)
      },
      parts, width, height, quality,
    )
  } finally {
    await canvas.close().catch(() => {})
  }
}


/** While screenshots are taken, the page's own scripts can't scroll it (a chat widget or carousel
 *  calling scrollIntoView/focus moved brooklinen.com ~1500px mid-shot); only scrollToY can. */
async function freezeScroll(page: Page, on: boolean) {
  await page
    .evaluate((freeze: boolean) => {
      const w = window as unknown as Record<string, unknown>
      if (freeze && !w.__cxoScroll) {
        w.__cxoScroll = window.scrollTo.bind(window)
        w.__cxoSaved = [window.scrollTo, window.scroll, window.scrollBy, Element.prototype.scrollIntoView, HTMLElement.prototype.focus]
        const noop = () => {}
        window.scrollTo = noop as typeof window.scrollTo
        window.scroll = noop as typeof window.scroll
        window.scrollBy = noop as typeof window.scrollBy
        Element.prototype.scrollIntoView = noop
        const focus = HTMLElement.prototype.focus
        HTMLElement.prototype.focus = function (o?: FocusOptions) { return focus.call(this, { ...(o || {}), preventScroll: true }) }
      } else if (!freeze && w.__cxoSaved) {
        const [a, b, c, d, e] = w.__cxoSaved as [typeof window.scrollTo, typeof window.scroll, typeof window.scrollBy, typeof Element.prototype.scrollIntoView, typeof HTMLElement.prototype.focus]
        window.scrollTo = a; window.scroll = b; window.scrollBy = c; Element.prototype.scrollIntoView = d; HTMLElement.prototype.focus = e
        delete w.__cxoScroll; delete w.__cxoSaved
      }
    }, on)
    .catch(() => {})
}

/** Scroll to y (instant, past a frozen page's scripts) and return where the page really is. */
async function scrollToY(page: Page, y: number): Promise<number> {
  return page
    .evaluate(async (t: number) => {
      const go = ((window as unknown as Record<string, unknown>).__cxoScroll as typeof window.scrollTo | undefined) || window.scrollTo.bind(window)
      go({ top: t, left: 0, behavior: 'instant' as ScrollBehavior })
      await new Promise((r) => setTimeout(r, 150))
      return Math.round(window.scrollY)
    }, y)
    .catch(() => -1)
}

/** A screenshot of the screen at y, only if the page stayed at y for the whole shot (3 tries). */
async function shotAt(page: Page, y: number, quality: number): Promise<string | null> {
  for (let i = 0; i < 3; i++) {
    if (Math.abs((await scrollToY(page, y)) - y) > 2) continue
    const b64 = (await page.screenshot({ type: 'jpeg', quality, encoding: 'base64' }).catch(() => null)) as string | null
    const after = await page.evaluate(() => Math.round(window.scrollY)).catch(() => -1)
    if (b64 && Math.abs(after - y) <= 2) return b64
  }
  return null
}

/** Back to the very top, for real: themes with `scroll-behavior: smooth` (brooklinen.com) animate a
 *  plain scrollTo, and a full-page shot taken mid-animation starts lower down, with every pin off. */
async function toTop(page: Page) {
  await page
    .evaluate(async () => {
      for (const el of [document.documentElement, document.body]) el?.style.setProperty('scroll-behavior', 'auto', 'important')
      // a popup or menu can leave the page scroll-locked (overflow: hidden on html/body): unlock it
      for (const el of [document.documentElement, document.body]) {
        if (!el) continue
        const st = getComputedStyle(el)
        if (st.overflowY === 'hidden' || st.overflow === 'hidden') { el.style.setProperty('overflow', 'visible', 'important'); el.style.setProperty('overflow-y', 'visible', 'important') }
        if (st.position === 'fixed') el.style.setProperty('position', 'static', 'important')
        if (el === document.body && st.height !== 'auto' && el.scrollHeight > window.innerHeight && el.clientHeight <= window.innerHeight) el.style.setProperty('height', 'auto', 'important')
      }
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
      for (let i = 0; i < 20 && window.scrollY > 0; i++) {
        await new Promise((r) => setTimeout(r, 50))
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
      }
    })
    .catch(() => {})
}

async function matchFindings(findings: Finding[], candidates: Candidate[], screenshot: string, debug: string[] = [], device: Device = 'desktop') {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey || !candidates.length) {
    debug.push(apiKey ? 'no elements' : 'no OPENROUTER_API_KEY')
    return []
  }
  const list = candidates.map((c) => `${c.id} | ${c.kind} | "${c.text}" | x${c.box.x} y${c.box.y} ${c.box.w}x${c.box.h}`).join('\n')
  const asked = findings.map((f) => `${f.id} | ${f.title}${f.reason ? ` | what we saw: ${f.reason.slice(0, 220)}` : ''}`).join('\n')
  const system =
    `You place conversion-audit findings on a screenshot of an e-commerce product page, seen on ${device === 'mobile' ? 'a phone' : 'a desktop screen'}. ` +
    'You get the page screenshot, a list of page elements (id | kind | text | position in px on the screenshot) and a list of findings. ' +
    'For each finding, pick the ONE element the finding is about. If something is missing, pick the element where it should be added ' +
    '(e.g. missing trust badges or free-shipping message → the main add-to-cart button; missing benefits → the product title; missing reviews near title → the product title). ' +
    'Prefer elements in the main product area over header or footer. Never park a finding on the header, menu or breadcrumb unless it is about navigation. ' +
    'If no listed element fits (the finding is about the homepage, the footer, another page or something not in the screenshot), use null: fewer, correct pins beat many vague ones. ' +
    'Answer only JSON: {"pins":[{"finding":"<finding id>","element":"<element id or null>","confidence":0-1}]}'
  try {
    const openRouter = new OpenRouter({ apiKey })
    // the provider fails now and then ("Provider returned error"): try again, then a second model
    const models = [process.env.OPENROUTER_LOCATE_MODEL || process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash-lite', 'google/gemini-2.5-flash-lite', 'google/gemini-2.5-flash']
    let res: unknown = null
    let lastErr: unknown = null
    for (const model of models) {
      try {
        res = await sendOnce(model)
        break
      } catch (e) {
        lastErr = e
        debug.push(`retry after: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    if (!res) throw lastErr
    async function sendOnce(model: string) {
    return openRouter.chat.send({
      model,
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            { type: 'text', text: `ELEMENTS\n${list}\n\nFINDINGS\n${asked}` },
            { type: 'image_url', imageUrl: { url: screenshot } },
          ],
        },
      ],
      temperature: 0,
      maxTokens: 1500,
      stream: false,
      responseFormat: { type: 'json_object' },
    } as never)
    }
    const content = (res as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content
    const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((p: { text?: string }) => p?.text || '').join('') : ''
    debug.push(`ai: ${text.slice(0, 600)}`)
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as { pins?: { finding?: string; element?: string | null; confidence?: number }[] }
    const byId = new Map(candidates.map((c) => [c.id, c]))
    const ids = new Set(findings.map((f) => f.id))
    const kept = (json.pins ?? [])
      .filter((p) => p.finding && ids.has(p.finding) && p.element && byId.has(p.element) && (p.confidence ?? 1) >= 0.5)
      .sort((a, b) => (b.confidence ?? 1) - (a.confidence ?? 1))
    // at most 3 findings per element: beyond that the model is parking findings it can't place
    const perEl = new Map<string, number>()
    return kept
      .filter((p) => {
        const n = (perEl.get(p.element as string) ?? 0) + 1
        perEl.set(p.element as string, n)
        return n <= 3
      })
      .map((p) => ({ findingId: p.finding as string, box: byId.get(p.element as string)!.box }))
  } catch (e) {
    console.error('[locate] matching failed:', e)
    debug.push(`ai error: ${e instanceof Error ? e.message : String(e)}`)
    return []
  }
}
