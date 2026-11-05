// Scan engine v2, step 1: collect the evidence a CRO reviewer needs, once per page.
//   - desktop (1440) and mobile (390) screenshots, cut into viewport tiles + the footer
//   - visible text, hidden tab/accordion text, header/footer links, measured DOM facts
//   - the header after one item is added to the cart (Shopify), for the cart-count check
//   - the cart view after that (drawer or cart page), desktop and mobile, for cart checkpoints
//   - a page check first: 404s, redirects away from the product, bot walls
import type { Page } from 'puppeteer-core'
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
  cartHeader?: Tile
  cartTest?: string
  /** What opens from the header cart icon with one item in the cart: a drawer, or the cart page. */
  cartView?: Tile
  mobileCartView?: Tile
  /** The /cart page as well, when the icon opened a drawer (both are judged, the drawer first). */
  cartPage?: Tile[]
  mobileCartPage?: Tile[]
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
const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const JPEG_QUALITY = 55

const BOT_WALL = /verify you are human|are you a robot|security check(point)?|checking your browser|attention required|access denied|captcha|just a moment\.\.\.|pardon our interruption|request unsuccessful/i
const NOT_FOUND = /\b404\b|page not found|pagina niet gevonden|page introuvable|página no encontrada|seite nicht gefunden|pagina non trovata/i

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
    try {
      if (/\/products\//.test(location.pathname)) {
        const r = await fetch(location.pathname.replace(/\/$/, '') + '.js')
        if (r.ok) {
          const p = await r.json()
          total = p.variants.length
          soldOut = p.variants.filter((v: any) => !v.available).length
          discounted = p.variants.filter((v: any) => v.compare_at_price && v.compare_at_price > v.price).length
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
    return { total, soldOut, discounted, options: options.length, marked, atc }
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
type NetStats = { images: Record<string, number>; cdnImages: number; imageResponses: number }
const NET = new WeakMap<Page, NetStats>()
const CDN_HEADERS = /^(cf-ray|cf-cache-status|x-amz-cf-id|x-served-by|x-cache|x-fastly-request-id|akamai-cache-status|x-akamai|server-timing|x-cdn|cdn-cache|x-shopid|x-shardid)$/i

export function netStats(page: Page): NetStats | null {
  return NET.get(page) || null
}

async function prepare(page: Page) {
  const stats: NetStats = { images: {}, cdnImages: 0, imageResponses: 0 }
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
      if (type === 'media' || (!firstParty && BLOCK_HOSTS.test(host))) {
        if (process.env.SCANV2_DEBUG) console.log('[blocked]', type, req.url().slice(0, 110))
        return void req.abort().catch(() => {})
      }
      void req.continue().catch(() => {})
    } catch {}
  })
}

/** Open the page; a slow page that has in fact rendered is good enough. */
/** The page shows a bot check (Cloudflare and the like) instead of the store. */
async function walled(page: Page) {
  const title = await page.title().catch(() => '')
  const text = await page.evaluate(() => (document.body?.innerText || '').slice(0, 2000)).catch(() => '')
  return text.length < 1500 && (BOT_WALL.test(`${title} ${text}`) || /verify you are human|needs to be verified/i.test(text))
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
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {})
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
          return score ? { score, x: r.left + r.width / 2, y: r.top + r.height / 2, toCartPage: /\/cart\/?($|\?|#)/.test(href) } : null
        })
        .filter(Boolean) as { score: number; x: number; y: number; toCartPage: boolean }[]
      scored.sort((a, b) => b.score - a.score || b.x - a.x)
      return scored[0] || null
    })
    .catch(() => null)
  if (process.env.SCANV2_DEBUG) console.log('[cart view]', device, JSON.stringify(point), await page.evaluate((p) => { if (!p) return null; const e = document.elementFromPoint(p.x, p.y); return e ? `${e.tagName} ${e.getAttribute('aria-label') || ''} ${(e.getAttribute('class') || '').slice(0, 50)}` : null }, point).catch(String))
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
      return drawer ? 'drawer' : null
    }, startUrl)
    .catch(() => null)
  if (process.env.SCANV2_DEBUG) console.log('[cart view] opened:', opened, page.url())
  if (!opened) return undefined
  const b64 = await page.screenshot({ type: 'jpeg', quality: JPEG_QUALITY, encoding: 'base64', clip: { x: 0, y: 0, width, height } }).catch(() => null)
  if (!b64) return undefined
  const where = opened === 'page' ? 'the cart page' : 'the cart drawer'
  return { label: `${device} cart view after one item was added (${where})`, dataUrl: `data:image/jpeg;base64,${b64}` }
}

