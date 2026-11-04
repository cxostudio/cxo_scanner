// Scan engine v2, step 1: collect the evidence a CRO reviewer needs, once per page.
//   - desktop (1440) and mobile (390) screenshots, cut into viewport tiles + the footer
//   - visible text, hidden tab/accordion text, header/footer links, measured DOM facts
//   - the header after one item is added to the cart (Shopify), for the cart-count check
//   - a page check first: 404s, redirects away from the product, bot walls
import type { Page } from 'puppeteer-core'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { launchPuppeteerBrowser } from '@/lib/puppeteer/launchPuppeteer'

export type Tile = { label: string; dataUrl: string }
export type Evidence = {
  url: string
  finalUrl: string
  status: number
  title: string
  desktopTiles: Tile[]
  mobileTiles: Tile[]
  cartHeader?: Tile
  cartTest?: string
  text: string
  hiddenText: string
  facts: Record<string, unknown>
  mobileFacts: Record<string, unknown>
  loadMs: number
}

export class PageCheckError extends Error {
  code: 'not_found' | 'redirected' | 'blocked' | 'unreachable'
  constructor(code: PageCheckError['code'], message: string) {
    super(message)
    this.code = code
  }
}

const DESKTOP = { width: 1440, height: 900, tiles: 4 }
const MOBILE = { width: 390, height: 844, tiles: 5 }
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const JPEG_QUALITY = 55

const BOT_WALL = /verify you are human|are you a robot|security check(point)?|checking your browser|attention required|access denied|captcha|just a moment\.\.\.|pardon our interruption|request unsuccessful/i
const NOT_FOUND = /\b404\b|page not found|pagina niet gevonden|page introuvable|página no encontrada|seite nicht gefunden|pagina non trovata/i

/** Accept cookie banners (multilingual), close popups, unroll inner scroll wrappers. */
async function clean(page: Page) {
  await page
    .evaluate(() => {
      const accept = /^(accept( all)?( cookies)?|allow( all)?|agree|i agree|ok|got it|alles accepteren|accepteren|akkoord|accepter( tout)?|tout accepter|j'accepte|aceptar( todo)?|alle akzeptieren|akzeptieren|accetta( tutti)?)$/i
      for (const b of Array.from(document.querySelectorAll('button, a[role="button"], [id*="accept" i]'))) {
        const t = ((b as HTMLElement).innerText || '').trim()
        if (t && t.length < 40 && accept.test(t)) {
          try { (b as HTMLElement).click() } catch {}
        }
      }
    })
    .catch(() => {})
  await page.keyboard.press('Escape').catch(() => {})
  await page
    .addStyleTag({
      content:
        'body [aria-modal="true"],body dialog[open],body div[class*="klaviyo" i],body div[id*="klaviyo" i],body [class*="popup-overlay" i],body [class*="modal-backdrop" i],#onetrust-consent-sdk,#didomi-host,#usercentrics-root,#CybotCookiebotDialog,[id*="cookie-banner" i],[class*="cookie-banner" i]{display:none!important}',
    })
    .catch(() => {})
  await page
    .evaluate(() => {
      const vw = window.innerWidth
      const vh = window.innerHeight
      // big fixed overlays (newsletter popups, age gates) but never the header bar
      for (const el of Array.from(document.querySelectorAll('body *'))) {
        const s = getComputedStyle(el)
        if (s.position !== 'fixed') continue
        const r = el.getBoundingClientRect()
        const isTopBar = r.top <= 5 && r.height < 220
        if (!isTopBar && r.width * r.height > vw * vh * 0.3) (el as HTMLElement).style.setProperty('display', 'none', 'important')
      }
      // themes that scroll an inner wrapper instead of the document
      for (const el of [document.documentElement, document.body, ...Array.from(document.querySelectorAll('body > *, body > * > *'))]) {
        const s = getComputedStyle(el)
        if (el.scrollHeight > el.clientHeight + 50 && /(auto|scroll|hidden)/.test(s.overflowY)) {
          const h = el as HTMLElement
          h.style.setProperty('overflow', 'visible', 'important')
          h.style.setProperty('height', 'auto', 'important')
          h.style.setProperty('max-height', 'none', 'important')
        }
      }
    })
    .catch(() => {})
}

async function scrollForLazyContent(page: Page) {
  await page
    .evaluate(async () => {
      const max = Math.min(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight), 12000)
      for (let y = 0; y < max; y += 700) {
        window.scrollTo(0, y)
        await new Promise((r) => setTimeout(r, 90))
      }
      window.scrollTo(0, 0)
    })
    .catch(() => {})
  await new Promise((r) => setTimeout(r, 700))
}

