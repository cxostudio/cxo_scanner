// Scan engine v2, step 1: collect the evidence a CRO reviewer needs, once per page.
//   - desktop (1440) and mobile (390) screenshots, cut into viewport tiles + the footer
//   - visible text, hidden tab/accordion text, header/footer links, measured DOM facts
//   - the header after one item is added to the cart (Shopify), for the cart-count check
//   - the cart view after that (drawer or cart page), desktop and mobile, for cart checkpoints
//   - a page check first: 404s, redirects away from the product, bot walls
import type { Page } from 'puppeteer-core'
import puppeteer from 'puppeteer-core'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { launchPuppeteerBrowser } from '@/lib/puppeteer/launchPuppeteer'
import { detectPageTypeFromUrl, type UrlPageType } from '@/lib/conversionCheckpoints/pageType'

export type Tile = { label: string; dataUrl: string }
export type Evidence = {
  url: string
  finalUrl: string
  status: number
  title: string
  desktopTiles: Tile[]
  mobileTiles: Tile[]
  /** Product tabs the scanner opened (Description, Ingredients, Results...), one screenshot each. */
  tabTiles?: Tile[]
  /** The product gallery as a shopper swipes through it, read from the page: one overview picture. */
  galleryTile?: Tile
  /** The whole product gallery, from Shopify's product data (off by default, see index.ts). */
  galleryTiles?: Tile[]
  cartHeader?: Tile
  cartTest?: string
  /** What opens from the header cart icon with one item in the cart: a drawer, or the cart page. */
  cartView?: Tile
  mobileCartView?: Tile
  /** The /cart page as well, when the icon opened a drawer (both are judged, the drawer first). */
  cartPage?: Tile[]
  mobileCartPage?: Tile[]
  /** The first step of checkout with one item in the cart (contact and delivery form, order summary, express buttons). */
  checkout?: Tile[]
  mobileCheckout?: Tile[]
  /** Why checkout could not be captured (bot check, redirect, not Shopify...). */
  checkoutNote?: string
  /** Why the shipping methods could not be shown after the test address. */
  checkoutShippingNote?: string
  /** Lines from the product page that promise something about shipping (cost, threshold, time). */
  shippingPromises?: string[]
  /** Visible text of the checkout first step (desktop). */
  checkoutText?: string
  /** The cart opened BEFORE anything is added (empty-cart checkpoints). */
  emptyCart?: Tile
  /** The mobile navigation after tapping the menu button. */
  mobileMenu?: Tile
  /** False when the page does not sell online (only "Find in store" / "Where to buy"). */
  sellsOnline?: boolean
  /** Homepage, category, product or other: decides the judge's instructions. */
  pageType?: UrlPageType
  /** 'drawer' when the icon opens a drawer, 'page' when it goes to /cart, 'none' when nothing opened. */
  cartKind?: 'drawer' | 'page' | 'none'
  isShopify?: boolean
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
const MOBILE_MAX = 9
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const JPEG_QUALITY = 55

const BOT_WALL = /verify you are human|are you a robot|security check(point)?|checking your browser|attention required|access denied|captcha|just a moment\.\.\.|pardon our interruption|request unsuccessful/i
const NOT_FOUND = /\b404\b|page not found|pagina niet gevonden|page introuvable|página no encontrada|seite nicht gefunden|pagina non trovata/i

/**
 * Does the hero change by itself? Screenshots cannot show motion, so read what is visible in the hero
 * (below the header and announcement bar) twice, 7 seconds apart, without touching the page.
 * A video playing does not count as a slide change; a rotating announcement bar is outside the zone.
 */
async function heroMotion(page: Page) {
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {})
  const read = () =>
    page.evaluate(() => {
      const vh = window.innerHeight
      const top = 140
      const seen: string[] = []
      const inZone = (r: DOMRect) => r.width > 120 && r.height > 60 && r.bottom > top + 40 && r.top < vh && r.left < window.innerWidth && r.right > 0
      const shown = (el: Element) => {
        let n: Element | null = el
        while (n && n !== document.body) {
          const cs = getComputedStyle(n)
          if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.2 || cs.position === 'fixed') return false
          n = n.parentElement
        }
        return true
      }
      for (const img of Array.from(document.images)) {
        const r = img.getBoundingClientRect()
        if (inZone(r) && shown(img)) seen.push(`img:${(img.currentSrc || img.src).split('?')[0].slice(-80)}@${Math.round(r.left / 20)}`)
      }
      for (const h of Array.from(document.querySelectorAll('h1,h2,h3,p,a.button,a[class*="btn"],button'))) {
        const r = h.getBoundingClientRect()
        const t = (h as HTMLElement).innerText?.trim()
        if (t && t.length < 120 && r.top > top && r.top < vh && r.left >= 0 && r.right <= window.innerWidth && shown(h)) seen.push(`t:${t}`)
      }
      const zone = Array.from(document.querySelectorAll('*')).filter((el) => {
        const r = el.getBoundingClientRect()
        return r.top < vh && r.bottom > top && r.height > 200
      })
      const lib = zone.map((el) => (typeof el.className === 'string' ? el.className : '')).join(' ').match(/\b(swiper|slick|splide|flickity|glide|owl-carousel|keen-slider|slideshow|carousel|slider)\b/i)
      const pause = Array.from(document.querySelectorAll('button,[role="button"]')).some((b) => {
        const r = b.getBoundingClientRect()
        const l = `${b.getAttribute('aria-label') || ''} ${(b as HTMLElement).innerText || ''}`
        return r.top < vh && /pause|stop (the )?(slide|rotation|autoplay)/i.test(l)
      })
      const video = Array.from(document.querySelectorAll('video')).some((v) => {
        const r = v.getBoundingClientRect()
        return inZone(r) && shown(v)
      })
      return { seen: [...new Set(seen)].sort(), lib: lib ? lib[1].toLowerCase() : null, pause, video }
    })
  const a = await read().catch(() => null)
  if (!a) return undefined
  await new Promise((r) => setTimeout(r, 7000))
  const b = await read().catch(() => null)
  if (!b) return undefined
  const before = new Set(a.seen)
  const after = new Set(b.seen)
  const appeared = [...after].filter((x) => !before.has(x))
  const gone = [...before].filter((x) => !after.has(x))
  const changed = appeared.length + gone.length >= 2 && appeared.length > 0 && gone.length > 0
  return {
    changedByItself: changed,
    note: changed
      ? 'Between two readings 7 seconds apart, without any scroll or click, the hero showed different images or text: it rotates on its own.'
      : 'Between two readings 7 seconds apart, without any scroll or click, the hero stayed the same: it does not rotate on its own within 7 seconds.',
    sliderLibrary: a.lib,
    pauseButton: a.pause,
    heroVideo: a.video,
    examples: changed ? { before: gone.slice(0, 3), after: appeared.slice(0, 3) } : undefined,
  }
}

/**
 * Desktop checks screenshots cannot answer, read from the live page: redirects on the way in and on
 * menu links, the tab title when the shopper switches tabs, an exit-intent pop-up, how inline links are
 * styled, web fonts, and how videos are set up. Each part returns null when it cannot tell.
 */
async function desktopProbes(page: Page, entryRedirects: number) {
  const out: Record<string, unknown> = { entryRedirects }
  out.linkRedirects = await page
    .evaluate(async () => {
      const here = location.origin
      const hrefs = Array.from(document.querySelectorAll('header a[href], nav a[href], footer a[href]'))
        .map((a) => (a as HTMLAnchorElement).href.split('#')[0])
        .filter((h) => h.startsWith(here) && !/\/(cart|account|search|checkout|customer_authentication|login|logout|localization)/.test(h))
      const unique = Array.from(new Set(hrefs)).slice(0, 12)
      const redirected: string[] = []
      for (const u of unique) {
        try {
          const r = await fetch(u, { method: 'GET', redirect: 'manual', credentials: 'same-origin' })
          if (r.type === 'opaqueredirect' || (r.status >= 300 && r.status < 400)) redirected.push(u.replace(here, ''))
        } catch {}
      }
      return { checked: unique.length, redirected }
    })
    .catch(() => null)
  out.links = await page
    .evaluate(() => {
      const links = Array.from(document.querySelectorAll('main p a[href], main li a[href], article p a[href], [class*="rte" i] a[href], [class*="description" i] p a[href]')).filter((a) => {
        const r = a.getBoundingClientRect()
        const parentText = (a.parentElement?.innerText || '').trim()
        return r.width > 0 && parentText.length > ((a as HTMLElement).innerText || '').trim().length + 15
      })
      if (links.length < 2) return null
      let distinct = 0
      for (const a of links.slice(0, 30)) {
        const cs = getComputedStyle(a)
        const ps = getComputedStyle(a.parentElement as Element)
        const underline = cs.textDecorationLine.includes('underline') || cs.borderBottomStyle !== 'none'
        const color = cs.color !== ps.color
        const weight = Math.abs(Number(cs.fontWeight) - Number(ps.fontWeight)) >= 200
        if (underline || color || weight) distinct++
      }
      return { inline: Math.min(links.length, 30), distinct }
    })
    .catch(() => null)
  out.fontFamilies = await page
    .evaluate(() => {
      const fam = new Set<string>()
      document.fonts.forEach((f) => {
        if (f.status === 'loaded' && !/icon|awesome|material|symbol|glyph/i.test(f.family)) fam.add(f.family.replace(/["']/g, ''))
      })
      return Array.from(fam).slice(0, 12)
    })
    .catch(() => null)
  out.videos = await page
    .evaluate(() =>
      Array.from(document.querySelectorAll('video'))
        .filter((v) => !v.closest('header, footer'))
        .slice(0, 8)
        .map((v) => {
          const r = v.getBoundingClientRect()
          return {
            autoplay: v.autoplay || v.hasAttribute('autoplay'),
            muted: v.muted || v.hasAttribute('muted'),
            poster: !!v.getAttribute('poster'),
            preload: v.getAttribute('preload') || '',
            lazy: !v.getAttribute('src') && !v.querySelector('source[src]'),
            aboveFold: r.top + window.scrollY < window.innerHeight,
          }
        }),
    )
    .catch(() => null)
  // the tab title when the shopper switches to another tab (the page is told it is hidden)
  out.tabTitle = await page
    .evaluate(async () => {
      const before = document.title
      try {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
        document.hasFocus = () => false
      } catch {}
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('blur'))
      await new Promise((r) => setTimeout(r, 2500))
      const after = document.title
      try {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
      } catch {}
      document.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('focus'))
      return { before: before.slice(0, 80), after: after.slice(0, 80), changed: after !== before }
    })
    .catch(() => null)
  // exit intent: the mouse leaves the page through the top edge; does an offer or reminder appear?
  out.exitIntent = await page
    .evaluate(async () => {
      const big = () =>
        Array.from(document.querySelectorAll('body *')).filter((el) => {
          const cs = getComputedStyle(el)
          if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.3) return false
          const r = el.getBoundingClientRect()
          return r.width * r.height > window.innerWidth * window.innerHeight * 0.12 && r.height > 120
        }).length
      const before = big()
      const tools = /klaviyo|privy|optinmonster|justuno|wisepops|poptin|sumo|omnisend|getsitecontrol|optimonk|hellobar|popupsmart|attentive|postscript/i.test(Array.from(document.scripts).map((s) => s.src).join(' '))
      for (const target of [document, document.documentElement, document.body]) {
        target.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, clientX: 600, clientY: -5, relatedTarget: null }))
        target.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true, clientX: 600, clientY: -5, relatedTarget: null }))
      }
      await new Promise((r) => setTimeout(r, 2500))
      return { shown: big() > before, popupTool: tools }
    })
    .catch(() => null)
  return out
}

/** Phone checks: logo sharpness, tap target sizes, how the header behaves on scroll, email field types. */
async function mobileProbes(page: Page) {
  const out: Record<string, unknown> = {}
  out.logo = await page
    .evaluate(() => {
      const head = document.querySelector('header') || document.body
      const cands = Array.from(head.querySelectorAll('a[href="/"] img, a[href="/"] svg, [class*="logo" i] img, [class*="logo" i] svg, img[alt*="logo" i]'))
      const el = cands.find((e) => e.getBoundingClientRect().width > 20)
      if (!el) return null
      const w = el.getBoundingClientRect().width
      if (el.tagName.toLowerCase() === 'svg') return { kind: 'svg', width: Math.round(w) }
      const img = el as HTMLImageElement
      const src = img.currentSrc || img.src
      if (/\.svg(\?|$)/i.test(src)) return { kind: 'svg', width: Math.round(w) }
      const widths = (img.getAttribute('srcset') || '').split(',').map((c) => parseInt((c.trim().split(/\s+/)[1] || '').replace(/w$/, ''), 10)).filter((n) => n > 0)
      const best = Math.max(img.naturalWidth || 0, ...widths)
      return { kind: 'image', width: Math.round(w), bestSource: best, ratio: Math.round((best / w) * 10) / 10 }
    })
    .catch(() => null)
  out.tapTargets = await page
    .evaluate(() => {
      const els = Array.from(document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, [role="button"]')).filter((el) => {
        const r = el.getBoundingClientRect()
        if (r.width < 4 || r.height < 4) return false
        const cs = getComputedStyle(el)
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.2) return false
        // links inside running text are exempt (WCAG target size exception)
        const p = el.closest('p, li')
        if (el.tagName === 'A' && p && (p.textContent || '').trim().length > ((el as HTMLElement).innerText || '').trim().length + 20) return false
        return true
      })
      // on screen horizontally (closed side menus keep a box off to the side)
      const onScreen = els.filter((el) => {
        const r = el.getBoundingClientRect()
        return r.right > 0 && r.left < window.innerWidth
      })
      const centers = onScreen.map((el) => {
        const r = el.getBoundingClientRect()
        return { el, x: r.left + r.width / 2, y: r.top + window.scrollY + r.height / 2, min: Math.min(r.width, r.height) }
      })
      // WCAG 2.2 target size: under 24px is only a problem when another target sits within 24px of its centre
      const small = centers.filter((c) => c.min < 24 && centers.some((o) => o !== c && Math.hypot(o.x - c.x, o.y - c.y) < 24))
      return { total: onScreen.length, small: small.length, examples: small.slice(0, 5).map((c) => ((c.el as HTMLElement).innerText || c.el.getAttribute('aria-label') || c.el.tagName).trim().slice(0, 30)) }
    })
    .catch(() => null)
  out.header = await (async () => {
    const read = () =>
      page.evaluate(() => {
        const cart = Array.from(document.querySelectorAll('a[href*="/cart"], [class*="cart" i] button, button[aria-label*="cart" i], button[aria-label*="bag" i], a[aria-label*="cart" i]')).find((e) => {
          const r = e.getBoundingClientRect()
          return r.width > 0 && r.height > 0
        })
        if (!cart) return null
        let bar: Element | null = cart
        let fixed: Element | null = null
        for (let p: Element | null = cart; p && p !== document.body; p = p.parentElement) {
          const pos = getComputedStyle(p).position
          if (pos === 'fixed' || pos === 'sticky') fixed = p
          bar = p
        }
        const box = (fixed || cart).getBoundingClientRect()
        const r = cart.getBoundingClientRect()
        return { visible: r.bottom > 0 && r.top < window.innerHeight * 0.5, height: Math.round(Math.max(0, Math.min(box.bottom, window.innerHeight) - Math.max(box.top, 0))), sticky: !!fixed }
      })
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {})
    await new Promise((r) => setTimeout(r, 300))
    for (let y = 300; y <= 1500; y += 300) {
      await page.evaluate((v) => window.scrollTo(0, v), y).catch(() => {})
      await new Promise((r) => setTimeout(r, 120))
    }
    await new Promise((r) => setTimeout(r, 500))
    const down = await read().catch(() => null)
    for (let y = 1300; y >= 1000; y -= 100) {
      await page.evaluate((v) => window.scrollTo(0, v), y).catch(() => {})
      await new Promise((r) => setTimeout(r, 120))
    }
    await new Promise((r) => setTimeout(r, 500))
    const up = await read().catch(() => null)
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {})
    return down && up ? { down, up } : null
  })()
  out.emailFields = await page
    .evaluate(() =>
      Array.from(document.querySelectorAll('input')).filter((i) => /e-?mail|courriel/i.test(`${i.name} ${i.id} ${i.placeholder} ${i.getAttribute('aria-label') || ''} ${i.type}`) && i.type !== 'hidden')
        .slice(0, 6)
        .map((i) => ({ type: i.type, inputmode: i.getAttribute('inputmode') || '', autocomplete: i.getAttribute('autocomplete') || '' })),
    )
    .catch(() => null)
  return out
}

