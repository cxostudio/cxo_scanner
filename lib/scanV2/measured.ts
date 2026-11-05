// Checkpoints that are facts, not opinions: measured in the page code so they never vary
// between runs. Each returns a verdict, or null to leave the call to the model
// (when the measurement is not conclusive).
import type { Evidence } from './capture'
import type { Verdict } from './judge'

type F = Record<string, any>
type Measure = (ev: Evidence, f: F) => Omit<Verdict, 'id'> | null

const SOCIAL = /instagram|facebook|tiktok|youtube|pinterest|linkedin|twitter|x\.com|threads/i
const SEARCH = /search|zoek|recherch|buscar|busca|suche|cerca|szukaj|sök|søg/i

export const MEASURED: Record<string, Measure> = {
  // Do you use pure black for text or backgrounds? (pass = no pure black)
  recSs12TogM60Mf6w: (_ev, f) => {
    const t = f.pureBlack?.textElements
    const b = f.pureBlack?.backgroundElements
    if (typeof t !== 'number') return null
    if (t >= 10 || b >= 3)
      return { answer: 'fail', evidence: `Pure black (#000000) is used on ${t} text elements${b ? ` and ${b} backgrounds` : ''}. A soft dark tone like #222 reads easier.` }
    if (t <= 3 && b <= 1) return { answer: 'pass', evidence: 'Text and backgrounds use softer dark tones, not pure black.' }
    return null
  },

  // Is lazy loading enabled for images and videos?
  rec3kmxGigBELSAlu: (_ev, f) => {
    const total = f.images?.total
    const lazy = f.images?.lazyLoaded
    if (typeof total !== 'number' || total < 5) return null
    const share = lazy / total
    if (share >= 0.3) return { answer: 'pass', evidence: `${lazy} of ${total} images load only when needed (lazy loading).` }
    return { answer: 'fail', evidence: `Only ${lazy} of ${total} images are lazy loaded, so the page downloads images shoppers may never see.` }
  },

  // Does the footer display social media links?
  recXqQmYLbyuIil2a: (_ev, f) => {
    if (!f.footer) return null
    const hosts = Array.from(new Set((f.footer.links as string[]).map((l) => (l.match(SOCIAL) || [])[0]).filter(Boolean))) as string[]
    if (hosts.length) return { answer: 'pass', evidence: `The footer links to ${hosts.map((h) => h[0].toUpperCase() + h.slice(1).toLowerCase()).join(', ')}.` }
    return null
  },

  // Is there a visible newsletter subscription form in the footer?
  recjK9IQ0T4rpu4iu: (_ev, f) => {
    if (!f.footer) return null
    if ((f.footer.inputs as string[]).some((i) => /^email|mail|newsletter|subscribe/i.test(i))) return { answer: 'pass', evidence: 'The footer has an email field to join the newsletter.' }
    return null
  },

  // Does the cart icon display the number of items currently in the cart?
  recdkYxD8QVU9j14p: (ev) => {
    const m = ev.cartTest?.match(/cart icon now shows "(\d+)"/)
    if (m && Number(m[1]) >= 1) return { answer: 'pass', evidence: `After adding a product, the cart icon shows "${m[1]}".` }
    return null
  },

  // Does the footer have a "Back to Top" button for easy navigation?
  recKjEZrP38rjqCoY: (_ev, f) => {
    if (f.backToTopControl === true) return { answer: 'pass', evidence: 'There is a back to top control at the bottom of the page.' }
    if (f.backToTopControl === false && f.footer) return { answer: 'fail', evidence: 'There is no back to top button, so long pages need a lot of scrolling back up.' }
    return null
  },

  // Is there a clear and accessible "Search" button or icon?
  recjEVPpCRkdi17EE: (_ev, f) => {
    const controls: string[] = f.header?.controls || []
    if (controls.some((c) => SEARCH.test(c))) return { answer: 'pass', evidence: 'The header has a search icon or field.' }
    return null
  },

  // Is the logo clickable and linked to the homepage?
  recYUxusypKnfViyM: (ev, f) => {
    const controls: string[] = f.header?.controls || []
    let origin = ''
    try {
      origin = new URL(ev.finalUrl).origin
    } catch {}
    const home = controls.find((c) => /logo/i.test(c) && (/ href=\/(\s|$)/.test(c) || / href=\/[a-z]{2}(-[a-z]{2})?\/?(\s|$)/i.test(c) || (origin && c.includes(` href=${origin}/ `)) || (origin && new RegExp(` href=${origin.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}/?(\\s|$)`).test(c))))
    if (home) return { answer: 'pass', evidence: 'The logo links back to the homepage.' }
    return null
  },

  // ── Draft checkpoints measured from the page code (Nov 2026) ──────────────────────────

  // Are all images labeled with alt text for accessibility and SEO purposes?
  rechriROBfHKhi1MQ: (_ev, f) => {
    const total = f.images?.total
    const missing = f.images?.missingAlt
    if (typeof total !== 'number' || total < 3) return null
    if (missing === 0) return { answer: 'pass', evidence: `All ${total} images on the page have alt text.` }
    if (missing / total > 0.1) return { answer: 'fail', evidence: `${missing} of ${total} images have no alt text, so screen readers and Google cannot tell what they show.` }
    return null
  },

  // Is Product structured data (price, availability, rating) present for Google?
  rec4LzeEPZLP5xBvn: (_ev, f) => {
    const types: string[] = (f.structuredData || []).flat().map(String)
    if (types.some((t) => /^Product(Group)?$/i.test(t))) return { answer: 'pass', evidence: 'The page has Product structured data for Google.' }
    if (Array.isArray(f.structuredData)) return { answer: 'fail', evidence: 'The page has no Product structured data, so Google cannot show price, stock or rating in search results.' }
    return null
  },

  // Is the website fully responsive on all mobile devices and screen sizes?
  rectZw0M4eDsc48Wo: (ev) => {
    const m = ev.mobileFacts as F
    if (m.horizontalScroll === true) return { answer: 'fail', evidence: 'On a phone the page is wider than the screen, so it scrolls sideways.' }
    if (m.horizontalScroll === false && /width=device-width/i.test(m.viewportMeta || '')) return { answer: 'pass', evidence: 'The page fits the phone screen with no sideways scrolling.' }
    return null
  },

  // Are touch gestures like pinch-to-zoom or swipe properly supported and not blocked on mobile?
  recmfE93txjDPFQgc: (ev) => {
    const meta: string | null = (ev.mobileFacts as F).viewportMeta ?? null
    if (meta === null) return null
    if (/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/i.test(meta)) return { answer: 'fail', evidence: 'The page blocks pinch-to-zoom on phones, so shoppers cannot zoom in on details.' }
    return { answer: 'pass', evidence: 'Pinch-to-zoom is not blocked on phones.' }
  },

  // Are items that the user placed in the cart still there when they return to the site?
  recvGRlQJZ4XMRg5j: (ev) => {
    if (/cart icon now shows "[1-9]/.test(ev.cartTest || '')) return { answer: 'pass', evidence: 'After adding a product and reloading the page, the item is still in the cart.' }
    return null
  },

  // On desktop, does the add-to-cart button react on hover and look clickable?
  recQIt5y3T2kUODX2: (_ev, f) => {
    const b = (f.hover || []).find((h: F) => h.kind === 'addToCart')
    if (!b || b.disabled) return null
    if (b.changes.length && b.cursor === 'pointer') return { answer: 'pass', evidence: `On desktop the add-to-cart button changes on hover (${b.changes.length} style change${b.changes.length > 1 ? 's' : ''}) and shows a hand cursor.` }
    if (!b.changes.length) return { answer: 'fail', evidence: 'On desktop the add-to-cart button does not change when the mouse is over it, so it feels less clickable.' }
    return { answer: 'fail', evidence: 'On desktop the add-to-cart button shows an arrow cursor instead of a hand, so it looks less clickable.' }
  },

  // On desktop, do buttons and links react on hover and show a pointer cursor?
  // Links: hand cursor only (menu links often react by opening a menu, not by changing style).
  // The add-to-cart button: hand cursor and a visible change.
  recEqtpY2Opsp5L7J: (_ev, f) => {
    const all: F[] = (f.hover || []).filter((h: F) => !h.disabled)
    if (all.length < 2) return null
    const noPointer = all.filter((h) => h.cursor !== 'pointer')
    if (noPointer.length) return { answer: 'fail', evidence: `On desktop ${noPointer.map((h) => `"${h.label}"`).join(', ')} show an arrow cursor instead of a hand.` }
    const atc = all.find((h) => h.kind === 'addToCart')
    if (atc && !atc.changes.length) return { answer: 'fail', evidence: 'On desktop the add-to-cart button does not change on hover.' }
    return { answer: 'pass', evidence: atc ? 'On desktop the main button reacts on hover and the button and header links show a hand cursor.' : 'On desktop the header links show a hand cursor.' }
  },

  // Is the font size readable on all mobile devices without needing to zoom in?
  recpms3eLz0EUb0qR: (ev) => {
    const m = ev.mobileFacts as F
    if (typeof m.bodyFontPx !== 'number' || (m.textBlocks || 0) < 3) return null
    if (m.bodyFontPx >= 16) return { answer: 'pass', evidence: `Body text on phones is ${m.bodyFontPx}px, readable without zooming.` }
    if (m.bodyFontPx < 14) return { answer: 'fail', evidence: `Body text on phones is ${m.bodyFontPx}px, small enough that shoppers may need to zoom (16px is the usual minimum).` }
    return null
  },

  // Does the page stay stable while it loads (no jumping buttons or text)?
  recouiE072opsajby: (ev) => {
    const cls = (ev.mobileFacts as F).layoutShift
    if (typeof cls !== 'number') return null
    if (cls <= 0.1) return { answer: 'pass', evidence: `The page barely moves while loading on a phone (layout shift ${cls}, Google's limit for "good" is 0.1).` }
    if (cls > 0.25) return { answer: 'fail', evidence: `Content jumps while the page loads on a phone (layout shift ${cls}; Google rates above 0.25 as poor).` }
    return null
  },

  // Is Instant.page or a similar preloading technology implemented to speed up navigation between pages?
  rec26fX1nyMt7UkTa: (_ev, f) => {
    const p = f.preloading
    if (!p) return null
    if (p.speculationRules || p.scripts?.length || p.prefetchLinks > 0) return { answer: 'pass', evidence: 'The site preloads the next page before the click (speculation rules or a preloading script).' }
    return { answer: 'fail', evidence: 'No page preloading found, so every click waits for the next page to load.' }
  },

  // Are images optimized for the web? (formats as downloaded: Shopify serves WebP without a .webp URL)
  recxGK8wpGe3v4DPX: (_ev, f) => {
    const imgs: Record<string, number> = f.network?.images || {}
    const raster = Object.entries(imgs).filter(([t]) => !/svg|gif|x-icon|vnd\.microsoft/.test(t))
    const total = raster.reduce((a, [, n]) => a + n, 0)
    if (total < 5) return null
    const modern = raster.filter(([t]) => /webp|avif/.test(t)).reduce((a, [, n]) => a + n, 0)
    if (modern / total >= 0.7) return { answer: 'pass', evidence: `${modern} of ${total} images were delivered in modern formats (WebP or AVIF).` }
    if (modern / total < 0.3) return { answer: 'fail', evidence: `Only ${modern} of ${total} images were delivered in modern formats (WebP or AVIF), so images are heavier than needed.` }
    return null
  },

  // Is a Content Delivery Network (CDN) in use? (response headers of the images, then known CDN hosts)
  recEDZPtvg4HScth9: (_ev, f) => {
    const n = f.network
    if (n && n.imageResponses >= 5 && n.cdnImages / n.imageResponses >= 0.5) return { answer: 'pass', evidence: 'Images are served through a CDN.' }
    const hosts: string[] = f.imageHosts || []
    if (hosts.some((h) => /cdn\.shopify\.com|cloudfront|akamai|fastly|cloudinary|imgix|bunny|^cdn\./i.test(h))) return { answer: 'pass', evidence: 'Images are served from a CDN.' }
    return null
  },
}