function pageHeight(page: Page) {
  return page
    .evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, document.scrollingElement?.scrollHeight || 0))
    .catch(() => 0)
}

async function tiles(page: Page, prefix: string, w: number, vh: number, max: number): Promise<Tile[]> {
  const h = await pageHeight(page)
  const out: Tile[] = []
  const n = Math.max(1, Math.min(max, Math.ceil(h / vh)))
  for (let i = 0; i < n; i++) {
    const height = Math.min(vh, Math.max(1, h - i * vh))
    const b64 = await page
      .screenshot({ type: 'jpeg', quality: JPEG_QUALITY, encoding: 'base64', clip: { x: 0, y: i * vh, width: w, height }, captureBeyondViewport: true })
      .catch(() => null)
    if (b64) out.push({ label: `${prefix} screenshot ${i + 1} (${i * vh}-${i * vh + height}px from top)`, dataUrl: `data:image/jpeg;base64,${b64}` })
  }
  // the footer, when the tiles stopped before it
  if (h > n * vh) {
    const y = Math.max(0, h - vh)
    const b64 = await page
      .screenshot({ type: 'jpeg', quality: JPEG_QUALITY, encoding: 'base64', clip: { x: 0, y, width: w, height: h - y }, captureBeyondViewport: true })
      .catch(() => null)
    if (b64) out.push({ label: `${prefix} screenshot of the page bottom / footer`, dataUrl: `data:image/jpeg;base64,${b64}` })
  }
  return out
}