/**
 * Mobile: tap the menu button in the header and capture the navigation that opens.
 * Kept only if a new panel with several links appeared (no screenshot of a closed menu).
 */
async function mobileMenu(page: Page, width: number, height: number): Promise<Tile | undefined> {
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {})
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
  if (!res || res.status() >= 400) return []
  await page.waitForNetworkIdle({ idleTime: 600, timeout: 5000 }).catch(() => {})
  // some stores (headless, drawer-only) redirect /cart elsewhere: then there is no cart page
  if (!/\/cart\/?$/.test(new URL(page.url()).pathname)) return []
  await cleanPage(page)
  const all = await tiles(page, `${device} cart page`, width, height, max)
  // the footer is already in the product page tiles
  return all.filter((t) => !/footer/i.test(t.label)).map((t) => ({ ...t, label: t.label.replace(`${device} cart page screenshot`, `${device} CART PAGE (/cart) screenshot`) }))
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
    await scrollForLazyContent(desktop)
    await cleanPage(desktop)
    const facts = await readFacts(desktop).catch((e) => {
      console.warn('[scanV2] facts failed', String(e).slice(0, 200))
      return {}
    })
    const text = await desktop.evaluate(() => (document.body.innerText || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n')).catch(() => '')
    const hiddenText = await readHiddenText(desktop)
    const desktopTiles = await tiles(desktop, 'desktop', DESKTOP.width, DESKTOP.height, DESKTOP.tiles)
    const isShopify = await desktop.evaluate(() => !!(window as any).Shopify).catch(() => false)
    if (opts.extended) (facts as Record<string, unknown>).hover = await measureHover(desktop).catch(() => [])
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
      await desktop.waitForNetworkIdle({ idleTime: 600, timeout: 6000 }).catch(() => {})
      await cleanPage(desktop)
    }
    const cart = await cartTest(desktop)
    const itemInCart = cart.note.startsWith('one item')
    const desktopCartView = itemInCart && opts.extended ? await cartView(desktop, 'desktop', DESKTOP.width, DESKTOP.height).catch(() => undefined) : undefined
    const cartKind = itemInCart && opts.extended ? kindOf(desktopCartView) : undefined
    // the icon opened a drawer (or nothing): capture the cart page too
    const desktopCartPage = itemInCart && opts.extended && cartKind !== 'page' ? await cartPage(desktop, 'desktop', DESKTOP.width, DESKTOP.height, 1).catch(() => []) : []
    await desktop.close().catch(() => {})

    let mobileTiles: Tile[] = []
    let mobileFacts: Record<string, unknown> = {}
    let mobileCartView: Tile | undefined
    let mobileCartPage: Tile[] = []
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
      mobileTiles = await tiles(mobile, 'mobile', MOBILE.width, MOBILE.height, MOBILE.tiles)
      if (opts.extended && detectPageTypeFromUrl(finalUrl) === 'product') mobileFacts.stickyAtc = await measureStickyAtc(mobile).catch(() => null)
      if (opts.extended) {
        menuTile = await mobileMenu(mobile, MOBILE.width, MOBILE.height).catch(() => undefined)
        // back to a clean page before the cart (the open menu would sit over the cart icon)
        if (menuTile && itemInCart) {
          await mobile.goto(rawUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
          await mobile.waitForNetworkIdle({ idleTime: 600, timeout: 6000 }).catch(() => {})
          await cleanPage(mobile)
        }
      }
      // same browser, same cart cookie: the item added on desktop is in the cart here too
      if (itemInCart && opts.extended) {
        mobileCartView = await cartView(mobile, 'mobile', MOBILE.width, MOBILE.height).catch(() => undefined)
        if (kindOf(mobileCartView) !== 'page') mobileCartPage = await cartPage(mobile, 'mobile', MOBILE.width, MOBILE.height, 2).catch(() => [])
      }
      await mobile.close().catch(() => {})
    } catch (e) {
      console.warn('[scanV2] mobile capture failed', String(e).slice(0, 200))
    }

    return {
      url: rawUrl,
      pageType: detectPageTypeFromUrl(finalUrl),
      mobileMenu: menuTile,
      finalUrl,
      status,
      title,
      desktopTiles,
      mobileTiles,
      cartHeader: cart.tile,
      cartTest: cart.note,
      cartView: desktopCartView,
      mobileCartView,
      cartPage: desktopCartPage,
      emptyCart,
      mobileCartPage,
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