/** Google's PageSpeed Insights for the phone: field data from real visitors (CrUX) when Google has it, plus a lab run. */
/** An audit's estimated savings in KiB: 0 when it passes, parsed from "Est savings of 1,295 KiB" otherwise. */
function kib(a: any): number | null {
  if (!a) return null
  if (a.score === 1) return 0
  const m = String(a.displayValue || '').match(/([\d.,]+)\s*(KiB|MiB)/i)
  if (!m) return a.score == null ? null : 0
  const n = parseFloat(m[1].replace(/,/g, ''))
  return Math.round(/MiB/i.test(m[2]) ? n * 1024 : n)
}

async function pageSpeed(url: string) {
  const key = process.env.PAGESPEED_API_KEY ? `&key=${process.env.PAGESPEED_API_KEY}` : ''
  const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile&category=performance&category=accessibility${key}`, { signal: AbortSignal.timeout(55000) })
  if (!res.ok) return { error: `PageSpeed answered ${res.status}` }
  const d = (await res.json()) as any
  const field = (src: any) =>
    src?.metrics
      ? {
          scope: src === d.loadingExperience ? 'page' : 'origin',
          lcpMs: src.metrics.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? null,
          inpMs: src.metrics.INTERACTION_TO_NEXT_PAINT?.percentile ?? null,
          cls: src.metrics.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile != null ? src.metrics.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100 : null,
          overall: src.overall_category || null,
        }
      : null
  const audits = d.lighthouseResult?.audits || {}
  return {
    field: field(d.loadingExperience?.metrics ? d.loadingExperience : null) || field(d.originLoadingExperience),
    lab: { lcpMs: audits['largest-contentful-paint']?.numericValue ?? null, cls: audits['cumulative-layout-shift']?.numericValue ?? null, score: d.lighthouseResult?.categories?.performance?.score ?? null },
    // Lighthouse 13 savings, in KiB, for the measured technical checkpoints (null when the audit is missing)
    savings: {
      imagesKiB: kib(audits['image-delivery-insight']),
      cacheKiB: kib(audits['cache-insight']),
      unminifiedKiB:
        audits['unminified-css'] || audits['unminified-javascript']
          ? Math.round(((audits['unminified-css']?.details?.overallSavingsBytes || 0) + (audits['unminified-javascript']?.details?.overallSavingsBytes || 0)) / 1024)
          : null,
    },
    // accessibility audits used by measured checkpoints: 1 pass, 0 fail, null not run
    a11y: {
      metaViewport: audits['meta-viewport']?.score ?? null,
      imageAlt: audits['image-alt']?.score ?? null,
      imageAltMissing: Array.isArray(audits['image-alt']?.details?.items) ? audits['image-alt'].details.items.length : null,
    },
    lighthouse: d.lighthouseResult?.lighthouseVersion ?? null,
  }
}

/** Accept cookie banners (multilingual), close popups, unroll inner scroll wrappers. */
export async function cleanPage(page: Page, opts: { unroll?: boolean } = {}) {
  const unroll = opts.unroll !== false
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
  // two tags: pop-ups (lifted before opening a cart drawer or a mobile menu, which are modal panels
  // too) and cookie banners (always hidden)
  await page
    .addStyleTag({ content: 'body [aria-modal="true"],body dialog[open],body div[class*="klaviyo" i],body div[id*="klaviyo" i],body [class*="popup-overlay" i],body [class*="modal-backdrop" i]{display:none!important}' })
    .then((h) => h.evaluate((el) => el.setAttribute('id', 'cxo-clean')))
    .catch(() => {})
  await page
    .addStyleTag({ content: '#onetrust-consent-sdk,#didomi-host,#usercentrics-root,#CybotCookiebotDialog,[id*="cookie-banner" i],[class*="cookie-banner" i],[class*="shopify-pc__banner" i]{display:none!important}' })
    .catch(() => {})
  await page
    .evaluate((doUnroll: boolean) => {
      const vw = window.innerWidth
      const vh = window.innerHeight
      // big fixed overlays (newsletter popups, age gates) but never the header bar
      for (const el of Array.from(document.querySelectorAll('body *'))) {
        const s = getComputedStyle(el)
        if (s.position !== 'fixed') continue
        const r = el.getBoundingClientRect()
        const isTopBar = r.top <= 5 && r.height < 220
        // only overlays that actually cover the page: closed drawers and menus sit off screen,
        // transparent or click-through, and must stay openable
        const covering = r.left < vw && r.right > 0 && r.top < vh && r.bottom > 0 && s.visibility !== 'hidden' && Number(s.opacity) > 0.1 && s.pointerEvents !== 'none'
        if (!isTopBar && covering && r.width * r.height > vw * vh * 0.3) {
          ;(el as HTMLElement).style.setProperty('display', 'none', 'important')
          el.setAttribute('data-cxo-hidden', '')
        }
      }
      if (!doUnroll) return
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
    }, unroll)
    .catch(() => {})
}

/**
 * Mobile: is search one tap away in the header bar (icon, button or field), without opening the menu?
 * null when no header bar is found, so the model decides.
 */
async function measureHeaderSearch(page: Page): Promise<boolean | null> {
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {})
  await new Promise((r) => setTimeout(r, 300))
  return page.evaluate(() => {
    const vw = window.innerWidth
    // the header bar is the one holding the cart (an announcement bar above it also matches 'header' classes)
    const bars = Array.from(document.querySelectorAll('header, [role="banner"], #shopify-section-header, [class*="header" i]')).filter((e) => {
      const r = e.getBoundingClientRect()
      return r.top < 120 && r.bottom > 30 && r.height < 240 && r.width > vw * 0.8
    })
    const bar = bars.find((e) => e.querySelector('a[href*="/cart"], [class*="cart" i]')) || bars.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0]
    if (!bar) return null
    // some headers report a tiny box (sticky wrappers): look at least 140px down, never past 220px
    const top = Math.min(220, Math.max(140, ...bars.map((b) => b.getBoundingClientRect().bottom + 10)))
    const SEARCH = /search|zoek|recherch|suche|buscar|cerca/i
    return Array.from(document.querySelectorAll('a, button, input, [role="button"], summary, details-modal, predictive-search')).some((el) => {
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      if (!(r.width > 8 && r.height > 8 && r.top >= 0 && r.top < top && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.1)) return false
      if (el.closest('[aria-modal="true"], dialog, [class*="drawer" i]:not(header *)')) return false
      const meta = [el.getAttribute('aria-label'), el.getAttribute('href'), el.getAttribute('class'), el.getAttribute('id'), el.getAttribute('placeholder'), el.getAttribute('type'), el.getAttribute('name'), el.tagName, el.querySelector('svg')?.getAttribute('class'), el.querySelector('use')?.getAttribute('href'), (el as HTMLElement).innerText].join(' ')
      return SEARCH.test(meta) || (el as HTMLInputElement).type === 'search'
    })
  })
}

/**
 * Two things the model misreads in screenshots, measured in the page code:
 * - activeNav: does the header link to the current page LOOK different from its siblings (bold, underline,
 *   colour, border)? An 'active' class with no visible difference does not count. null when no header link points to this page.
 * - soldOutFirst: how many of the first 4 product cards are marked sold out (category pages).
 */
function readGridAndNav(page: Page) {
  return page.evaluate(() => {
    const path = location.pathname.replace(/\/$/, '').toLowerCase()
    const header = document.querySelector('header, [role="banner"], #shopify-section-header')
    let activeNav: boolean | null = null
    if (header && path && path !== '') {
      const links = Array.from(header.querySelectorAll('a[href]')).filter((a) => (a as HTMLElement).offsetWidth > 0 && ((a as HTMLElement).innerText || '').trim())
      const pathOf = (a: Element) => {
        try {
          return new URL(a.getAttribute('href') || '', location.href).pathname.replace(/\/$/, '').toLowerCase()
        } catch {
          return ''
        }
      }
      const here = links.find((a) => pathOf(a) === path)
      if (here) {
        const look = (el: Element) => {
          const s = getComputedStyle(el)
          const t = el.firstElementChild ? getComputedStyle(el.firstElementChild) : s
          const after = getComputedStyle(el, '::after')
          return [s.fontWeight, s.textDecorationLine, s.color, s.borderBottomWidth, s.borderBottomStyle, t.fontWeight, t.textDecorationLine, after.content !== 'none' ? `${after.width}${after.opacity}${after.transform}${after.backgroundColor}` : ''].join('|')
        }
        const sib = links.filter((a) => a !== here && a.parentElement?.parentElement === here.parentElement?.parentElement).slice(0, 6)
        if (sib.length) activeNav = sib.every((x) => look(x) !== look(here))
      }
    }
    let soldOutFirst: number | null = null
    const SOLD = /sold out|out of stock|épuisé|en rupture|uitverkocht|ausverkauft|agotado|esaurito/i
    const cards: Element[] = []
    const seen = new Set<string>()
    for (const a of Array.from(document.querySelectorAll('main a[href*="/products/"], #MainContent a[href*="/products/"]'))) {
      const href = (a.getAttribute('href') || '').split('?')[0]
      if (seen.has(href) || (a as HTMLElement).offsetWidth === 0) continue
      if (a.closest('header, footer, nav, [class*="drawer" i], [class*="recommend" i]')) continue
      seen.add(href)
      let card: Element = a
      for (let i = 0; i < 6 && card.parentElement; i++) {
        if (card.parentElement.querySelectorAll('a[href*="/products/"]').length > 3) break
        card = card.parentElement
      }
      cards.push(card)
      if (cards.length >= 4) break
    }
    if (cards.length >= 4) soldOutFirst = cards.filter((c) => SOLD.test((c as HTMLElement).innerText || '')).length
    // desktop header: how many visible links go to a collection (the categories), outside any closed menu
    let headerCollections: number | null = null
    if (header) {
      const hrefs = new Set(
        Array.from(header.querySelectorAll('a[href*="/collections/"]'))
          .filter((a) => {
            const r = a.getBoundingClientRect()
            return r.width > 0 && r.height > 0 && r.top < 260 && getComputedStyle(a).visibility !== 'hidden' && ((a as HTMLElement).innerText || '').trim()
          })
          .map((a) => (a.getAttribute('href') || '').split('?')[0]),
      )
      headerCollections = hrefs.size
    }
    const main = document.querySelector('main, #MainContent') as HTMLElement | null
    const soldOutAny = main ? ((main.innerText || '').match(new RegExp(SOLD.source, 'gi')) || []).length : null
    // the page heading a shopper can actually see near the top (a visually hidden H1 does not count)
    let visibleHeading: string | null = null
    const root = document.querySelector('main, #MainContent') || document.body
    for (const h of Array.from(root.querySelectorAll('h1, h2'))) {
      const r = h.getBoundingClientRect()
      const cs = getComputedStyle(h)
      const text = ((h as HTMLElement).innerText || '').trim()
      if (!text || r.width < 20 || r.height < 10 || r.top + scrollY > 900) continue
      if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.1 || cs.clip === 'rect(0px, 0px, 0px, 0px)' || /sr-only|visually-hidden|visuallyhidden/i.test(h.className)) continue
      visibleHeading = text.slice(0, 80)
      break
    }
    return { activeNav, soldOutFirst, soldOutAny, headerCollections, visibleHeading }
  })
}

/** Wait until a sliding cart drawer has finished its animation: the panel holding the checkout button is fully on screen and stops moving. */
async function settleDrawer(page: Page) {
  await new Promise((r) => setTimeout(r, 500))
  let last = ''
  for (let i = 0; i < 15; i++) {
    const box = await page
      .evaluate(() => {
        const CHECKOUT = /subtotal|check ?out|checkout|afrekenen|zur kasse|commander|caisse/i
        // the narrowest fixed container whose text has the checkout: the drawer panel, not the full-screen backdrop
        let best: DOMRect | null = null
        for (const el of Array.from(document.querySelectorAll('body *')) as HTMLElement[]) {
          const cs = getComputedStyle(el)
          if (cs.position !== 'fixed' && el.getAttribute('role') !== 'dialog') continue
          const r = el.getBoundingClientRect()
          if (r.width < 200 || r.width > window.innerWidth * 0.9 || r.height < 200) continue
          if (!CHECKOUT.test((el.innerText || '').slice(0, 3000))) continue
          if (!best || r.width < best.width) best = r
        }
        if (!best) return 'none'
        return `${Math.round(best.left)},${Math.round(best.right)},${best.right <= window.innerWidth + 1 && best.left >= -1 ? 1 : 0}`
      })
      .catch(() => 'none')
    if (box === last && (box === 'none' || box.endsWith(',1'))) return
    last = box
    await new Promise((r) => setTimeout(r, 200))
  }
}

async function scrollForLazyContent(page: Page) {
  await page
    .evaluate(async () => {
      const max = Math.min(Math.max(document.documentElement.scrollHeight, document.body.scrollHeight), 12000)
      for (let y = 0; y < max; y += 700) {
        window.scrollTo(0, y)
        await new Promise((r) => setTimeout(r, 90))
      }
      // the steps never land on the true bottom: stay there long enough for reveal-on-scroll
      // sections (often the footer) to fade in, or they are captured almost transparent
      window.scrollTo(0, max)
      await new Promise((r) => setTimeout(r, 500))
      window.scrollTo(0, 0)
    })
    .catch(() => {})
  // safety net for common reveal-on-scroll systems that have not fired yet (Dawn, AOS, theme attrs)
  await page
    .addStyleTag({ content: '.scroll-trigger--offscreen,[data-aos]:not(.aos-animate),[hdt-reveal]:not([animationend]){opacity:1!important;transform:none!important;transition:none!important;animation:none!important}' })
    .catch(() => {})
  // any other theme's reveal (half-faded testimonials, sections that never appeared): finish it.
  // Only elements with real content and a reveal-style class, never empty overlays.
  await page
    .addStyleTag({ content: '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition:none!important}' })
    .catch(() => {})
  await page
    .evaluate(() => {
      const reveal = /(^|[\s_-])(aos|animate|animated|animation|reveal|fade|appear|scroll-trigger|motion|wow|in-view)/i
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
        const st = getComputedStyle(el)
        if (Number(st.opacity) >= 1 && st.visibility !== 'hidden') continue
        if (!reveal.test(el.className?.toString() || '') && !el.hasAttribute('data-aos') && !el.hasAttribute('data-cascade')) continue
        if (!(el.innerText || '').trim() && !el.querySelector('img, video, svg')) continue
        // never menus, drawers, pop-ups or anything floating: those are hidden on purpose
        if (st.position === 'fixed' || st.position === 'absolute' || el.closest('header, nav, dialog, aside, [role="dialog"], [aria-modal], [aria-hidden="true"], [class*="drawer" i], [class*="modal" i], [class*="popup" i], [class*="menu" i], [class*="dropdown" i], [class*="tooltip" i]')) continue
        el.style.setProperty('opacity', '1', 'important')
        el.style.setProperty('visibility', 'visible', 'important')
        el.style.setProperty('transform', 'none', 'important')
      }
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
        // like Lighthouse: only images a person could see (tracking pixels and hidden images do not need alt text)
        missingAlt: imgs.filter((i) => !i.hasAttribute('alt') && (i as HTMLImageElement).width > 2 && (i as HTMLImageElement).height > 2 && !i.closest('[aria-hidden="true"]')).length,
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
      // preloading of next pages (instant.page, quicklink, speculation rules)
      preloading: {
        speculationRules: !!document.querySelector('script[type="speculationrules"]'),
        scripts: Array.from(document.scripts).map((s) => s.src).filter((src) => /instant\.page|instantclick|quicklink|instant-page|flying-pages/i.test(src)).map((src) => src.slice(0, 80)),
        prefetchLinks: document.querySelectorAll('link[rel="prefetch"], link[rel="prerender"]').length,
      },
      imageHosts: Array.from(new Set(imgs.map((i) => { try { return new URL(i.currentSrc || i.src).hostname } catch { return '' } }).filter(Boolean))).slice(0, 10),
      thirdPartyScripts: Array.from(new Set(Array.from(document.scripts).map((s) => s.src).filter(Boolean).map((s) => { try { return new URL(s).hostname } catch { return '' } }).filter((h) => h && h !== location.hostname))).slice(0, 40),
      pageHeight: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
    }
  })
}

/** Undo cleanPage's pop-up hiding (cookie banners stay hidden): cart drawers and mobile menus are modal panels too. */
async function liftPopupHiding(page: Page) {
  // the overlays cleanPage hid one by one stay hidden: they were covering the page at load (pop-ups)
  await page.evaluate(() => document.querySelectorAll('#cxo-clean').forEach((el) => el.remove())).catch(() => {})
}

/**
 * Hide whatever sits on top of the page and catches the mouse: invisible full-screen iframes
 * (marketing pop-up layers) or leftover overlays. Sampled with elementFromPoint, so closed drawers
 * (pointer-events: none, hidden) are never touched.
 */
async function clearOverlays(page: Page) {
  await page
    .evaluate(() => {
      const vw = window.innerWidth
      const vh = window.innerHeight
      const points = [[vw / 2, vh / 2], [vw * 0.25, vh * 0.3], [vw * 0.75, vh * 0.3], [vw * 0.9, 60], [vw * 0.5, 60]]
      for (let round = 0; round < 3; round++) {
        let hid = false
        for (const [x, y] of points) {
          const el = document.elementFromPoint(x, y) as HTMLElement | null
          if (!el) continue
          const r = el.getBoundingClientRect()
          const pos = getComputedStyle(el).position
          const big = r.width * r.height > vw * vh * 0.4
          if ((el.tagName === 'IFRAME' && big) || (big && (pos === 'fixed' || pos === 'absolute') && !el.closest('main, [role="main"]') && !(el.innerText || '').trim())) {
            el.style.setProperty('display', 'none', 'important')
            hid = true
          }
        }
        if (!hid) break
      }
    })
    .catch(() => {})
}

/**
 * Desktop hover: the add-to-cart button and a few header links, styles before and after a real
 * mouse hover, plus the cursor. Screenshots cannot show this, so it is measured.
 */
async function measureHover(page: Page) {
  await clearOverlays(page)
  const STYLE = ['backgroundColor', 'color', 'borderColor', 'boxShadow', 'opacity', 'transform', 'textDecorationLine', 'filter', 'outlineStyle'] as const
  const targets = await page
    .evaluate(() => {
      const vis = (el: Element) => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight
      }
      const ATC = /add to (cart|bag|basket)|in (de )?winkel(wagen|mand)|ajouter au panier|in den warenkorb|añadir al carrito|aggiungi al carrello|buy now|^add$/i
      const form = document.querySelector('form[action*="/cart/add"]')
      const atc = ((form?.querySelector('button[type="submit"], button[name="add"], input[type="submit"]') as HTMLElement | null) ||
        (Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]')).find((b) => {
          const r = b.getBoundingClientRect()
          return r.width > 80 && r.height > 25 && ATC.test(((b as HTMLElement).innerText || (b as HTMLInputElement).value || b.getAttribute('aria-label') || '').trim())
        }) as HTMLElement | undefined) ||
        null)
      if (atc) atc.setAttribute('data-cxo-atc', '')
      const header = document.querySelector('header, [role="banner"], #shopify-section-header')
      const links = header ? (Array.from(header.querySelectorAll('nav a, a')).filter((a) => vis(a) && ((a as HTMLElement).innerText || '').trim().length > 1).slice(0, 3) as HTMLElement[]) : []
      const out: { kind: string; label: string; x: number; y: number; disabled: boolean }[] = []
      const add = (kind: string, el: HTMLElement) => {
        el.scrollIntoView({ block: 'center' })
        const r = el.getBoundingClientRect()
        out.push({ kind, label: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 40), x: r.left + r.width / 2, y: r.top + r.height / 2, disabled: (el as HTMLButtonElement).disabled === true })
      }
      if (atc && atc.getBoundingClientRect().width > 0) add('addToCart', atc)
      window.scrollTo(0, 0)
      links.forEach((l) => {
        l.setAttribute('data-cxo-link', '')
        add('headerLink', l)
      })
      return out
    })
    .catch(() => [])
  const results: { kind: string; label: string; disabled: boolean; changes: string[]; cursor: string }[] = []
  for (const t of targets) {
    if (t.kind === 'addToCart') {
      await page.evaluate(() => {
        document.querySelector('[data-cxo-atc]')?.scrollIntoView({ block: 'center' })
      }).catch(() => {})
    } else await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {})
    await page.mouse.move(5, 5).catch(() => {})
    await new Promise((r) => setTimeout(r, 150))
    const read = (x: number, y: number) =>
      page.evaluate(
        (x, y, keys) => {
          const el = document.elementFromPoint(x, y)
          const host = (el?.closest('a, button, input, [role="button"]') || el) as HTMLElement | null
          if (!host) return null
          // the link or button itself, its ::before / ::after (animated underlines) and its first child
          const parts: [string, CSSStyleDeclaration][] = [['', getComputedStyle(host)], ['::before', getComputedStyle(host, '::before')], ['::after', getComputedStyle(host, '::after')]]
          if (host.firstElementChild) parts.push([' > *', getComputedStyle(host.firstElementChild)])
          const style: Record<string, string> = {}
          for (const [suffix, cs] of parts) for (const k of [...(keys as string[]), 'width']) style[`${k}${suffix}`] = (cs as any)[k]
          delete style.width // the element's own width does not change on hover; pseudo-element widths do
          return { style, cursor: getComputedStyle(host).cursor, hit: `${host.tagName} ${(host.getAttribute('class') || '').slice(0, 40)} "${((host as HTMLElement).innerText || '').trim().slice(0, 30)}"`, isTarget: host.hasAttribute('data-cxo-atc') || host.hasAttribute('data-cxo-link') }
        },
        x,
        y,
        STYLE as unknown as string[],
      )
    // recompute the centre after scrolling
    const pos = await page
      .evaluate((kind, label) => {
        const els = kind === 'addToCart'
          ? [document.querySelector('[data-cxo-atc]')]
          : Array.from(document.querySelectorAll('header a, [role="banner"] a, #shopify-section-header a')).filter((a) => ((a as HTMLElement).innerText || '').trim().slice(0, 40) === label)
        const el = els[0] as HTMLElement | null | undefined
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
      }, t.kind, t.label)
      .catch(() => null)
    if (!pos) continue
    const before = await read(pos.x, pos.y).catch(() => null)
    await page.mouse.move(pos.x, pos.y, { steps: 3 }).catch(() => {})
    await new Promise((r) => setTimeout(r, 450)) // let transitions finish
    const after = await read(pos.x, pos.y).catch(() => null)
    await page.mouse.move(5, 5).catch(() => {})
    if (!before || !after) continue
    // something else is under the mouse (an invisible overlay): the hover never reached the target
    if (!before.isTarget || !after.isTarget) {
      if (process.env.SCANV2_DEBUG) console.log('[hover] not on target', t.kind, t.label, '->', after.hit)
      continue
    }
    const changes = Object.keys(before.style).filter((k) => before.style[k] !== after.style[k])
    results.push({ kind: t.kind, label: t.label, disabled: t.disabled, changes, cursor: after.cursor })
  }
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {})
  return results
}

/**
 * Sold-out options: how many variants Shopify reports as unavailable, and how many option values the
 * selector visibly marks as unavailable (disabled, struck through, greyed or labelled).
 */
async function measureVariants(page: Page) {
  return page.evaluate(async () => {
    let total = 0
    let soldOut = 0
    let discounted = 0
    let optionNames: string[] = []
    try {
      if (/\/products\//.test(location.pathname)) {
        const r = await fetch(location.pathname.replace(/\/$/, '') + '.js')
        if (r.ok) {
          const p = await r.json()
          total = p.variants.length
          soldOut = p.variants.filter((v: any) => !v.available).length
          discounted = p.variants.filter((v: any) => v.compare_at_price && v.compare_at_price > v.price).length
          optionNames = (p.options || []).map((o: any) => String(typeof o === 'string' ? o : o?.name || ''))
        }
      }
    } catch {}
    const scope = document.querySelector('form[action*="/cart/add"]')?.closest('section, [class*="product" i]') || document.body
    const UNAVAILABLE = /sold|unavailable|disabled|out-of-stock|outofstock|crossed|strike|is-disabled|not-available/i
    const options = Array.from(scope.querySelectorAll('input[type="radio"], [role="radio"], [data-value], [data-option-value], option, button[class*="swatch" i], button[class*="variant" i], label[class*="swatch" i]')).filter((el) => {
      const r = el.getBoundingClientRect()
      return el.tagName === 'OPTION' || el.tagName === 'INPUT' || (r.width > 0 && r.height > 0)
    })
    const marked = options.filter((el) => {
      const label = el.tagName === 'INPUT' ? (el.closest('label') || document.querySelector(`label[for="${el.id}"]`)) : el
      const els = [el, label].filter(Boolean) as Element[]
      return els.some((e) => {
        const cs = getComputedStyle(e)
        return (
          (e as HTMLInputElement).disabled === true ||
          e.getAttribute('aria-disabled') === 'true' ||
          UNAVAILABLE.test(`${e.getAttribute('class') || ''} ${e.getAttribute('data-available') === 'false' ? 'unavailable' : ''}`) ||
          /line-through/.test(cs.textDecorationLine) ||
          /sold out|unavailable|uitverkocht|épuisé|ausverkauft|agotado|esaurito/i.test((e as HTMLElement).innerText || e.textContent || '')
        )
      })
    }).length
    // the main button as the page loads: ready to add (a variant is preselected) or asking for a choice
    const ATC = /add to (cart|bag|basket)|ajouter au panier|in (de )?winkel(wagen|mand)|in den warenkorb|añadir al carrito|aggiungi al carrello|buy now|^add$/i
    const text = (b: Element) => ((b as HTMLElement).innerText || (b as HTMLInputElement).value || b.getAttribute('aria-label') || b.textContent || '').replace(/\s+/g, ' ').trim()
    const visible = (b: Element) => {
      const r = b.getBoundingClientRect()
      return r.width > 80 && r.height > 25
    }
    // the theme's own form first, then any large button that reads like add to cart / choose an option
    const btn = ((document.querySelector('form[action*="/cart/add"] [type="submit"], form[action*="/cart/add"] button[name="add"]') as HTMLButtonElement | null) ||
      (Array.from(document.querySelectorAll('button, input[type="submit"], [role="button"]')).find((b) => visible(b) && (ATC.test(text(b)) || /select (a )?size|choose (a )?(size|option)|kies (een )?maat|sold out|uitverkocht/i.test(text(b)))) as HTMLButtonElement | undefined) ||
      null)
    const atc = btn ? { label: text(btn).slice(0, 40), disabled: btn.disabled === true || btn.getAttribute('aria-disabled') === 'true', ready: ATC.test(text(btn)) } : null
    // option pickers anywhere on the page (kits and bundles carry one per item, outside the theme's form):
    // radio groups and selects named after a colour, size, style or option
    const PICKER = /colou?r|size|style|option|variant|flavou?r|scent|shade/i
    const groups = new Set<string>()
    for (const el of Array.from(document.querySelectorAll('input[type="radio"][name], select[name]'))) {
      if (el.closest('header, footer, aside, dialog, [role="dialog"], [class*="drawer" i], [id*="drawer" i]')) continue
      const name = el.getAttribute('name') || ''
      if (PICKER.test(name) && !/quantity|qty|subscri|frequency|plan|selling/i.test(name)) groups.add(name)
    }
    // stores that sell each colour as its own product (Colourpop shades) show "Color: Me Again" and a row
    // of swatches linking to sibling products: one Shopify variant, but the shopper still picks a shade
    const h1 = document.querySelector('h1')
    let box: Element | null = h1
    for (let k = 0; box && k < 5 && ((box as HTMLElement).innerText || '').length < 400; k++) box = box.parentElement
    const boxText = box ? ((box as HTMLElement).innerText || '').slice(0, 6000) : ''
    const optionLabel = /(^|\n)\s*(colou?r|shade|size|style|scent|flavou?r|finish)\s*:/im.test(boxText)
    // ...or no label at all, only a row of small swatches linking to the sibling products (Martine:
    // 36px shade thumbnails, one per /products/ handle, on one line in the top of the page)
    const rows = new Map<number, Set<string>>()
    for (const a of Array.from(document.querySelectorAll('a[href*="/products/"]'))) {
      if (a.closest('header, footer, nav, dialog, [role="dialog"], [class*="drawer" i], [class*="recommend" i], [class*="related" i]')) continue
      const r = a.getBoundingClientRect()
      const y = r.top + window.scrollY
      if (r.width < 12 || r.width > 90 || r.height > 90 || y > 2200) continue
      const handle = (a.getAttribute('href') || '').split('/products/')[1]?.split(/[?#/]/)[0]
      if (!handle) continue
      const key = Math.round(y / 10)
      rows.set(key, (rows.get(key) || new Set()).add(handle))
    }
    const swatchRow = Array.from(rows.values()).some((s) => s.size >= 3)
    return { optionNames, total, soldOut, discounted, options: options.length, marked, atc, pickers: groups.size + (optionLabel || swatchRow ? 1 : 0) }
  })
}

/**
 * Mobile: scroll well past the main add-to-cart button; is an add-to-cart button still on screen,
 * in a fixed or sticky bar (or the main button itself sticks)?
 */
async function measureStickyAtc(page: Page) {
  return page.evaluate(async () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
    const ATC = /add to (cart|bag|basket)|ajouter au panier|in (de )?winkel(wagen|mand)|in den warenkorb|añadir al carrito|aggiungi al carrello|buy now|select (a )?size|choose (a )?(size|option)|kies (een )?maat/i
    const isAtc = (el: Element) => ATC.test(((el as HTMLElement).innerText || (el as HTMLInputElement).value || el.getAttribute('aria-label') || '').trim())
    const pinned = (el: Element) => {
      for (let e: Element | null = el; e && e !== document.body; e = e.parentElement) {
        const p = getComputedStyle(e).position
        if (p === 'fixed' || p === 'sticky') return true
      }
      return false
    }
    const candidates = () => Array.from(document.querySelectorAll('button, input[type="submit"], a[role="button"], a[class*="btn" i], a[class*="button" i]')).filter(isAtc)
    window.scrollTo(0, 0)
    await sleep(300)
    const main = (document.querySelector('form[action*="/cart/add"] [type="submit"], form[action*="/cart/add"] button[name="add"]') as HTMLElement | null) || (candidates()[0] as HTMLElement | undefined) || null
    if (!main) return null
    const top = main.getBoundingClientRect().top + window.scrollY
    window.scrollTo(0, top + window.innerHeight * 1.5)
    await sleep(1000)
    const onTop = (b: Element) => {
      const r = b.getBoundingClientRect()
      const s = getComputedStyle(b)
      if (r.width < 40 || r.height < 20 || r.top < 0 || r.bottom > window.innerHeight || s.visibility === 'hidden' || Number(s.opacity) < 0.3) return false
      const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return !!h && (h === b || b.contains(h))
    }
    const hit = candidates().find((b) => onTop(b) && pinned(b))
    window.scrollTo(0, 0)
    return { sticky: !!hit, label: hit ? ((hit as HTMLElement).innerText || '').trim().slice(0, 40) : null }
  })
}

/** Text inside closed tabs / accordions, which innerText leaves out. */
/**
 * The product gallery as the shopper sees it, read from the page itself (not Shopify's media list,
 * which mixes every variant's photos): start from the add-to-cart form, climb to the product
 * section, take the images of its gallery in page order, skip slides the theme hides for other
 * variants, recommendations and reviews, dedupe thumbnails. Then lay them out in one numbered
 * overview picture. Fewer than 2 images found → nothing (better no gallery than a wrong one).
 */
async function readGallery(page: Page, sheetToo = false): Promise<{ tile?: Tile; count: number; videos: number; ratios: number[] }> {
  const found = await page
    .evaluate(() => {
      // the buy form, or on headless themes the add-to-cart button itself
      // the main product's buy form: visible, near the top, not a quick-add in a drawer, a card or the header
      const OUTSIDE = 'header, footer, nav, dialog, [class*="recommend" i], [class*="related" i], [class*="card" i], [class*="upsell" i], [class*="quick" i]'
      // a real drawer floats over the page; some themes wrap the whole page in a "drawer-page" container
      const inDrawer = (el: Element) => {
        for (let p: Element | null = el; p && p !== document.body; p = p.parentElement)
          if (/drawer/i.test(String((p as HTMLElement).className)) && /fixed|absolute/.test(getComputedStyle(p).position)) return true
        return false
      }
      const top = (el: Element) => el.getBoundingClientRect().top + window.scrollY
      const form =
        Array.from(document.querySelectorAll('form[action*="/cart/add"]'))
          .filter((f) => f.getBoundingClientRect().width > 0 && !f.closest(OUTSIDE) && !inDrawer(f) && top(f) < 2000)
          .sort((a, b) => top(a) - top(b))[0] ||
        Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]')).find((b) => {
          const t = ((b as HTMLElement).innerText || (b as HTMLInputElement).value || '').trim()
          const r = b.getBoundingClientRect()
          return r.width > 80 && r.top + window.scrollY < 1800 && /add to (cart|bag|basket)|ajouter|in winkelwagen|in den warenkorb|buy now|acheter|añadir/i.test(t) && !b.closest('header, footer, nav, dialog, [class*="drawer" i]')
        })
      if (!form) return null
      const big = (img: HTMLImageElement) => {
        const r = img.getBoundingClientRect()
        if (/\.svg(\?|$)/i.test(img.currentSrc || img.src)) return false
        // slides off-screen in a slider still have a size; swatches and icons are small
        return r.width >= 60 && Math.max(r.width, img.naturalWidth / 3) >= 120
      }
      const hiddenUpTo = (el: Element, stop: Element) => {
        for (let p: Element | null = el; p && p !== stop; p = p.parentElement) {
          if (p.hasAttribute('hidden')) return true
          const cs = getComputedStyle(p)
          if (cs.display === 'none' || cs.visibility === 'hidden') return true
        }
        return false
      }
      const SKIP = '[class*="recommend" i], [class*="related" i], [class*="review" i], [class*="upsell" i], [class*="cross-sell" i], [class*="complementary" i], header, footer, nav, dialog'
      // a picture inside a link to another product is a product card (add-on, "you may also like"), not the gallery
      const here = location.pathname.split('/products/')[1]?.split(/[/?#]/)[0]
      const otherProduct = (img: Element) => {
        const a = img.closest('a[href*="/products/"]')
        const h = a?.getAttribute('href')?.split('/products/')[1]?.split(/[/?#]/)[0]
        return !!h && h !== here
      }
      // the product section: the first ancestor of the buy form that also holds 2+ big images outside the form
      let section: Element | null = form.parentElement
      let imgs: HTMLImageElement[] = []
      for (let k = 0; section && k < 10; k++, section = section.parentElement) {
        imgs = Array.from(section.querySelectorAll('img')).filter((i) => !form.contains(i) && !i.closest(SKIP) && !otherProduct(i) && big(i as HTMLImageElement)) as HTMLImageElement[]
        if (imgs.length >= 2) break
      }
      if (!section || imgs.length < 2) return null
      const key = (src: string) =>
        (src.split('?')[0].split('/').pop() || src)
          .replace(/_(\d+x\d*|\d*x\d+|pico|icon|thumb|small|compact|medium|large|grande|original|master)(?=\.)/i, '')
          .replace(/\.(jpe?g|png|webp|avif|gif)$/i, '')
          .replace(/^[-_]+/, '')
          .toLowerCase()
      const best = (img: HTMLImageElement) => {
        const set = (img.getAttribute('srcset') || img.getAttribute('data-srcset') || '').split(',').map((x) => x.trim().split(/\s+/)[0]).filter(Boolean)
        return img.currentSrc || set[set.length - 1] || img.getAttribute('data-src') || img.src
      }
      const seen = new Set<string>()
      const out: string[] = []
      // the frame each image is shown in, as the shopper sees it (themes crop to one shape): the
      // largest rendered copy of each image, so thumbnails do not stand in for the main slides
      const frames = new Map<string, number>()
      for (const img of imgs) {
        if (hiddenUpTo(img, section)) continue
        const src = best(img)
        if (!src || src.startsWith('data:')) continue
        const k = key(src)
        const r = img.getBoundingClientRect()
        if (r.width >= 120 && r.height >= 60) {
          const prev = frames.get(k)
          if (prev === undefined || r.width > 0) frames.set(k, r.width / r.height)
        }
        if (seen.has(k)) continue
        seen.add(k)
        out.push(src.startsWith('//') ? `https:${src}` : src)
        if (out.length >= 12) break
      }
      const videos = Array.from(section.querySelectorAll('video, iframe[src*="youtube"], iframe[src*="vimeo"], [data-media-type*="video" i]')).filter((v) => !form.contains(v) && !v.closest(SKIP)).length
      return { srcs: out, videos, ratios: Array.from(frames.values()).slice(0, 12) }
    })
    .catch(() => null)
  const ratios = (found?.ratios || []).map((r) => Math.round(r * 100) / 100)
  if (!found || found.srcs.length < 2 || !sheetToo) return { count: found?.srcs.length || 0, videos: found?.videos || 0, ratios }
  // one picture: a numbered grid of every gallery image, 4 per row
  const sheet = await page.browser().newPage()
  try {
    const cols = 4
    const cell = 300
    const rows = Math.ceil(found.srcs.length / cols)
    await sheet.setViewport({ width: cols * (cell + 10) + 10, height: rows * (cell + 10) + 50 })
    const small = (u: string) => (/cdn\.shopify|\/cdn\/shop\//.test(u) ? u.replace(/([?&])width=\d+/, '$1').replace(/[?&]$/, '') + (u.includes('?') ? '&' : '?') + 'width=600' : u)
    const html = `<html><body style="margin:0;padding:10px;background:#fff;font:600 14px sans-serif">
      <div style="height:30px">Product gallery: ${found.srcs.length} image${found.srcs.length > 1 ? 's' : ''}${found.videos ? ` + ${found.videos} video${found.videos > 1 ? 's' : ''}` : ''}, in page order</div>
      <div style="display:grid;grid-template-columns:repeat(${cols},${cell}px);gap:10px">${found.srcs
        .map((u, i) => `<div style="position:relative;width:${cell}px;height:${cell}px;background:#f2f2f2"><img src="${small(u).replace(/"/g, '&quot;')}" style="width:100%;height:100%;object-fit:contain"><span style="position:absolute;left:6px;top:6px;background:#000;color:#fff;padding:2px 7px;border-radius:10px">${i + 1}</span></div>`)
        .join('')}</div></body></html>`
    await sheet.setContent(html, { waitUntil: 'load', timeout: 15000 }).catch(() => {})
    const b64 = (await sheet.screenshot({ type: 'jpeg', quality: 70, encoding: 'base64', fullPage: true })) as string
    return { tile: { label: `gallery overview: the ${found.srcs.length} images of the product gallery, as a shopper swipes through them`, dataUrl: `data:image/jpeg;base64,${b64}` }, count: found.srcs.length, videos: found.videos, ratios }
  } catch {
    return { count: found.srcs.length, videos: found.videos, ratios }
  } finally {
    await sheet.close().catch(() => {})
  }
}

/**
 * Product pages hide a lot in tabs (Description / Ingrédients / Résultats): before/after sliders,
 * how-to steps, ingredient lists. Click each tab of the product content, read what it shows and
 * screenshot it. Desktop only, at most 5 tabs, never in the header, footer or menus.
 */
const TAB_NAMES = "(description|details?|détails|ingr[ée]dients?|composition|r[ée]sultats?|results?|how to use|utilisation|mode d'emploi|conseils?( d'utilisation)?|application|usage|care|entretien|dimensions|specifications?|caractéristiques|materials?|matières|shipping|livraison|faq|questions|benefits|bienfaits|nutrition|ingrediënten|gebruik|delivery|returns?|retours?|verzending)"
/** Product tabs and info rows: one name ('Description'), two joined ('Shipping & Returns', 'Details and care'), or any short row about delivery ('DE Shipping - Fast & Reliable Delivery'). */
const TAB_WORDS = new RegExp(`^(?:[a-z]{2} )?${TAB_NAMES}(?:\\s*(?:&|and|et|en|\\+|/|-)\\s*${TAB_NAMES})?$|\\b(shipping|delivery|livraison|verzending|lieferung)\\b`, 'i')
async function openTabs(page: Page): Promise<{ tiles: Tile[]; text: string }> {
  const found = await page
    .evaluate((src: string) => {
      const words = new RegExp(src, 'i')
      const out: { i: number; name: string }[] = []
      const els = Array.from(document.querySelectorAll('[role="tab"], button, a, li, summary, [class*="tab" i]'))
      for (const el of els) {
        if (out.length >= 5) break
        if (el.closest('header, footer, nav, dialog, [role="dialog"], [class*="drawer" i], [class*="menu" i]')) continue
        const name = ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim()
        if (!name || name.length > 45 || !words.test(name)) continue
        const r = el.getBoundingClientRect()
        if (r.width < 20 || r.height < 12 || el.querySelector('[role="tab"], button')) continue
        // a link to another page is navigation, not a tab
        const href = el.tagName === 'A' ? el.getAttribute('href') || '' : ''
        if (href && !href.startsWith('#') && !href.startsWith('javascript')) continue
        if (out.some((o) => o.name.toLowerCase() === name.toLowerCase())) continue
        el.setAttribute('data-cxo-tab', String(out.length))
        out.push({ i: out.length, name })
      }
      return out
    }, TAB_WORDS.source)
    .catch(() => [] as { i: number; name: string }[])
  const tiles: Tile[] = []
  const texts: string[] = []
  for (const t of found) {
    const sel = `[data-cxo-tab="${t.i}"]`
    try {
      await page.evaluate((s: string) => document.querySelector(s)?.scrollIntoView({ block: 'start' }), sel)
      await page.click(sel).catch(() => page.evaluate((s: string) => (document.querySelector(s) as HTMLElement | null)?.click(), sel))
      await new Promise((r) => setTimeout(r, 500))
      const box = await page.evaluate((s: string) => {
        const el = document.querySelector(s)
        if (!el) return null
        // the block that holds the tabs and their panel: the first ancestor tall enough to hold content
        let p: Element | null = el
        for (let k = 0; k < 5 && p && p.getBoundingClientRect().height < 250; k++) p = p.parentElement
        const r = el.getBoundingClientRect()
        return { y: Math.max(0, r.top + window.scrollY - 20), text: ((p as HTMLElement | null)?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 1500) }
      }, sel)
      if (!box) continue
      if (box.text) texts.push(`[${t.name}] ${box.text}`)
      const b64 = await page.screenshot({ type: 'jpeg', quality: JPEG_QUALITY, encoding: 'base64', clip: { x: 0, y: box.y, width: DESKTOP.width, height: DESKTOP.height }, captureBeyondViewport: true }).catch(() => null)
      if (b64) tiles.push({ label: `desktop product tab "${t.name}" opened`, dataUrl: `data:image/jpeg;base64,${b64}` })
    } catch {}
  }
  return { tiles, text: texts.join('\n---\n').slice(0, 6000) }
}

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

/** What the page actually downloaded: image formats (by content type, since Shopify serves WebP
 *  without saying so in the URL) and whether images come through a CDN (response headers). */
type NetStats = { images: Record<string, number>; cdnImages: number; imageResponses: number; thirdPartyScripts?: string[]; fontFiles?: string[] }
const NET = new WeakMap<Page, NetStats>()
const CDN_HEADERS = /^(cf-ray|cf-cache-status|x-amz-cf-id|x-served-by|x-cache|x-fastly-request-id|akamai-cache-status|x-akamai|server-timing|x-cdn|cdn-cache|x-shopid|x-shardid)$/i

export function netStats(page: Page): NetStats | null {
  return NET.get(page) || null
}

async function prepare(page: Page) {
  const stats: NetStats = { images: {}, cdnImages: 0, imageResponses: 0, thirdPartyScripts: [], fontFiles: [] }
  NET.set(page, stats)
  page.on('response', (res) => {
    try {
      if (res.request().resourceType() !== 'image') return
      const headers = res.headers()
      const type = (headers['content-type'] || '').split(';')[0].replace('image/', '').trim() || 'unknown'
      stats.images[type] = (stats.images[type] || 0) + 1
      stats.imageResponses++
      if (Object.keys(headers).some((h) => CDN_HEADERS.test(h)) || /cloudflare|cloudfront|akamai|fastly|varnish/i.test(headers['server'] || '') || /HIT|MISS/i.test(headers['x-cache'] || '')) stats.cdnImages++
    } catch {}
  })
  // some bundlers wrap named functions in __name(); make it exist inside the page too
  await page.evaluateOnNewDocument('window.__name = function (f) { return f }').catch(() => {})
  // layout shift from the first paint, read before the scanner touches the page (cleanPage hides popups)
  await page
    .evaluateOnNewDocument(`(() => { window.__cxoCls = 0; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cxoCls += e.value }).observe({ type: 'layout-shift', buffered: true }) } catch (e) { window.__cxoCls = null } })()`)
    .catch(() => {})
  if (process.env.SCANV2_NOBLOCK) return
  await page.setRequestInterception(true).catch(() => {})
  page.on('request', (req) => {
    try {
      const type = req.resourceType()
      let host = ''
      try {
        host = new URL(req.url()).hostname
      } catch {}
      const pageHost = (() => {
        try {
          return new URL(page.url()).hostname.replace(/^www\./, '')
        } catch {
          return ''
        }
      })()
      // never block the store's own files (themes bundle scripts with tracker-like names)
      const firstParty = !!pageHost && (host === pageHost || host.endsWith(`.${pageHost}`) || host.replace(/^www\./, '') === pageHost)
      // what the page asks for, before we block anything: third-party script hosts and font files
      // (the platform's own CDN is not a third party)
      if (type === 'script' && !firstParty && host && !/(^|\.)(shopify\.com|shopifycloud\.com|shopifysvc\.com|myshopify\.com)$/.test(host) && !stats.thirdPartyScripts!.includes(host)) stats.thirdPartyScripts!.push(host)
      if (type === 'font' && stats.fontFiles!.length < 60) stats.fontFiles!.push(req.url().split('?')[0].slice(-120))
      if (type === 'media' || (!firstParty && BLOCK_HOSTS.test(host))) {
        if (process.env.SCANV2_DEBUG) console.log('[blocked]', type, req.url().slice(0, 110))
        return void req.abort().catch(() => {})
      }
      void req.continue().catch(() => {})
    } catch {}
  })
}

/** Open the page; a slow page that has in fact rendered is good enough. */
/**
 * Footer tap targets on a phone: for every visible footer link or button, the size of its tappable box
 * and the distance to the nearest other target (centre to centre). A small link is still easy to tap
 * when its neighbours are far enough away, so a target counts as comfortable when nothing else sits
 * within 36px of its centre, or its own box is 44px tall (Apple's minimum).
 */
/**
 * The cookie banner as a phone visitor first sees it: how much of the screen it covers and whether
 * rejecting is one tap, like accepting. Our servers sit outside the EU, so many stores show no banner
 * at all to the scanner: `found: false` then means "not seen", never "the store has none".
 */
async function readCookieBanner(page: Page) {
  return page.evaluate(() => {
    const KNOWN = '#onetrust-banner-sdk,#onetrust-consent-sdk,#didomi-host,#usercentrics-root,#CybotCookiebotDialog,[id*="cookie" i],[class*="cookie" i],[class*="consent" i],[id*="consent" i],[class*="shopify-pc__banner" i]'
    const vw = window.innerWidth
    const vh = window.innerHeight
    const boxes = Array.from(document.querySelectorAll(KNOWN)).filter((el) => {
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > vw * 0.5 && r.height > 40 && r.bottom > 0 && r.top < vh && /cookie|consent|traceur|privacy|confidentialit/i.test((el as HTMLElement).innerText || '')
    })
    if (!boxes.length) return { found: false }
    const el = boxes.sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0]
    const r = el.getBoundingClientRect()
    const covered = (Math.min(r.bottom, vh) - Math.max(r.top, 0)) / vh
    const buttons = Array.from(el.querySelectorAll('button, a, [role="button"]')).map((b) => ((b as HTMLElement).innerText || '').trim().toLowerCase()).filter(Boolean)
    const ACCEPT = /accept|allow|agree|ok|got it|accepter|j'accepte|akkoord|akzeptieren|aceptar|accetta/
    const REJECT = /reject|decline|refuse|deny|refuser|continuer sans|necessary only|only necessary|nécessaires|weigeren|ablehnen|rechazar|rifiuta/
    return {
      found: true,
      coversPct: Math.round(covered * 100),
      accept: buttons.some((t) => ACCEPT.test(t)),
      reject: buttons.some((t) => REJECT.test(t)),
      buttons: buttons.slice(0, 6),
    }
  })
}

/**
 * A pop-up on landing (newsletter, discount, age gate) as a phone visitor first sees it, read before
 * cleanPage hides it: how much of the screen it covers and whether it has a visible close button.
 */
async function readPopup(page: Page) {
  return page.evaluate(() => {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const cands = Array.from(document.querySelectorAll('[aria-modal="true"], dialog[open], [role="dialog"], div[class*="klaviyo" i], div[id*="klaviyo" i], [class*="popup" i], [class*="modal" i], [id*="popup" i]')).filter((el) => {
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.1) return false
      if (r.width < vw * 0.6 || r.height < vh * 0.2 || r.bottom <= 0 || r.top >= vh) return false
      const t = ((el as HTMLElement).innerText || '').toLowerCase()
      // cookie banners, cart drawers and menus are judged elsewhere
      // country or language pickers only appear to visitors from another country (our server): not a pop-up a shopper gets
      if (/country|pays|langue|language|region|région|ship(ping)? to|livraison vers|bon endroit|right place|land kiezen|choose your (location|store)/.test(t)) return false
      return t.length > 10 && !/cookie|consent|traceur/.test(t) && !/(cart|panier|winkelwagen|warenkorb)\b/.test(t.slice(0, 60))
    })
    if (!cands.length) return { found: false }
    const el = cands.sort((a, b) => b.getBoundingClientRect().height * b.getBoundingClientRect().width - a.getBoundingClientRect().height * a.getBoundingClientRect().width)[0]
    const r = el.getBoundingClientRect()
    const covers = Math.round(((Math.min(r.bottom, vh) - Math.max(r.top, 0)) * (Math.min(r.right, vw) - Math.max(r.left, 0))) / (vw * vh) * 100)
    const close = Array.from(el.querySelectorAll('button, [role="button"], a')).map((b) => ({ b, r: b.getBoundingClientRect(), t: (((b as HTMLElement).innerText || '') + ' ' + (b.getAttribute('aria-label') || '')).toLowerCase() }))
      .filter((x) => x.r.width > 0 && /close|fermer|sluiten|schließen|×|✕|no thanks|non merci|nee bedankt/.test(x.t))
    const biggest = close.reduce((m, x) => Math.max(m, Math.min(x.r.width, x.r.height)), 0)
    return { found: true, coversPct: covers, close: close.length > 0, closeSize: Math.round(biggest), text: ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').slice(0, 120) }
  })
}

/**
 * Videos on the page and the section each sits in (its nearest heading), read after the page was
 * scrolled to the bottom so lazy sections are loaded. Screenshots only show a video's first frame:
 * without this the judge misses UGC video carousels ("Les Martin.e les ont testé").
 */
async function readVideos(page: Page) {
  return page.evaluate(() => {
    const heading = (el: Element) => {
      for (let p: Element | null = el; p && p !== document.body; p = p.parentElement) {
        const h = p.querySelector('h1, h2, h3, h4, [class*="heading" i], [class*="title" i]')
        const t = ((h as HTMLElement | null)?.innerText || '').trim()
        if (t) return t.slice(0, 80)
      }
      return ''
    }
    const vids = Array.from(document.querySelectorAll('video, iframe[src*="youtube"], iframe[src*="vimeo"], iframe[src*="tiktok"], iframe[data-src*="youtube"]'))
    const sections = new Map<string, number>()
    for (const v of vids) {
      if (v.closest('header, footer')) continue
      const k = heading(v) || '(no heading)'
      sections.set(k, (sections.get(k) || 0) + 1)
    }
    return { count: vids.length, sections: Array.from(sections.entries()).map(([section, n]) => ({ section, videos: n })).slice(0, 8) }
  })
}

async function measureFooterTargets(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)).catch(() => {})
  await new Promise((r) => setTimeout(r, 600))
  return page.evaluate(() => {
    // the footer with the most links (themes also use "footer" in class names for small blocks inside cards)
    const footer = Array.from(document.querySelectorAll('footer, [role="contentinfo"], #shopify-section-footer, [class*="footer" i]')).sort((a, b) => b.querySelectorAll('a[href]').length - a.querySelectorAll('a[href]').length)[0]
    if (!footer) return null
    // links inside a closed accordion keep a layout box but are clipped away (max-height: 0, overflow
    // hidden): a shopper can't tap them, so they don't count. Accordion toggles do.
    const clipped = (el: Element, r: DOMRect) => {
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const cs = getComputedStyle(p)
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return true
        if (/hidden|clip|auto|scroll/.test(cs.overflow + cs.overflowY)) {
          const pr = p.getBoundingClientRect()
          if (cy < pr.top || cy > pr.bottom || cx < pr.left || cx > pr.right) return true
        }
      }
      return !!el.closest('details:not([open])') && el.tagName !== 'SUMMARY' && !el.closest('summary')
    }
    // themes that build accordion headers from plain divs only give them a pointer cursor; social icons
    // are left out: small and close together on most stores, rarely tapped, not part of the shop links
    const SEL = 'a[href], button, summary, [role="button"], [aria-expanded]'
    const SOCIAL = /instagram|tiktok|facebook|youtube|pinterest|twitter|x\.com|linkedin|snapchat|threads\.net/i
    const direct = Array.from(footer.querySelectorAll(SEL)).filter((el) => !SOCIAL.test(el.getAttribute('href') || ''))
    const pointer = Array.from(footer.querySelectorAll('div, span, li, h2, h3, h4, p')).filter((e) => {
      const t = ((e as HTMLElement).innerText || '').trim()
      return t.length >= 2 && t.length <= 40 && !e.querySelector(SEL) && !e.closest(SEL) && getComputedStyle(e).cursor === 'pointer'
    })
    const all = [...direct, ...pointer]
    const targets = all.filter((e) => !all.some((o) => o !== e && e.contains(o)))
    const boxes = targets
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ el, r }) => r.width > 0 && r.height > 0 && !clipped(el, r))
      .map(({ r }) => r)
      .map((r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2, h: r.height, w: r.width }))
    if (boxes.length < 4) return null
    let comfortable = 0
    const gaps: number[] = []
    const nearestOf: number[] = []
    for (const b of boxes) {
      let nearest = Infinity
      for (const o of boxes) if (o !== b) nearest = Math.min(nearest, Math.hypot(o.x - b.x, o.y - b.y))
      gaps.push(nearest)
      nearestOf.push(nearest)
      if (nearest >= 36 || b.h >= 44) comfortable++
    }
    gaps.sort((a, b) => a - b)
    const heights = boxes.map((b) => b.h).sort((a, b) => a - b)
    return {
      targets: boxes.length,
      comfortable,
      medianHeight: Math.round(heights[Math.floor(heights.length / 2)]),
      typicalGap: Math.round(gaps[Math.floor(gaps.length / 2)]),
      // each target's nearest neighbour and height, so the thresholds can change without a re-scan
      links: boxes.map((b, i) => [Math.round(nearestOf[i]), Math.round(b.h)]),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 2,
    }
  })
}

/** The page shows a bot check (Cloudflare and the like) instead of the store. */
async function walled(page: Page) {
  const title = await page.title().catch(() => '')
  const text = await page.evaluate(() => (document.body?.innerText || '').slice(0, 2000)).catch(() => '')
  return text.length < 1500 && (BOT_WALL.test(`${title} ${text}`) || /verify you are human|needs to be verified/i.test(text))
}

/**
 * Speed apps (Avada, Hyperspeed, WP Rocket-style loaders) park the theme's scripts as type="text/lazyload"
 * until a real visitor moves or taps. Our visit never does, so the theme stays in its no-JS state: variant
 * pickers hidden, cart drawers and chat widgets never load. Nudge them like a visitor would, then run the
 * parked scripts in page order. Consent-blocked scripts (type text/plain) are left alone.
 */
async function runDelayedScripts(page: Page) {
  const DELAYED = 'script[type="text/lazyload"],script[type="lazyload"],script[type="rocketlazyloadscript"],script[type="text/rocketlazyloadscript"],script[type*="delay" i],script[type="text/speedyscript"],script[type="text/boostjs"]'
  const parked = await page.evaluate((sel: string) => document.querySelectorAll(sel).length, DELAYED).catch(() => 0)
  if (!parked) return
  await page
    .evaluate(() => {
      for (const t of ['mousemove', 'mousedown', 'touchstart', 'keydown', 'scroll', 'wheel', 'pointerdown']) for (const x of [window, document]) x.dispatchEvent(new Event(t, { bubbles: true }))
    })
    .catch(() => {})
  await new Promise((r) => setTimeout(r, 1500))
  await page
    .evaluate(async (sel: string) => {
      const list = Array.from(document.querySelectorAll(sel)) as HTMLScriptElement[]
      for (const old of list) {
        const s = document.createElement('script')
        for (const a of Array.from(old.attributes)) if (a.name !== 'type') s.setAttribute(a.name, a.value)
        const src = old.getAttribute('src') || old.getAttribute('data-src')
        if (src) {
          s.src = src
          s.async = false
          await new Promise<void>((r) => {
            s.onload = s.onerror = () => r()
            old.replaceWith(s)
            setTimeout(r, 3000)
          })
        } else {
          s.textContent = old.textContent
          old.replaceWith(s)
        }
      }
    }, DELAYED)
    .catch(() => {})
  await page.waitForNetworkIdle({ idleTime: 600, timeout: 5000 }).catch(() => {})
}

async function open(page: Page, url: string) {
  let res = null
  try {
    res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 })
  } catch (e) {
    const rendered = await page.evaluate(() => (document.body?.innerText || '').length).catch(() => 0)
    if (rendered < 500) throw e
  }
  await page.waitForNetworkIdle({ idleTime: 800, timeout: 7000 }).catch(() => {})
  await runDelayedScripts(page)
  return res
}

/** One item into the Shopify cart, then the header again: does the cart icon show the count? */
async function cartTest(page: Page): Promise<{ note: string; tile?: Tile }> {
  const note = await page
    .evaluate(async () => {
      try {
        // the variant: from the product JSON, or from the theme's own add-to-cart form when that JSON is
        // blocked (bot protection sometimes refuses /products/x.js after a few page loads)
        let id: string | number | null = null
        const r = await fetch(location.pathname.replace(/\/$/, '') + '.js').catch(() => null)
        if (r && r.ok) {
          const prod = await r.json()
          const v = prod.variants.find((x: any) => x.available) || prod.variants[0]
          id = v?.id ?? null
        }
        if (!id) id = (document.querySelector('form[action*="/cart/add"] [name="id"]') as HTMLInputElement | null)?.value || null
        if (!id) return `not a Shopify product endpoint (${r ? r.status : 'no answer'}, page: ${document.title.slice(0, 40)})`
        const a = await fetch('/cart/add.js', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ id: Number(id), quantity: 1 }] }) })
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
  await cleanPage(page)
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {})
  const badge = await page
    .evaluate(async () => {
      const find = () => {
      // the cart count can sit in the link text ("Cart (1)"), an aria-label ("Cart, 1 item"),
      // a data attribute or a small badge element next to the icon
      const CART = /cart|bag|basket|panier|winkel|mand|warenkorb|carrito|cesta|carrello|koszyk/i
      const nodes = Array.from(document.querySelectorAll('body *')).filter((el) => {
        const r = el.getBoundingClientRect()
        return r.top < 260 && r.bottom > 0 && r.width > 0 && r.height > 0
      })
      for (const el of nodes) {
        const own = ((el as HTMLElement).innerText || el.textContent || '').replace(/\s+/g, ' ').trim()
        const aria = el.getAttribute('aria-label') || el.getAttribute('title') || ''
        const data = el.getAttribute('data-cart-count') || el.getAttribute('data-count') || el.getAttribute('data-cart-item-count') || ''
        if (data && /^[1-9]\d?$/.test(data)) return data
        for (const t of [aria, own]) {
          if (t.length > 40 || !CART.test(t)) continue
          const m = t.match(/(?:\(|\b)([1-9]\d?)(?:\)|\b)/)
          if (m) return m[1]
        }
        // a lone number inside or right next to a cart link / button
        if (/^[1-9]\d?$/.test(own)) {
          const host = el.closest('a, button, [class*="cart" i], [class*="bag" i], [id*="cart" i]')
          const label = host ? `${host.getAttribute('href') || ''} ${host.getAttribute('aria-label') || ''} ${host.getAttribute('class') || ''} ${host.id || ''}` : ''
          if (CART.test(label)) return own
        }
      }
      return null
      }
      // headers often hydrate the count a few seconds after load
      for (let i = 0; i < 12; i++) {
        const hit = find()
        if (hit) return hit
        await new Promise((r) => setTimeout(r, 500))
      }
      return null
    })
    .catch(() => null)
  if (process.env.SCANV2_DEBUG) console.log('[cart debug]', await page.evaluate(() => Array.from(document.querySelectorAll('button[aria-label], a[href*="cart"]')).filter((e) => e.getBoundingClientRect().top < 260).slice(0, 8).map((e) => `${e.tagName} aria=${e.getAttribute('aria-label')} inner=${JSON.stringify((e as HTMLElement).innerText)} text=${JSON.stringify(e.textContent?.trim().slice(0, 20))} top=${Math.round(e.getBoundingClientRect().top)}`).join(' | ')).catch((e) => String(e)))
  const noteWithBadge = badge ? `${note}; the cart icon now shows "${badge}"` : `${note}; no number found next to the cart icon in the page code`
  const b64 = await page.screenshot({ type: 'jpeg', quality: 70, encoding: 'base64', clip: { x: 0, y: 0, width: DESKTOP.width, height: 200 } }).catch(() => null)
  return { note: noteWithBadge, tile: b64 ? { label: 'desktop header AFTER one item was added to the cart', dataUrl: `data:image/jpeg;base64,${b64}` } : undefined }
}

/**
 * Open the cart from the header (one item is already in it) and capture what opens:
 * a cart drawer, or the cart page when the icon links there. Undefined when no cart control is found.
 */
async function cartView(page: Page, device: 'desktop' | 'mobile', width: number, height: number): Promise<Tile | undefined> {
  await topWithHeader(page)
  // undo cleanPage's popup hiding: it also hides the (closed) cart drawer
  await liftPopupHiding(page)
  await clearOverlays(page)
  // find the cart control in the header, then click it with a real mouse click (themes ignore synthetic clicks)
  const point = await page
    .evaluate(() => {
      const CART = /\b(cart|bag|basket|panier|winkelwagen|winkelmand|mand|warenkorb|carrito|cesta|carrello|koszyk)\b/i
      const scored = Array.from(document.querySelectorAll('a[href], button, [role="button"]'))
        .map((el) => {
          const r = el.getBoundingClientRect()
          if (r.top > 260 || r.bottom <= 0 || r.width === 0 || r.height === 0 || r.width > 300) return null
          if (r.left >= window.innerWidth || r.right <= 0) return null // off-screen (a closed drawer's own buttons)
          // something a shopper can actually tap: its centre is on screen and not covered by another element
          const cx = r.left + r.width / 2
          const cy = r.top + r.height / 2
          const hit = cy > 0 && cy < window.innerHeight ? document.elementFromPoint(cx, cy) : null
          const tappable = !!hit && (el === hit || el.contains(hit) || hit.contains(el))
          const href = el.getAttribute('href') || ''
          const aria = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`
          const meta = `${el.id} ${el.getAttribute('class') || ''} ${el.getAttribute('data-action') || ''}`
          const text = ((el as HTMLElement).innerText || '').trim()
          if (/add to|ajouter|toevoegen|in den|añadir|aggiungi|close|fermer|sluiten|schließen|cerrar|chiudi/i.test(`${aria} ${text}`)) return null
          let score = 0
          if (/\/cart\/?($|\?|#)/.test(href)) score += 3
          if (CART.test(aria)) score += 2
          if (/cart|bag|basket|minicart/i.test(meta)) score += 1
          if (text.length < 20 && CART.test(text)) score += 1
          return score ? { score: score + (tappable ? 10 : 0), x: cx, y: cy, toCartPage: /\/cart\/?($|\?|#)/.test(href) } : null
        })
        .filter(Boolean) as { score: number; x: number; y: number; toCartPage: boolean }[]
      scored.sort((a, b) => b.score - a.score || b.x - a.x)
      return scored[0] || null
    })
    .catch(() => null)
  if (process.env.SCANV2_DEBUG) console.log('[cart view]', device, JSON.stringify(point), await page.evaluate((p) => { if (!p) return null; const e = document.elementFromPoint(p.x, p.y); return e ? `${e.tagName} ${e.getAttribute('aria-label') || ''} ${(e.getAttribute('class') || '').slice(0, 50)}` : null }, point).catch(String))
  // some themes open the drawer by themselves after add-to-cart: clicking the icon would close it again
  const alreadyOpen = await page
    .evaluate(() => {
      const CART = /cart|bag|basket|panier|winkel|warenkorb|carrito|carrello|koszyk/i
      const CHECKOUT = /subtotal|check ?out|checkout|afrekenen|zur kasse/i
      for (const y of [0.3, 0.5, 0.8]) {
        let el = document.elementFromPoint(window.innerWidth - 160, window.innerHeight * y) as HTMLElement | null
        for (let k = 0; el && k < 8; k++, el = el.parentElement) {
          if (getComputedStyle(el).position === 'fixed' || /DIALOG|DRAWER|MODAL|CART/.test(el.tagName) || el.getAttribute('role') === 'dialog') {
            const t = (el.innerText || '').slice(0, 1500)
            if (CART.test(t) && CHECKOUT.test(t) && el.getBoundingClientRect().width < window.innerWidth * 0.8) return true
            break
          }
        }
      }
      return false
    })
    .catch(() => false)
  if (alreadyOpen) {
    await settleDrawer(page)
    const b64 = await page.screenshot({ type: 'jpeg', quality: JPEG_QUALITY, encoding: 'base64', clip: { x: 0, y: 0, width, height } }).catch(() => null)
    if (b64) return { label: `${device} cart view after one item was added (the cart drawer)`, dataUrl: `data:image/jpeg;base64,${b64}` }
  }
  if (!point) return undefined
  const startUrl = page.url()
  // remember the floating panels already on screen, so a drawer that appears can be told apart
  await page
    .evaluate(() => {
      for (const el of Array.from(document.querySelectorAll('body *'))) {
        const s = getComputedStyle(el)
        if (s.position !== 'fixed' && s.position !== 'absolute' && el.tagName !== 'DIALOG') continue
        const r = el.getBoundingClientRect()
        if (r.width > 240 && r.height > 200 && r.left < window.innerWidth - 100 && r.right > 100 && s.visibility !== 'hidden' && s.display !== 'none') el.setAttribute('data-cxo-before', '')
      }
      const parts: string[] = []
      for (const y of [0.3, 0.5, 0.8]) {
        let el = document.elementFromPoint(window.innerWidth - 160, window.innerHeight * y) as HTMLElement | null
        for (let k = 0; el && k < 8; k++, el = el.parentElement) {
          if (getComputedStyle(el).position === 'fixed' || /DIALOG|DRAWER|MODAL|CART/.test(el.tagName) || el.getAttribute('role') === 'dialog') {
            parts.push((el.innerText || '').slice(0, 1500))
            break
          }
        }
      }
      ;(window as any).__cxoSideBefore = parts.join(' ')
    })
    .catch(() => {})
  // a link to /cart may still open a drawer (themes intercept it): watch for a navigation, but not forever
  const nav = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: point.toCartPage ? 10000 : 4000 }).catch(() => null)
  await page.mouse.click(point.x, point.y).catch(() => {})
  await Promise.race([nav, new Promise((r) => setTimeout(r, point.toCartPage ? 10000 : 2500))])
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 4000 }).catch(() => {})
  await new Promise((r) => setTimeout(r, 800))
  // only keep the screenshot if a cart actually opened: the cart page, or a visible drawer / dialog
  const opened = await page
    .evaluate((before) => {
      if (/\/cart\/?($|\?)/.test(location.pathname) && location.href !== before) return 'page'
      const CART = /cart|bag|basket|panier|winkel|warenkorb|carrito|carrello|koszyk/i
      // a floating panel that is on screen now, was not before the click, and is about the cart
      const drawer = Array.from(document.querySelectorAll('body *')).find((el) => {
        if (el.hasAttribute('data-cxo-before')) return false
        const s = getComputedStyle(el)
        if (s.position !== 'fixed' && s.position !== 'absolute' && el.tagName !== 'DIALOG') return false
        const r = el.getBoundingClientRect()
        const onScreen = r.width > 240 && r.height > 200 && r.left < window.innerWidth - 100 && r.right > 100 && r.top < window.innerHeight - 100 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.5
        return onScreen && CART.test(`${el.id} ${el.getAttribute('class') || ''} ${el.getAttribute('aria-label') || ''} ${((el as HTMLElement).innerText || '').slice(0, 400)}`)
      })
      if (drawer) return 'drawer'
      // fallback for drawers the panel scan misses (custom elements, panels nested in an existing
      // fixed layer): what sits on the right side of the screen now reads like a cart, and did not before
      const CHECKOUT = /subtotal|check ?out|checkout|afrekenen|paiement|zur kasse|total/i
      const sideText = () => {
        const parts: string[] = []
        for (const y of [0.3, 0.5, 0.8]) {
          let el = document.elementFromPoint(window.innerWidth - 160, window.innerHeight * y) as HTMLElement | null
          for (let k = 0; el && k < 8; k++, el = el.parentElement) {
            const s = getComputedStyle(el)
            if (s.position === 'fixed' || /DIALOG|DRAWER|MODAL|CART/.test(el.tagName) || el.getAttribute('role') === 'dialog') {
              parts.push((el.innerText || '').slice(0, 1500))
              break
            }
          }
        }
        return parts.join(' ')
      }
      const now = sideText()
      return CHECKOUT.test(now) && CART.test(now) && !CHECKOUT.test((window as any).__cxoSideBefore || '') ? 'drawer' : null
    }, startUrl)
    .catch(() => null)
  if (process.env.SCANV2_DEBUG) console.log('[cart view] opened:', opened, page.url(), await page.evaluate(() => { const out: string[] = []; let el = document.elementFromPoint(window.innerWidth - 160, window.innerHeight * 0.5) as HTMLElement | null; for (let k = 0; el && k < 10; k++, el = el.parentElement) out.push(`${el.tagName}.${(el.getAttribute('class') || '').slice(0, 30)} pos=${getComputedStyle(el).position} shadow=${!!el.shadowRoot} txt=${(el.innerText || '').length}`); return out.join(' > ') + ' | before=' + String((window as any).__cxoSideBefore).slice(0, 80) }).catch(String))
  if (!opened) return undefined
  if (opened === 'drawer') await settleDrawer(page)
  const b64 = await page.screenshot({ type: 'jpeg', quality: JPEG_QUALITY, encoding: 'base64', clip: { x: 0, y: 0, width, height } }).catch(() => null)
  if (!b64) return undefined
  const where = opened === 'page' ? 'the cart page' : 'the cart drawer'
  return { label: `${device} cart view after one item was added (${where})`, dataUrl: `data:image/jpeg;base64,${b64}` }
}