/** Facts screenshots cannot show, measured in the DOM so they never vary between runs. */
function readFacts(page: Page) {
  return page.evaluate(() => {
    const vis = (el: Element) => {
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'
    }
    const label = (el: Element) =>
      (((el as HTMLElement).innerText || '').trim() || el.getAttribute('aria-label') || el.getAttribute('title') || (el.querySelector('img') as HTMLImageElement | null)?.alt || '')
        .replace(/\s+/g, ' ')
        .slice(0, 60)
    const imgs = Array.from(document.images)
    let blackText = 0
    let blackBg = 0
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      if (!vis(el)) continue
      const s = getComputedStyle(el)
      if (s.color === 'rgb(0, 0, 0)' && Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || '').trim())) blackText++
      if (s.backgroundColor === 'rgb(0, 0, 0)') blackBg++
    }
    const header =
      document.querySelector('header, [role="banner"], #shopify-section-header, [class*="site-header" i]') ||
      Array.from(document.querySelectorAll('body *')).find((e) => {
        const r = e.getBoundingClientRect()
        return r.top < 5 && r.height > 40 && r.height < 250 && r.width > window.innerWidth * 0.8
      }) ||
      null
    const headerControls = header
      ? Array.from(header.querySelectorAll('a, button, input, [role="button"]'))
          .filter(vis)
          .map((e) => {
            const tag = e.tagName.toLowerCase()
            const href = (e as HTMLAnchorElement).getAttribute?.('href') || ''
            const cls = (e.getAttribute('class') || '').slice(0, 60)
            return `${tag}${tag === 'input' ? `[${(e as HTMLInputElement).type}] placeholder="${(e as HTMLInputElement).placeholder}"` : ''} "${label(e)}"${href ? ` href=${href.slice(0, 80)}` : ''}${cls ? ` class=${cls}` : ''}`
          })
          .slice(0, 60)
      : []
    const footer = document.querySelector('footer, [role="contentinfo"]') || Array.from(document.querySelectorAll('[class*="footer" i], [id*="footer" i]')).pop() || null
    const ld = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      .flatMap((s) => {
        try {
          const j = JSON.parse(s.textContent || '')
          return ([] as any[]).concat(j).flatMap((x) => x['@type'] || (x['@graph'] || []).map((g: any) => g['@type']))
        } catch {
          return ['(invalid)']
        }
      })
    const fonts: Record<string, number> = {}
    for (const el of Array.from(document.querySelectorAll('h1,h2,h3,p,button,a,li'))) {
      if (!vis(el)) continue
      const f = getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, '')
      fonts[f] = (fonts[f] || 0) + 1
    }
    const buyForm = document.querySelector('form[action*="/cart/add"]')
    const buyBox = buyForm?.closest('section, [class*="product__info" i], [class*="product-info" i], [class*="product-form" i], [class*="product__meta" i]') || buyForm?.parentElement?.parentElement || null
    return {
      pageTitle: document.title,
      language: document.documentElement.lang,
      h1: Array.from(document.querySelectorAll('h1')).filter(vis).map((h) => (h as HTMLElement).innerText.trim()).slice(0, 3),
      header: { found: !!header, controls: headerControls },
      breadcrumb: (document.querySelector('nav[aria-label*="breadcrumb" i], [class*="breadcrumb" i], [itemtype*="BreadcrumbList"]') as HTMLElement | null)?.innerText?.trim().replace(/\s+/g, ' ').slice(0, 150) || null,
      buyBox: buyBox ? (buyBox as HTMLElement).innerText.replace(/\n{2,}/g, '\n').slice(0, 2500) : null,
      buyBoxInputs: buyForm
        ? Array.from(buyForm.querySelectorAll('input, select'))
            .filter((i) => (i as HTMLInputElement).type !== 'hidden')
            .map((i) => {
              const el = i as HTMLInputElement
              return `${el.type || el.tagName.toLowerCase()} name=${el.name} value=${String(el.value).slice(0, 30)}${el.checked ? ' CHECKED' : ''}${el.disabled ? ' disabled' : ''}`
            })
            .slice(0, 40)
        : [],
      images: {
        total: imgs.length,
        lazyLoaded: imgs.filter((i) => i.loading === 'lazy' || !!(i as HTMLImageElement).dataset.src || /lazy/i.test(i.className)).length,
        missingAlt: imgs.filter((i) => !i.hasAttribute('alt')).length,
        modernFormat: imgs.filter((i) => /\.(webp|avif)|format=(webp|avif)|fm=(webp|avif)/i.test(i.currentSrc || i.src)).length,
      },
      videos: Array.from(document.querySelectorAll('video, iframe[src*="youtube"], iframe[src*="vimeo"], iframe[data-src*="youtube"], iframe[data-src*="vimeo"]')).map((v) => ({
        tag: v.tagName.toLowerCase(),
        preload: (v as HTMLVideoElement).preload || null,
        loading: v.getAttribute('loading'),
        autoplay: (v as HTMLVideoElement).autoplay || false,
        visible: vis(v),
      })),
      pureBlack: { textElements: blackText, backgroundElements: blackBg },
      fonts,
      structuredData: ld,
      buttons: Array.from(new Set(Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"], a[class*="btn" i], a[class*="button" i]')).filter(vis).map(label).filter(Boolean))).slice(0, 70),
      footer: footer
        ? {
            text: (footer as HTMLElement).innerText.replace(/\n{2,}/g, '\n').slice(0, 2500),
            links: Array.from(footer.querySelectorAll('a')).map((a) => `${label(a)} -> ${a.href.slice(0, 90)}`).slice(0, 90),
            inputs: Array.from(footer.querySelectorAll('input')).map((i) => `${i.type}:${i.placeholder || i.name}`),
          }
        : null,
      backToTopControl: !!Array.from(document.querySelectorAll('a, button')).find(
        (e) => /back to top|scroll to top|naar boven|terug naar boven|haut de page|retour en haut|volver arriba|nach oben/i.test(`${(e as HTMLElement).innerText} ${e.getAttribute('aria-label') || ''} ${e.getAttribute('class') || ''}`) || /^#(top|page-top|pagetop|back-to-top|scroll-top)$/i.test(e.getAttribute('href') || ''),
      ),
      socialLinks: Array.from(new Set(Array.from(document.querySelectorAll('a[href]')).map((a) => (a as HTMLAnchorElement).hostname).filter((h) => /instagram|facebook|tiktok|youtube|pinterest|linkedin|twitter|x\.com/.test(h)))),
      thirdPartyScripts: Array.from(new Set(Array.from(document.scripts).map((s) => s.src).filter(Boolean).map((s) => { try { return new URL(s).hostname } catch { return '' } }).filter((h) => h && h !== location.hostname))).slice(0, 40),
      pageHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
    }
  })
}

/** Text inside closed tabs / accordions, which innerText leaves out. */
function readHiddenText(page: Page) {
  return page
    .evaluate(() => {
      const parts: string[] = []
      for (const el of Array.from(document.querySelectorAll('details, [role="tabpanel"], [class*="accordion" i], [class*="collapsible" i], [class*="tab-content" i], [class*="tabs__content" i]'))) {
        const s = getComputedStyle(el)
        const hidden = s.display === 'none' || s.visibility === 'hidden' || (el as HTMLElement).offsetHeight < 5 || (el.tagName === 'DETAILS' && !(el as HTMLDetailsElement).open)
        if (!hidden) continue
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim()
        if (t.length > 20 && !parts.some((p) => p.includes(t) || t.includes(p))) parts.push(t.slice(0, 1200))
      }
      return parts.join('\n---\n').slice(0, 6000)
    })
    .catch(() => '')
}

// Trackers, chat widgets and video streams: heavy, and never needed to judge the page.
const BLOCK_HOSTS = /(googletagmanager|google-analytics|doubleclick|googleadservices|facebook\.net|connect\.facebook|hotjar|clarity\.ms|tiktok|snapchat|pinterest\.com\/ct|bing\.com|criteo|taboola|outbrain|gorgias|intercom|zendesk|tidio|crisp\.chat|trustpilot\.com\/tracking|segment\.(com|io)|mixpanel|amplitude|fullstory|heap|newrelic|sentry|datadog|optimizely|vwo|abtasty|convert\.com|klaviyo\.com\/onsite|privy|justuno|attentive|postscript)/i

async function prepare(page: Page) {
  // some bundlers wrap named functions in __name(); make it exist inside the page too
  await page.evaluateOnNewDocument('window.__name = function (f) { return f }').catch(() => {})
  await page.setRequestInterception(true).catch(() => {})
  page.on('request', (req) => {
    try {
      const type = req.resourceType()
      if (type === 'media' || type === 'websocket' || type === 'eventsource' || BLOCK_HOSTS.test(req.url())) return void req.abort().catch(() => {})
      void req.continue().catch(() => {})
    } catch {}
  })
}

/** Open the page; a slow page that has in fact rendered is good enough. */
async function open(page: Page, url: string) {
  let res = null
  try {
    res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 })
  } catch (e) {
    const rendered = await page.evaluate(() => (document.body?.innerText || '').length).catch(() => 0)
    if (rendered < 500) throw e
  }
  await page.waitForNetworkIdle({ idleTime: 800, timeout: 7000 }).catch(() => {})
  return res
}

/** One item into the Shopify cart, then the header again: does the cart icon show the count? */
async function cartTest(page: Page): Promise<{ note: string; tile?: Tile }> {
  const note = await page
    .evaluate(async () => {
      try {
        const r = await fetch(location.pathname.replace(/\/$/, '') + '.js')
        if (!r.ok) return 'not a Shopify product endpoint'
        const prod = await r.json()
        const v = prod.variants.find((x: any) => x.available) || prod.variants[0]
        const a = await fetch('/cart/add.js', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ id: v.id, quantity: 1 }] }) })
        const c = await (await fetch('/cart.js')).json()
        return a.ok ? `one item added, cart now holds ${c.item_count}` : `add to cart refused (${a.status})`
      } catch (e) {
        return 'cart test failed'
      }
    })
    .catch(() => 'cart test failed')
  if (!note.startsWith('one item')) return { note }
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {})
  await new Promise((r) => setTimeout(r, 2500))
  await clean(page)
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {})
  const badge = await page
    .evaluate(() => {
      const scope = document.querySelector('header, [role="banner"], #shopify-section-header') || document.body
      const cartish = Array.from(scope.querySelectorAll('a[href*="/cart"], button[aria-controls*="cart" i], [class*="cart" i], [id*="cart" i], [data-cart-count], [class*="bag" i]'))
      for (const el of cartish) {
        const r = el.getBoundingClientRect()
        if (r.top > 260 || r.width === 0) continue
        const t = ((el as HTMLElement).innerText || el.getAttribute('data-cart-count') || '').replace(/\s+/g, ' ').trim()
        const m = t.match(/(^|\D)([1-9]\d?)(\D|$)/)
        if (m && t.length < 40) return m[2]
      }
      return null
    })
    .catch(() => null)
  const noteWithBadge = badge ? `${note}; the cart icon now shows "${badge}"` : `${note}; no number found next to the cart icon in the page code`
  const b64 = await page.screenshot({ type: 'jpeg', quality: 70, encoding: 'base64', clip: { x: 0, y: 0, width: DESKTOP.width, height: 200 } }).catch(() => null)
  return { note: noteWithBadge, tile: b64 ? { label: 'desktop header AFTER one item was added to the cart', dataUrl: `data:image/jpeg;base64,${b64}` } : undefined }
}