/**
 * Mobile: tap the menu button in the header and capture the navigation that opens.
 * Kept only if a new panel with several links appeared (no screenshot of a closed menu).
 */
/**
 * Back to the top with the header showing. Headers that hide while scrolling down only come back on a
 * real scroll UP (wheel events), not on a jump to the top, so scroll down a little and wheel back up.
 */
async function topWithHeader(page: Page) {
  await page.evaluate(() => window.scrollTo(0, 300)).catch(() => {})
  await new Promise((r) => setTimeout(r, 150))
  for (let k = 0; k < 3; k++) await page.mouse.wheel({ deltaY: -400 }).catch(() => {})
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {})
  await new Promise((r) => setTimeout(r, 500))
}

async function mobileMenu(page: Page, width: number, height: number): Promise<Tile | undefined> {
  await topWithHeader(page)
  // the menu is a modal panel: cleanPage would keep it hidden
  await liftPopupHiding(page)
  await clearOverlays(page)
  const point = await page
    .evaluate(() => {
      const MENU = /\b(menu|menü|navigation|nav|hamburger|burger|open menu|ouvrir le menu|menu openen|menú)\b/i
      const scored = Array.from(document.querySelectorAll('button, a, [role="button"], summary, label'))
        .map((el) => {
          const r = el.getBoundingClientRect()
          if (r.top > 200 || r.bottom <= 0 || r.width === 0 || r.height === 0 || r.width > 120 || r.left >= window.innerWidth) return null
          const aria = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.getAttribute('aria-controls') || ''}`
          const meta = `${el.id} ${el.getAttribute('class') || ''} ${el.getAttribute('for') || ''} ${el.getAttribute('data-action') || ''}`
          const text = ((el as HTMLElement).innerText || '').trim()
          if (/cart|bag|basket|search|account|login|close/i.test(`${aria} ${meta}`)) return null
          let score = 0
          if (MENU.test(aria)) score += 3
          if (/menu|burger|hamburger|nav-toggle|drawer-toggle|header__icon--menu|mobile-nav/i.test(meta)) score += 2
          if (text.length < 12 && MENU.test(text)) score += 1
          return score ? { score, x: r.left + r.width / 2, y: r.top + r.height / 2 } : null
        })
        .filter(Boolean) as { score: number; x: number; y: number }[]
      scored.sort((a, b) => b.score - a.score || a.x - b.x)
      // mark what is on screen now, to tell the opened menu apart
      return scored[0] || null
    })
    .catch(() => null)
  if (!point) return undefined
  // labels a shopper can see and tap right now: on screen and on top (elementFromPoint). Some themes
  // keep the menu in the page all the time and only make it tappable when open; an open menu also
  // covers page links, so we compare WHICH labels are tappable, not how many.
  const tappable = () =>
    page
      .evaluate(() =>
        Array.from(new Set(
          Array.from(document.querySelectorAll('a[href], button, summary, [role="menuitem"]'))
            .filter((el) => {
              const r = el.getBoundingClientRect()
              if (r.width < 20 || r.height < 12 || r.top < 0 || r.bottom > window.innerHeight || r.left < 0 || r.right > window.innerWidth) return false
              const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
              return !!hit && (hit === el || el.contains(hit))
            })
            .map((el) => ((el as HTMLElement).innerText || el.getAttribute('aria-label') || '').trim().toLowerCase().slice(0, 40))
            .filter((t) => t.length > 1),
        )),
      )
      .catch(() => [] as string[])
  const before = await tappable()
  const newLabels = (now: string[]) => now.filter((t) => !before.includes(t)).length
  // a phone: touch first (some menus only listen to touch). Menus slide in, so poll for up to 3 s.
  const settle = async () => {
    let now = before
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 500))
      now = await tappable()
      if (newLabels(now) >= 4) break
    }
    return now
  }
  await page.touchscreen.tap(point.x, point.y).catch(() => {})
  let after = await settle()
  // a click only if the tap changed nothing at all: a second toggle would close a menu that did open
  if (after.join('|') === before.join('|')) {
    await page.mouse.click(point.x, point.y).catch(() => {})
    after = await settle()
  }
  // the menu opened when several new entries became tappable
  const opened = newLabels(after) >= 4
  if (process.env.SCANV2_DEBUG) console.log('[mobile menu]', JSON.stringify(point), 'new tappable labels:', newLabels(after), after.filter((t) => !before.includes(t)).slice(0, 8).join(' | '))
  if (!opened) return undefined
  const b64 = await page.screenshot({ type: 'jpeg', quality: JPEG_QUALITY, encoding: 'base64', clip: { x: 0, y: 0, width, height } }).catch(() => null)
  return b64 ? { label: 'mobile MENU opened (after tapping the menu button)', dataUrl: `data:image/jpeg;base64,${b64}` } : undefined
}

/** The cart page itself (Shopify always serves /cart), top of the page in up to `max` viewport tiles. */
async function cartPage(page: Page, device: 'desktop' | 'mobile', width: number, height: number, max: number): Promise<Tile[]> {
  const origin = new URL(page.url()).origin
  const res = await page.goto(`${origin}/cart`, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null)
  await runDelayedScripts(page)
  if (!res || res.status() >= 400) return []
  await page.waitForNetworkIdle({ idleTime: 600, timeout: 5000 }).catch(() => {})
  // some stores (headless, drawer-only) redirect /cart elsewhere: then there is no cart page
  if (!/\/cart\/?$/.test(new URL(page.url()).pathname)) return []
  await cleanPage(page)
  const all = await tiles(page, `${device} cart page`, width, height, max)
  // the footer is already in the product page tiles
  return all.filter((t) => !/footer/i.test(t.label)).map((t) => ({ ...t, label: t.label.replace(`${device} cart page screenshot`, `${device} CART PAGE (/cart) screenshot`) }))
}

/**
 * The first step of checkout, with the item already in the cart. We never type anything: no email, no
 * address, so no abandoned checkout is created and no recovery email is sent. Bot checks are reported, never guessed.
 */
async function checkoutStep(page: Page, device: 'desktop' | 'mobile', width: number, height: number, max: number, entry?: string, country?: string, fill = true): Promise<{ tiles: Tile[]; note?: string; text?: string; shippingNote?: string }> {
  const origin = entry ? new URL(entry).origin : new URL(page.url()).origin
  // Shopify's checkout refuses obvious automation: look like the browser we are
  await page
    .evaluateOnNewDocument(() => {
      Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false })
    })
    .catch(() => {})
  // `entry`: a cart permalink (/cart/<variant>:<qty>), which builds the cart and lands on checkout by itself
  let res = await page.goto(entry || `${origin}/checkout`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => null)
  if (!res) return { tiles: [], note: 'checkout did not load' }
  // "There was a problem with our checkout": one reload, as the page itself suggests
  await new Promise((r) => setTimeout(r, 2500))
  if (await page.evaluate(() => /problem with (our|the) checkout|try again in a few minutes/i.test(document.body?.innerText || '')).catch(() => false)) {
    res = await page.reload({ waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => res)
  }
  // Shopify's checkout is a heavy app: wait for its form, not just the network
  await page
    .waitForSelector('input[type="email"], input[autocomplete="email"], input[name*="email" i], input[autocomplete="tel"], input[name="address1"], input[autocomplete="shipping address-line1"]', { timeout: 20000 })
    .catch(() => {})
  await page.waitForNetworkIdle({ idleTime: 800, timeout: 6000 }).catch(() => {})
  await new Promise((r) => setTimeout(r, 800))
  const state = await page
    .evaluate(() => {
      const t = (document.body?.innerText || '').slice(0, 4000)
      const bot = /verify (that )?you are (a )?human|are you a robot|captcha|checking your browser|access denied|unusual traffic|problem with (our|the) checkout|try again in a few minutes/i.test(t) || !!document.querySelector('iframe[src*="captcha"], iframe[src*="challenge"]')
      const form = !!document.querySelector('input[type="email"], input[autocomplete="email"], input[name*="email" i], input[autocomplete="tel"], input[name="address1"], input[autocomplete="shipping address-line1"]')
      return { bot, form, url: location.href, text: (document.body?.innerText || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').slice(0, 6000) }
    })
    .catch(() => ({ bot: false, form: false, url: '', text: '' }))
  // a form on screen means we got in: Shopify's own checkout carries hCaptcha / reCAPTCHA notices
  if (state.bot && !state.form) return { tiles: [], note: `the checkout refused our automated visit (bot check or error page); page says: ${state.text.replace(/\s+/g, ' ').slice(0, 160)}` }
  // express buttons (Shop Pay, Apple Pay, PayPal) render last: give them a moment
  await new Promise((r) => setTimeout(r, 2500))
  if (!state.form) return { tiles: [], note: `no checkout form found (${new URL(state.url || origin).pathname}); page says: ${state.text.replace(/\s+/g, ' ').slice(0, 160)}` }
  // a public address (no email, no phone) makes Shopify show its shipping methods
  // desktop only: the methods are the same on mobile, and the scan has to fit the function's time limit
  const shippingNote = entry && fill ? await revealShipping(page, country).catch(() => 'could not fill the test address') : undefined
  const text = entry && fill ? await page.evaluate(() => (document.body?.innerText || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').slice(0, 8000)).catch(() => state.text) : state.text
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {})
  // Shopify's checkout scrolls inside a column, so the document looks one screen tall: grow the viewport to the content
  const inner = await page
    .evaluate(() => Math.max(...Array.from(document.querySelectorAll('body, body *')).map((e) => (e as HTMLElement).scrollHeight || 0)))
    .catch(() => 0)
  if (inner > height + 50) {
    await page.setViewport({ width, height: Math.min(inner, height * (max + 1)), deviceScaleFactor: 1, isMobile: device === 'mobile', hasTouch: device === 'mobile' }).catch(() => {})
    await new Promise((r) => setTimeout(r, 800))
  }
  const all = await tiles(page, `${device} checkout`, width, height, max)
  return {
    // the checkout's own footer holds the policy links (refund, privacy, terms): keep it
    tiles: all.map((t) => ({ ...t, label: t.label.replace(`${device} checkout screenshot`, `${device} CHECKOUT first step screenshot`).replace(/page bottom \/ footer/i, 'CHECKOUT bottom / policy links') })),
    text,
    shippingNote,
  }
}

/**
 * Shopify's checkout refuses our serverless browser. With BROWSERBASE_API_KEY set, the checkout step runs in a
 * Browserbase browser (real fingerprint, residential IP): the same cart is rebuilt there through Shopify's cart
 * permalink (/cart/<variant>:<qty>), then the first checkout step is captured on desktop and mobile.
 */
type RemoteCheckout = { desktop?: { tiles: Tile[]; note?: string; text?: string; shippingNote?: string }; mobile: Tile[] }

/** The cart's lines as permalink parts (`<variant>:<qty>`), read in the shopper's own session. */
function cartItems(shopPage: Page): Promise<string[]> {
  return shopPage
    .evaluate(() =>
      fetch('/cart.js', { credentials: 'include' })
        .then((r) => r.json())
        .then((c) => (c.items || []).map((i: { variant_id: number; quantity: number }) => `${i.variant_id}:${i.quantity}`)),
    )
    .catch(() => [])
}

/** Lines of the product page that promise something about shipping: compared with what checkout charges. */
function shippingLines(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split(/\n+/)) {
    const l = raw.replace(/\s+/g, ' ').trim()
    if (l.length < 6 || l.length > 180) continue
    if (!/shipping|delivery|livraison|livré|verzend|bezorg|levering|versand|lieferung|envío|spedizione/i.test(l)) continue
    if (!/\d|free|gratuit|gratis|kostenlos/i.test(l)) continue
    if (!out.includes(l)) out.push(l)
    if (out.length >= 12) break
  }
  return out
}

/** The product's first available variant as a permalink part, read from Shopify's product JSON. */
function firstVariant(shopPage: Page, productPath: string): Promise<string[]> {
  return shopPage
    .evaluate(async (pp: string) => {
      const path = pp.replace(/\/$/, '')
      const p = await fetch(`${path}.js`).then((r) => r.json()).catch(() => null)
      const v = p && (p.variants || []).find((x: { available: boolean }) => x.available)
      return v ? [`${v.id}:1`] : []
    }, productPath)
    .catch(() => [])
}

/** The market the shopper browsed in (Shopify.country), so checkout is filled for the same country. */
function marketCountry(shopPage: Page): Promise<string | undefined> {
  // the shop's own country (meta.json) is its home market; our browsers sit in the US, so Shopify.country
  // would often say US and show dollar prices the store's real shoppers never see
  return shopPage
    .evaluate(async () => {
      const meta = await fetch('/meta.json').then((r) => r.json()).catch(() => null)
      return (meta && meta.country) || (window as unknown as { Shopify?: { country?: string } }).Shopify?.country
    })
    .catch(() => undefined)
}

/** Switch the session to a market (country + currency) the Shopify way, before the cart is built. */
async function setMarket(page: Page, origin: string, country?: string) {
  if (!country) return
  await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
  await page
    .evaluate(
      (c) =>
        fetch('/localization', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `form_type=localization&utf8=%E2%9C%93&_method=put&country_code=${encodeURIComponent(c)}&return_to=%2F`,
          credentials: 'include',
        }).catch(() => null),
      country,
    )
    .catch(() => {})
}

/**
 * Public landmark addresses, one per common market. Used only to make Shopify show its shipping methods:
 * no email or phone is ever typed, so no abandoned-checkout email can be sent and no order is placed.
 */
const TEST_ADDRESS: Record<string, { address1: string; zip: string; city: string; zone?: string }> = {
  NL: { address1: 'Museumstraat 1', zip: '1071 XX', city: 'Amsterdam' },
  BE: { address1: 'Rue de la Loi 16', zip: '1000', city: 'Bruxelles' },
  FR: { address1: '5 Avenue Anatole France', zip: '75007', city: 'Paris' },
  DE: { address1: 'Platz der Republik 1', zip: '11011', city: 'Berlin' },
  AT: { address1: 'Dr.-Karl-Renner-Ring 3', zip: '1010', city: 'Wien' },
  LU: { address1: '23 Rue du Marché-aux-Herbes', zip: '1728', city: 'Luxembourg' },
  ES: { address1: 'Paseo del Prado 8', zip: '28014', city: 'Madrid', zone: 'M' },
  IT: { address1: 'Piazza del Colosseo 1', zip: '00184', city: 'Roma', zone: 'RM' },
  GB: { address1: '10 Downing Street', zip: 'SW1A 2AA', city: 'London' },
  IE: { address1: 'Merrion Street Upper', zip: 'D02 R583', city: 'Dublin' },
  CH: { address1: 'Bundesplatz 3', zip: '3005', city: 'Bern' },
  DK: { address1: 'Prins Jørgens Gård 1', zip: '1218', city: 'København' },
  SE: { address1: 'Riksgatan 1', zip: '100 12', city: 'Stockholm' },
  US: { address1: '1600 Pennsylvania Avenue NW', zip: '20500', city: 'Washington', zone: 'DC' },
  CA: { address1: '111 Wellington St', zip: 'K1A 0A9', city: 'Ottawa', zone: 'ON' },
  AU: { address1: '2 Macquarie St', zip: '2000', city: 'Sydney', zone: 'NSW' },
}

/**
 * Type a public address (never an email or phone) so Shopify lists its shipping methods, delivery estimates
 * and the shipping cost. Returns a note when the methods did not appear.
 */
async function revealShipping(page: Page, country?: string): Promise<string | undefined> {
  const sel = await page.$('select[name="countryCode"]')
  let code = country && TEST_ADDRESS[country] ? country : undefined
  if (sel) {
    const current = await sel.evaluate((e) => (e as HTMLSelectElement).value).catch(() => '')
    if (code && current !== code) {
      const ok = await page.select('select[name="countryCode"]', code).then((v) => v.length > 0).catch(() => false)
      if (!ok) code = undefined
      await new Promise((r) => setTimeout(r, 1200))
    }
    if (!code) code = TEST_ADDRESS[current] ? current : undefined
  }
  const a = code ? TEST_ADDRESS[code] : undefined
  if (!a) return `no test address for this country (${country || 'unknown'})`
  const type = async (name: string, value: string) => {
    const el = await page.$(`input[name="${name}"]`)
    if (!el) return false
    await el.click({ clickCount: 3 }).catch(() => {})
    await el.type(value, { delay: 15 }).catch(() => {})
    await page.keyboard.press('Escape').catch(() => {}) // close the address suggestions
    return true
  }
  if (!(await type('address1', a.address1))) return 'address field not found'
  await type('postalCode', a.zip)
  await type('city', a.city)
  if (a.zone) await page.select('select[name="zone"]', a.zone).catch(() => [])
  await page.mouse.click(5, 5).catch(() => {}) // blur, so Shopify fetches the rates
  // wait for the shipping methods to replace "Enter your shipping address..."
  const shown = await page
    .waitForFunction(
      () => {
        const t = document.body?.innerText || ''
        return !/enter (your|a) shipping address to view|saisissez votre adresse de livraison|vul je verzendadres in|geben sie ihre lieferadresse ein/i.test(t) && !/calculating|calcul en cours/i.test(t)
      },
      { timeout: 15000 },
    )
    .then(() => true)
    .catch(() => false)
  await new Promise((r) => setTimeout(r, 1500))
  return shown ? undefined : 'shipping methods did not appear for the test address'
}

async function remoteCheckout(origin: string, items: string[], country?: string): Promise<RemoteCheckout> {
  const key = process.env.BROWSERBASE_API_KEY
  const projectId = process.env.BROWSERBASE_PROJECT_ID
  if (!key || !projectId) return { mobile: [] }
  if (!items.length) return { desktop: { tiles: [], note: 'cart empty, checkout not opened' }, mobile: [] }
  const open = (body: object) =>
    fetch('https://api.browserbase.com/v1/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-BB-API-Key': key }, body: JSON.stringify(body) }).catch(() => null)
  // proxies and captcha solving are paid features: on a plan without them (402), take a plain session
  let res = await open({ projectId, proxies: true, browserSettings: { solveCaptchas: true } })
  if (res && res.status === 402) res = await open({ projectId })
  const session = res && res.ok ? ((await res.json()) as { id: string; connectUrl: string }) : null
  if (!session?.connectUrl) return { desktop: { tiles: [], note: `remote browser unavailable (${res?.status ?? 'no response'})` }, mobile: [] }
  const browser = await puppeteer.connect({ browserWSEndpoint: session.connectUrl }).catch(() => null)
  if (!browser) return { desktop: { tiles: [], note: 'remote browser did not connect' }, mobile: [] }
  try {
    const desk = (await browser.pages())[0] || (await browser.newPage())
    await desk.setViewport({ width: DESKTOP.width, height: DESKTOP.height, deviceScaleFactor: 1 })
    const entry = `${origin}/cart/${items.join(',')}`
    await setMarket(desk, origin, country)
    const desktop = await checkoutStep(desk, 'desktop', DESKTOP.width, DESKTOP.height, 2, entry, country).catch(() => ({ tiles: [] as Tile[], note: 'checkout capture failed', text: undefined as string | undefined }))
    let mobile: Tile[] = []
    if (desktop.tiles.length) {
      const mob = await browser.newPage()
      await mob.setViewport({ width: MOBILE.width, height: MOBILE.height, isMobile: true, hasTouch: true, deviceScaleFactor: 1 })
      await mob.setUserAgent(MOBILE_UA)
      mobile = (await checkoutStep(mob, 'mobile', MOBILE.width, MOBILE.height, 2, entry, country, false).catch(() => ({ tiles: [] as Tile[] }))).tiles
    }
    return { desktop, mobile }
  } finally {
    await browser.close().catch(() => {})
  }
}

const kindOf = (t?: Tile): 'drawer' | 'page' | 'none' => (!t ? 'none' : /cart page\)$/.test(t.label) ? 'page' : 'drawer')

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

/**
 * `extended`: the extra steps only Draft checkpoints use so far (empty cart, cart views after
 * add-to-cart, hover measurement, mobile menu), about 20 to 45 seconds. On for test scans; the free scan turns
 * them on once such a checkpoint is Live.
 */
export async function captureEvidence(rawUrl: string, opts: { extended?: boolean } = {}): Promise<Evidence> {
  const t0 = Date.now()
  sweepStaleProfiles()
  // Google's speed data takes 20 to 50 seconds: ask now, read it at the end
  const psiP = opts.extended ? pageSpeed(rawUrl).catch((e) => ({ error: String((e as Error)?.message || e).slice(0, 80) })) : null
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

    await cleanPage(desktop)
    // homepages only: does the hero rotate by itself (screenshots cannot show it)
    const homePath = /^\/([a-z]{2}([-_][a-z]{2})?\/?)?$/i.test(new URL(finalUrl).pathname)
    const motion = homePath ? await heroMotion(desktop).catch(() => undefined) : undefined
    await scrollForLazyContent(desktop)
    await cleanPage(desktop)
    let facts: Record<string, unknown> = {}
    let text = ''
    let hiddenText = ''
    // share of the page the desktop tiles cover: phones get as far down the page (it is longer there)
    let desktopShare = 1
    let tabTiles: Tile[] = []
    let galleryTile: Tile | undefined
    let desktopTiles: Tile[] = []
    // a page that navigates again after loading (geo or locale redirect, consent wall, app reload) destroys the
    // context we read from: nothing comes back. Settle and read once more; a page we still cannot read is
    // reported as "could not open", never judged on empty evidence.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        await desktop.waitForNetworkIdle({ idleTime: 1000, timeout: 10000 }).catch(() => {})
        if (!(await desktop.evaluate(() => (document.body?.innerText || '').length).catch(() => 0))) await open(desktop, rawUrl).catch(() => {})
        await cleanPage(desktop)
        await scrollForLazyContent(desktop)
        await cleanPage(desktop)
      }
      facts = await readFacts(desktop).catch((e) => {
        console.warn('[scanV2] facts failed', String(e).slice(0, 200))
        return {}
      })
      Object.assign(facts, await readGridAndNav(desktop).catch(() => ({})))
      if (motion) facts.heroMotion = motion
      text = await desktop.evaluate(() => (document.body.innerText || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n')).catch(() => '')
      hiddenText = await readHiddenText(desktop)
      desktopTiles = await tiles(desktop, 'desktop', DESKTOP.width, DESKTOP.height, DESKTOP.tiles).catch(() => [])
      desktopShare = await pageHeight(desktop).then((h) => Math.min(1, (DESKTOP.height * DESKTOP.tiles) / Math.max(h, 1))).catch(() => 1)
      if (text.trim().length > 200 && desktopTiles.length) break
    }
    // product tabs: opened after the page screenshots, so those show the page as a shopper lands on it
    if (detectPageTypeFromUrl(finalUrl) === 'product') {
      // off by default: on the 10 labelled product pages it did not beat the screenshots (image checkpoints
      // 80.6% before, 75.3% with it, within noise) and found the gallery on only 6. SCAN_GALLERY_OVERVIEW=1 to test.
      // always read for the measurements (frame proportions, image count); the overview picture only
      // with SCAN_GALLERY_OVERVIEW=1: it did not beat the screenshots on the labelled stores
      const gallery = await readGallery(desktop, process.env.SCAN_GALLERY_OVERVIEW === '1').catch(() => ({ count: 0, videos: 0, ratios: [] as number[] }) as { tile?: Tile; count: number; videos: number; ratios: number[] })
      galleryTile = gallery.tile
      ;(facts as Record<string, unknown>).gallery = { images: gallery.count, videos: gallery.videos, frameRatios: gallery.ratios }
      const tabs = await openTabs(desktop).catch(() => ({ tiles: [] as Tile[], text: '' }))
      tabTiles = tabs.tiles
      await desktop.evaluate(() => window.scrollTo(0, 0)).catch(() => {})
      if (tabs.text) hiddenText = [hiddenText, `OPENED PRODUCT TABS:\n${tabs.text}`].filter(Boolean).join('\n---\n')
    }
    if (text.trim().length <= 200 || !desktopTiles.length)
      throw new PageCheckError('unreachable', "We couldn't read this page: it kept reloading or blocked our visit. Try again, or try another product URL.")
    const isShopify = await desktop.evaluate(() => !!(window as any).Shopify).catch(() => false)
    if (opts.extended) (facts as Record<string, unknown>).hover = await measureHover(desktop).catch(() => [])
    if (opts.extended) {
      ;(facts as Record<string, unknown>).probes = await desktopProbes(desktop, res?.request().redirectChain().length ?? 0).catch(() => null)
      await cleanPage(desktop)
    }
    ;(facts as Record<string, unknown>).network = netStats(desktop)
    // cheap (one product JSON fetch): the Live default-variant checkpoint uses it on every scan
    ;(facts as Record<string, unknown>).variants = await measureVariants(desktop).catch(() => null)
    // the empty cart first (fresh browser, nothing added yet), then back to the product
    let emptyCart: Tile | undefined
    // cart checkpoints run on product scans only (they add the item there too)
    if (isShopify && opts.extended && detectPageTypeFromUrl(finalUrl) === 'product') {
      const t = await cartView(desktop, 'desktop', DESKTOP.width, DESKTOP.height).catch(() => undefined)
      if (t) emptyCart = { ...t, label: `desktop EMPTY cart, before anything was added (${/cart page\)$/.test(t.label) ? 'the cart page' : 'the cart drawer'})` }
      await desktop.goto(finalUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
      await runDelayedScripts(desktop)
      await desktop.waitForNetworkIdle({ idleTime: 600, timeout: 6000 }).catch(() => {})
      await cleanPage(desktop)
    }
    let cart = await cartTest(desktop)
    // the page can still be settling after the empty-cart visit: one more try before giving up on the cart
    if (!cart.note.startsWith('one item')) {
      await desktop.waitForNetworkIdle({ idleTime: 800, timeout: 6000 }).catch(() => {})
      cart = await cartTest(desktop)
    }
    const itemInCart = cart.note.startsWith('one item')
    if (process.env.SCANV2_DEBUG) console.log('[cart test]', cart.note, desktop.url())
    let desktopCartView = itemInCart && opts.extended ? await cartView(desktop, 'desktop', DESKTOP.width, DESKTOP.height).catch(() => undefined) : undefined
    if (itemInCart && opts.extended && !desktopCartView) {
      // a drawer that did not open (slow theme script, a click that landed while the page was busy): reload, try once more
      await desktop.goto(finalUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
      await runDelayedScripts(desktop)
      await desktop.waitForNetworkIdle({ idleTime: 800, timeout: 6000 }).catch(() => {})
      await cleanPage(desktop)
      desktopCartView = await cartView(desktop, 'desktop', DESKTOP.width, DESKTOP.height).catch(() => undefined)
    }
    const cartKind = itemInCart && opts.extended ? kindOf(desktopCartView) : undefined
    // the icon opened a drawer (or nothing): capture the cart page too
    const desktopCartPage = itemInCart && opts.extended && cartKind !== 'page' ? await cartPage(desktop, 'desktop', DESKTOP.width, DESKTOP.height, 1).catch(() => []) : []
    // checkout: in a Browserbase browser when configured (Shopify refuses ours), otherwise in ours
    // runs alongside the mobile capture, capped, so the whole scan stays inside the function's time limit
    // when our add-to-cart click failed (bundle widgets, custom buttons), checkout can still be reached from
    // the product's own data: its first available variant, through the cart permalink
    const remoteItems = opts.extended && process.env.BROWSERBASE_API_KEY && /\/products\//.test(new URL(finalUrl).pathname)
      ? await cartItems(desktop).then(async (items) => (items.length ? items : await firstVariant(desktop, new URL(finalUrl).pathname)))
      : null
    const remoteOrigin = new URL(desktop.url()).origin
    const remoteCountry = remoteItems ? await marketCountry(desktop) : undefined
    const remoteP: Promise<RemoteCheckout> | null = remoteItems
      ? Promise.race([
          remoteItems.length ? remoteCheckout(remoteOrigin, remoteItems, remoteCountry) : Promise.resolve<RemoteCheckout>({ desktop: { tiles: [], note: 'cart empty, checkout not opened' }, mobile: [] }),
          new Promise<RemoteCheckout>((r) => setTimeout(() => r({ desktop: { tiles: [], note: 'took too long' }, mobile: [] }), 100000)),
        ])
          .then((r) => (r.desktop?.note ? { ...r, desktop: { ...r.desktop, note: `remote browser: ${r.desktop.note}` } } : r))
          .catch(() => ({ desktop: { tiles: [] as Tile[], note: 'remote checkout failed', text: undefined as string | undefined }, mobile: [] as Tile[] }))
      : null
    let desktopCheckout: { tiles: Tile[]; note?: string; text?: string; shippingNote?: string } | undefined = remoteP
      ? undefined
      : itemInCart && opts.extended
        ? await checkoutStep(desktop, 'desktop', DESKTOP.width, DESKTOP.height, 2).then((r) => (r.note ? { ...r, note: `our browser: ${r.note}` } : r)).catch(() => ({ tiles: [] as Tile[], note: 'checkout capture failed', text: undefined as string | undefined }))
        : undefined
    await desktop.close().catch(() => {})

    let mobileTiles: Tile[] = []
    let mobileFacts: Record<string, unknown> = {}
    let mobileCartView: Tile | undefined
    let mobileCartPage: Tile[] = []
    let mobileCheckout: Tile[] = []
    let menuTile: Tile | undefined
    try {
      const mobile = await browser.newPage()
      await mobile.setViewport({ width: MOBILE.width, height: MOBILE.height, isMobile: true, hasTouch: true, deviceScaleFactor: 1 })
      await mobile.setUserAgent(MOBILE_UA)
      await prepare(mobile)
      await open(mobile, rawUrl)
      // a bot wall on the phone visit only (Cloudflare ties its pass to the browser it gave it to):
      // wait for the challenge to clear, then retry with the desktop browser's identity on a phone screen
      // (themes lay out by screen width, not by browser name). Never judge a challenge page.
      if (await walled(mobile)) {
        await mobile.waitForFunction(() => !/verify you are human|needs to be verified|checking your browser|just a moment/i.test(document.body?.innerText || ''), { timeout: 10000 }).catch(() => {})
        if (await walled(mobile)) {
          await mobile.setUserAgent(DESKTOP_UA)
          await open(mobile, rawUrl)
        }
        if (await walled(mobile)) throw new Error('mobile visit blocked by a bot check')
      }
      await new Promise((r) => setTimeout(r, 1500)) // late shifts: fonts, banners, images
      const layoutShift = await mobile.evaluate(() => (window as any).__cxoCls as number | null).catch(() => null)
      // read the cookie banner before cleanPage accepts and hides it: screenshots never show it
      const cookieBanner = await readCookieBanner(mobile).catch(() => null)
      const popup = await readPopup(mobile).catch(() => null)
      await cleanPage(mobile)
      await scrollForLazyContent(mobile)
      await cleanPage(mobile)
      mobileFacts = await mobile
        .evaluate(async () => {
          // body text size: median font size of visible paragraphs and list items
          const sizes = Array.from(document.querySelectorAll('p, li, td, dd, span'))
            .filter((el) => !el.closest('footer, header, nav, [role="contentinfo"], [role="banner"], [class*="footer" i], [class*="announcement" i]'))
            .filter((el) => {
              const r = el.getBoundingClientRect()
              return r.width > 0 && r.height > 0 && Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || '').trim().length > 20)
            })
            .map((el) => parseFloat(getComputedStyle(el).fontSize))
            .filter((n) => n > 0)
            .sort((a, b) => a - b)
          return {
            viewportMeta: document.querySelector('meta[name="viewport"]')?.getAttribute('content') || null,
            horizontalScroll: document.documentElement.scrollWidth > window.innerWidth + 5,
            bodyFontPx: sizes.length ? sizes[Math.floor(sizes.length / 2)] : null,
            textBlocks: sizes.length,
          }
        })
        .catch(() => ({}))
      mobileFacts.layoutShift = typeof layoutShift === 'number' ? Math.round(layoutShift * 1000) / 1000 : null
      if (opts.extended) mobileFacts.probes = await mobileProbes(mobile).catch(() => null)
      // phone pages run 1.5 to 2 times longer than desktop: take as many tiles as it takes to reach the
      // same point of the page as the desktop tiles (at most MOBILE_MAX), so both devices can be compared
      const mobileH = await pageHeight(mobile).catch(() => MOBILE.height * MOBILE.tiles)
      const mobileMax = Math.min(MOBILE_MAX, Math.max(MOBILE.tiles, Math.ceil((mobileH * desktopShare) / MOBILE.height)))
      mobileTiles = await tiles(mobile, 'mobile', MOBILE.width, MOBILE.height, mobileMax)
      if (opts.extended && detectPageTypeFromUrl(finalUrl) === 'product') mobileFacts.stickyAtc = await measureStickyAtc(mobile).catch(() => null)
      mobileFacts.headerSearch = await measureHeaderSearch(mobile).catch(() => null)
      // a chat widget (live or AI) in the page code: it often only draws its bubble after a delay or a scroll
      mobileFacts.chatWidget = await mobile
        .evaluate(() => {
          const CHAT = /gorgias|tidio|zendesk|zdassets|intercom|crisp\.chat|livechat|shopify[-_ ]?inbox|shopifychat|inbox\.shopify|richpanel|reamaze|freshchat|kustomer|trengo|helpscout|chatra|tawk\.to|drift|hubspot.*conversations|siena|alby|rep\.ai|manifest\.ai|chatty|willdesk|helpcenter.*chat/i
          const srcs = Array.from(document.querySelectorAll('script[src], iframe[src]')).map((e) => e.getAttribute('src') || '')
          const ids = Array.from(document.querySelectorAll('[id], [class]')).slice(0, 4000).map((e) => `${e.id} ${typeof e.className === 'string' ? e.className : ''}`)
          const hit = [...srcs, ...ids].find((x) => CHAT.test(x) || /(^|[\s_-])(chat-?widget|chat-?bubble|live-?chat|chat-?launcher)([\s_-]|$)/i.test(x))
          return hit ? hit.slice(0, 80) : null
        })
        .catch(() => null)
      mobileFacts.cookieBanner = cookieBanner
      mobileFacts.popup = popup
      mobileFacts.footerTargets = await measureFooterTargets(mobile).catch(() => null)
      mobileFacts.videos = await readVideos(mobile).catch(() => null)
      if (opts.extended) {
        menuTile = await mobileMenu(mobile, MOBILE.width, MOBILE.height).catch(() => undefined)
        // back to a clean page before the cart (the open menu would sit over the cart icon)
        if (menuTile && itemInCart) {
          await mobile.goto(rawUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
      await runDelayedScripts(mobile)
          await mobile.waitForNetworkIdle({ idleTime: 600, timeout: 6000 }).catch(() => {})
          await cleanPage(mobile)
        }
      }
      // same browser, same cart cookie: the item added on desktop is in the cart here too
      if (itemInCart && opts.extended) {
        mobileCartView = await cartView(mobile, 'mobile', MOBILE.width, MOBILE.height).catch(() => undefined)
        if (kindOf(mobileCartView) !== 'page') mobileCartPage = await cartPage(mobile, 'mobile', MOBILE.width, MOBILE.height, 2).catch(() => [])
        if (!remoteP && desktopCheckout?.tiles.length) mobileCheckout = (await checkoutStep(mobile, 'mobile', MOBILE.width, MOBILE.height, 2).catch(() => ({ tiles: [] as Tile[] }))).tiles
      }
      await mobile.close().catch(() => {})
    } catch (e) {
      console.warn('[scanV2] mobile capture failed', String(e).slice(0, 200))
    }
    if (remoteP) {
      const r = await remoteP
      desktopCheckout = r.desktop
      mobileCheckout = r.mobile
    }
    if (psiP) (facts as Record<string, unknown>).pageSpeed = await psiP

    return {
      url: rawUrl,
      pageType: detectPageTypeFromUrl(finalUrl),
      mobileMenu: menuTile,
      finalUrl,
      status,
      title,
      desktopTiles,
      mobileTiles,
      tabTiles,
      galleryTile,
      cartHeader: cart.tile,
      cartTest: cart.note,
      cartView: desktopCartView,
      mobileCartView,
      cartPage: desktopCartPage,
      emptyCart,
      mobileCartPage,
      checkout: desktopCheckout?.tiles,
      mobileCheckout,
      checkoutNote: desktopCheckout?.note,
      checkoutText: desktopCheckout?.text,
      checkoutShippingNote: desktopCheckout?.shippingNote,
      shippingPromises: shippingLines(`${bodyText}\n${hiddenText}`),
      cartKind,
      isShopify,
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