/** Warm serverless instances keep /tmp between scans: drop Chrome profiles left by scans that ended badly. */
function sweepStaleProfiles() {
  try {
    const dir = os.tmpdir()
    const cutoff = Date.now() - 6 * 60 * 1000 // older than the longest possible scan
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith('puppeteer_dev_chrome_profile-')) continue
      const full = path.join(dir, name)
      try {
        if (fs.statSync(full).mtimeMs < cutoff) fs.rmSync(full, { recursive: true, force: true })
      } catch {}
    }
  } catch {}
}

export async function captureEvidence(rawUrl: string): Promise<Evidence> {
  const t0 = Date.now()
  sweepStaleProfiles()
  const browser = await launchPuppeteerBrowser({ windowSizeArg: `--window-size=${DESKTOP.width},${DESKTOP.height}` })
  try {
    // Desktop first, then mobile: one tab at a time keeps the serverless browser within memory.
    const desktop = await browser.newPage()
    await desktop.setViewport({ width: DESKTOP.width, height: DESKTOP.height })
    await desktop.setUserAgent(DESKTOP_UA)
    await desktop.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })
    await prepare(desktop)
    const res = await open(desktop, rawUrl).catch((e) => {
      throw new PageCheckError('unreachable', `We couldn't open this page (${String(e?.message || e).slice(0, 80)}).`)
    })

    // page check: is this really the product page?
    const status = res?.status() ?? 200
    const finalUrl = desktop.url()
    const title = await desktop.title().catch(() => '')
    const bodyText = await desktop.evaluate(() => document.body?.innerText || '').catch(() => '')
    if (status === 404 || status === 410 || NOT_FOUND.test(title))
      throw new PageCheckError('not_found', 'This page returns "page not found". Check the link and try again.')
    if ((status === 403 || status === 429 || status === 503 || bodyText.length < 1500) && BOT_WALL.test(`${title} ${bodyText.slice(0, 2000)}`))
      throw new PageCheckError('blocked', 'This store blocks automated visits, so we could not see the page.')
    const wantedPath = new URL(rawUrl).pathname
    const gotPath = new URL(finalUrl).pathname
    if (/\/products?\//.test(wantedPath) && !/\/products?\//.test(gotPath))
      throw new PageCheckError('redirected', 'This link redirects away from the product page (the product may be gone). Try another product URL.')

    await clean(desktop)
    await scrollForLazyContent(desktop)
    await clean(desktop)
    const facts = await readFacts(desktop).catch((e) => {
      console.warn('[scanV2] facts failed', String(e).slice(0, 200))
      return {}
    })
    const text = await desktop.evaluate(() => (document.body.innerText || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n')).catch(() => '')
    const hiddenText = await readHiddenText(desktop)
    const desktopTiles = await tiles(desktop, 'desktop', DESKTOP.width, DESKTOP.height, DESKTOP.tiles)
    const cart = await cartTest(desktop)
    await desktop.close().catch(() => {})

    let mobileTiles: Tile[] = []
    let mobileFacts: Record<string, unknown> = {}
    try {
      const mobile = await browser.newPage()
      await mobile.setViewport({ width: MOBILE.width, height: MOBILE.height, isMobile: true, hasTouch: true, deviceScaleFactor: 1 })
      await mobile.setUserAgent(MOBILE_UA)
      await prepare(mobile)
      await open(mobile, rawUrl)
      await clean(mobile)
      await scrollForLazyContent(mobile)
      await clean(mobile)
      mobileFacts = await mobile
        .evaluate(() => ({ viewportMeta: document.querySelector('meta[name="viewport"]')?.getAttribute('content') || null, horizontalScroll: document.documentElement.scrollWidth > window.innerWidth + 5 }))
        .catch(() => ({}))
      mobileTiles = await tiles(mobile, 'mobile', MOBILE.width, MOBILE.height, MOBILE.tiles)
      await mobile.close().catch(() => {})
    } catch (e) {
      console.warn('[scanV2] mobile capture failed', String(e).slice(0, 200))
    }

    return {
      url: rawUrl,
      finalUrl,
      status,
      title,
      desktopTiles,
      mobileTiles,
      cartHeader: cart.tile,
      cartTest: cart.note,
      text: text.slice(0, 14000),
      hiddenText,
      facts: facts as Record<string, unknown>,
      mobileFacts: mobileFacts as Record<string, unknown>,
      loadMs: Date.now() - t0,
    }
  } finally {
    const proc = browser.process()
    await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 5000))])
    try {
      proc?.kill('SIGKILL')
    } catch {}
  }
}
