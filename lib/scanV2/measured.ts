// Checkpoints that are facts, not opinions: measured in the page code so they never vary
// between runs. Each returns a verdict, or null to leave the call to the model
// (when the measurement is not conclusive).
import type { Evidence } from './capture'
import type { Verdict } from './judge'

type F = Record<string, any>
type Measure = (ev: Evidence, f: F) => Omit<Verdict, 'id'> | null

const SOCIAL = /instagram|facebook|tiktok|youtube|pinterest|linkedin|twitter|x\.com|threads/i
const SEARCH = /search|zoek|recherch|buscar|busca|suche|cerca|szukaj|sök|søg/i

/** One Shopify variant and no option pickers on the page. Kits and bundles (one variant in Shopify,
 * with a colour or size picker per item, e.g. Wild One's harness kit) still let the shopper choose. */
function singleVersion(v: any) {
  return !!v && v.total === 1 && !(v.pickers > 0)
}

/** The store sells fewer products than `under`: search checkpoints do not apply. Count from Shopify's products.json. */
function smallCatalog(f: F, under: number) {
  const n = f.catalogSize
  if (typeof n !== 'number' || n >= under) return null
  return { answer: 'na' as const, evidence: `The store sells ${n} product${n === 1 ? '' : 's'}: shoppers can see the whole range from the menu, so search matters little here.` }
}

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
    // 16px+ passes for every audience; 14 to 16px passes too unless the store sells to older shoppers,
    // which the model judges from the products and the people shown (it gets bodyFontPx in the mobile facts)
    if (m.bodyFontPx >= 16) return { answer: 'pass', evidence: `Body text on phones is ${m.bodyFontPx}px, readable without zooming.` }
    if (m.bodyFontPx < 12) return { answer: 'fail', evidence: `Body text on phones is ${m.bodyFontPx}px, small enough that shoppers need to zoom (Google counts text under 12px as illegible).` }
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

  // Does a sticky 'Add to Cart' appear when the main 'Add to Cart' button is out of view? (mobile)
  recWeoj4QACWSKPuX: (ev) => {
    const st = (ev.mobileFacts as F).stickyAtc
    if (!st) return null
    if (st.sticky) return { answer: 'pass', evidence: `On a phone, an add-to-cart button ("${st.label}") stays on screen after scrolling past the main one.` }
    return { answer: 'fail', evidence: 'On a phone, once you scroll past the main button there is no add-to-cart button on screen until you scroll back up.' }
  },

  // Are sold-out options clearly marked in the colour and size selector?
  recZsTWnkPB7mQHyC: (_ev, f) => {
    const v = f.variants
    if (!v || !v.total) return null
    if (v.total > 1 && v.soldOut === 0) return { answer: 'na', evidence: 'Every option of this product is in stock, so there is nothing to mark.' }
    if (v.soldOut > 0 && v.marked > 0) return { answer: 'pass', evidence: `Sold-out options are visibly marked in the selector (${v.marked} marked as unavailable).` }
    return null // sold out somewhere, nothing marked in the code: the screenshots decide
  },

  // Is a default variant preselected, so the shopper can add to cart right away (except sizes in fashion)?
  // The button as the page loads tells: enabled and saying "Add to cart" means a variant is already chosen.
  rec1iBTNslYj4y05d: (_ev, f) => {
    const v = f.variants
    if (!v || !v.total) return null
    if (singleVersion(v)) return { answer: 'na', evidence: 'This product has a single version, so there is nothing to preselect.' }
    if (v.atc && v.atc.ready && !v.atc.disabled) return { answer: 'pass', evidence: `A version is already selected when the page opens: the button reads "${v.atc.label}" and works right away.` }
    return null // the button asks for a choice: fine for sizes in fashion, a fail elsewhere; the judge decides with the niche
  },

  // Do discounted items in the cart show the old price struck through, or the saving?
  // No version of the product has a compare-at price: the item added to the cart is not discounted.
  // gallery images share one shape: read from Shopify's media list. Mixed shapes are left to the
  // model, since many themes crop them into one frame and the gallery does not jump.
  // cookie banner: screenshots never show it (it is accepted and hidden first), so only the
  // measurement can judge it. Not seen → couldn't check (often geo-targeted to EU visitors).
  recqdZbBbXoGLLZYV: (ev) => {
    const c = (ev.mobileFacts as Record<string, any>)?.cookieBanner
    if (!c?.found) return { answer: 'unknown', evidence: 'No cookie banner was shown to our visit (stores often show it only to EU visitors), so we could not check it.' }
    if (c.coversPct >= 60) return { answer: 'fail', evidence: `The cookie banner covers about ${c.coversPct}% of a phone screen.` }
    if (!c.reject) return { answer: 'fail', evidence: 'The cookie banner has no one-tap reject option next to accept.' }
    return { answer: 'pass', evidence: `The cookie banner covers about ${c.coversPct}% of a phone screen and can be accepted or rejected in one tap.` }
  },
  // pop-ups on landing: screenshots never show them (they are closed first), so the reading decides
  recYZBCXc8EmCPzXq: (ev) => {
    const p = (ev.mobileFacts as Record<string, any>)?.popup
    if (!p) return null
    if (!p.found) return { answer: 'na', evidence: 'No pop-up appeared in the first seconds of the visit on mobile.' }
    if (p.coversPct >= 60) return { answer: 'fail', evidence: `A pop-up covers about ${p.coversPct}% of the phone screen as soon as the page opens.` }
    if (!p.close || p.closeSize < 24) return { answer: 'fail', evidence: 'A pop-up appears on landing without a clear close button.' }
    if (p.coversPct > 33) return { answer: 'fail', evidence: `A pop-up appears on landing and covers about ${p.coversPct}% of the phone screen (more than a third).` }
    return { answer: 'pass', evidence: `The pop-up on landing covers about ${p.coversPct}% of the phone screen and has a clear close button.` }
  },
  recYRJzuWC8lHXc40: (_ev, f) => {
    // first the frames the gallery shows on the page (themes crop every photo to one shape), then the files
    const frames: number[] = f?.gallery?.frameRatios || []
    if (frames.length >= 2) {
      const same = Math.max(...frames) / Math.min(...frames) <= 1.03
      return same
        ? { answer: 'pass', evidence: `The gallery shows all ${frames.length} images in frames of the same shape (${frames[0].toFixed(2)} width to height), so it keeps its height when swiping.` }
        : { answer: 'fail', evidence: `The gallery shows images in frames of different shapes (from ${Math.min(...frames).toFixed(2)} to ${Math.max(...frames).toFixed(2)} width to height), so it changes height when swiping.` }
    }
    const r: number[] = f?.variants?.ratios || []
    if (r.length === 1) return { answer: 'na', evidence: 'The product has a single image.' }
    if (r.length >= 2 && Math.max(...r) / Math.min(...r) <= 1.03)
      return { answer: 'pass', evidence: `All ${r.length} product images have the same shape (${r[0].toFixed(2)} width to height), so the gallery keeps its height.` }
    return null
  },
  recbEhE51TXFkDDnC: (_ev, f) => {
    const v = f.variants
    if (!v || !v.total || typeof v.discounted !== 'number') return null
    if (v.discounted === 0) return { answer: 'na', evidence: 'The product added to the cart is not on sale, so there is no old price to show.' }
    return null
  },

  // Is the footer designed to be responsive and mobile-friendly? Measured on a 390px phone screen:
  // no sideways scroll, and at least 75% of footer links comfortable to tap (36px+ from the next one, or 44px+ tall).
  recgYs2tKWTQRQV7i: (ev) => {
    const t = (ev.mobileFacts as F)?.footerTargets
    if (!t) return null
    const GAP = 36 // px between link centres
    const TALL = 44 // px, a link this tall is easy to tap whatever its neighbours
    const comfortable = Array.isArray(t.links) ? t.links.filter(([gap, h]: number[]) => gap >= GAP || h >= TALL).length : t.comfortable
    t.comfortable = comfortable
    const share = comfortable / t.targets
    if (t.overflow) return { answer: 'fail', evidence: 'On a phone the page scrolls sideways at the footer: it is wider than the screen.' }
    if (share >= 0.75) return { answer: 'pass', evidence: `On a phone, ${t.comfortable} of ${t.targets} footer links are easy to tap: big enough and spaced apart.` }
    return { answer: 'fail', evidence: `On a phone, only ${t.comfortable} of ${t.targets} footer links are easy to tap: they sit about ${t.typicalGap}px apart, under the 36px a thumb needs.` }
  },

  // Search checkpoints on small stores: with under 20 products the whole range fits in the menu
  ...Object.fromEntries(
    ['recjEVPpCRkdi17EE', 'recHkGvsYH1vmYzwt', 'recPKeMkL99ewxiFu', 'rec9YqyUjHjIYlVIH', 'recWctdeyEyTRSFcU', 'recEwhpkC7Fpe6drp', 'recabn64gTwNLfVr6', 'recgzCeCt88qIsOG2'].map((id) => [
      id,
      (_ev: Evidence, f: F) => smallCatalog(f, 20),
    ]),
  ),
  recUUD0aehm1xJOs6: (_ev: Evidence, f: F) => smallCatalog(f, 30),

  // Is good navigational feedback provided (active state)? The header link to this page must LOOK different.
  recB9iXaHpr1wLOzT: (_ev: Evidence, f: F) => {
    if (f.activeNav === true) return { answer: 'pass', evidence: 'The menu highlights the section you are in, so shoppers can tell where they are.' }
    if (f.activeNav === false) return { answer: 'fail', evidence: 'The menu link to this page looks exactly like the others, so shoppers cannot tell where they are.' }
    return null
  },

  // On desktop, are the main categories visible in the header without opening a menu? At most one collection link in the header bar fails.
  reclt5mHrGdpwf2lU: (_ev: Evidence, f: F) => {
    if (typeof f.headerCollections === 'number' && f.headerCollections <= 1)
      return { answer: 'fail', evidence: 'On desktop, the header shows no category links (one at most): shoppers have to open the menu to see what the store sells.' }
    return null
  },

  // Does the category page have a clear and descriptive category heading? No visible heading near the top fails.
  recKToQ0snBXyfpCo: (_ev: Evidence, f: F) => {
    if (f.visibleHeading === null && 'visibleHeading' in f)
      return { answer: 'fail', evidence: 'There is no visible heading at the top of the page: shoppers do not see the name of the category they are in.' }
    return null
  },

  // Are "Out of Stock" products clearly marked or hidden from the primary view? Sold-out cards up front fail.
  recbh9OAh8JWdqt7U: (_ev: Evidence, f: F) => {
    if (typeof f.soldOutFirst === 'number' && f.soldOutFirst >= 2)
      return { answer: 'fail', evidence: `${f.soldOutFirst} of the first 4 products are sold out: the top of the grid should show products shoppers can buy, with sold-out ones further down.` }
    if (f.soldOutFirst === 0 && typeof f.soldOutAny === 'number' && f.soldOutAny > 0)
      return { answer: 'pass', evidence: 'Sold-out products are labelled on their cards and none of them sits in the first row of the grid.' }
    return null
  },

  // Does the product page have an option for potential customers to ask questions? (a chat widget in the page code)
  recRbVoxG8qjJlszm: (ev: Evidence) => {
    const chat = (ev as { mobileFacts?: { chatWidget?: string | null } }).mobileFacts?.chatWidget
    if (chat) return { answer: 'pass', evidence: 'The page loads a chat widget, so shoppers can ask a question while they shop.' }
    return null
  },

  // Is the mobile search bar easy to access and use? (one tap in the mobile header, measured)
  recHkGvsYH1vmYzwt: (ev: Evidence, f: F) => {
    const small = smallCatalog(f, 20)
    if (small) return small
    const m = (ev as { mobileFacts?: { headerSearch?: boolean | null } }).mobileFacts?.headerSearch
    if (m === true) return { answer: 'pass', evidence: 'On mobile, search is one tap away in the header.' }
    if (m === false) return { answer: 'fail', evidence: 'On mobile, there is no search icon in the header: shoppers have to open the menu or scroll to find search.' }
    return null
  },

  // Are product categories or popular links included in the footer for quick access? (Shopify: collection links)
  recEgJJ3Ja7iD3B63: (ev, f) => {
    if (!ev.isShopify || !f.footer) return null
    const links: string[] = f.footer.links || []
    // collections, or the products themselves on stores with a small range
    // the link target, not the label; anchors on this same page (privacy pop-ups like "#dns") are not shop links
    const here = (() => { try { return new URL(ev.url).pathname.replace(/\/$/, '') } catch { return '' } })()
    const shop = links.filter((l) => {
      const href = l.split(' -> ').pop() || l
      try {
        const u = new URL(href, ev.url)
        // a link with a #fragment opens something on the current page (privacy pop-ups), not a shop page
        return /\/(collections|products)\//.test(u.pathname) && !u.hash && u.pathname.replace(/\/$/, '') !== here
      } catch {
        return false
      }
    })
    if (shop.length >= 2) return { answer: 'pass', evidence: `The footer links to products or collections such as ${shop.slice(0, 3).map((l) => `"${l.split(' -> ')[0]}"`).join(', ')}.` }
    if (shop.length === 0 && links.length >= 5) return { answer: 'fail', evidence: 'The footer has no links to product categories, popular collections or products, only company and help pages.' }
    return null
  },

  // Are product variant options easily accessible and touch-friendly on mobile? A single version: nothing to choose.
  recEyoHMH2oyA0Hk3: (_ev, f) => (singleVersion(f.variants) ? { answer: 'na', evidence: 'This product has a single version, so there is no option to choose.' } : null),

  // Do colour variants show as image thumbnails or clear swatches? A single version has no colour choice.
  // Only sizes (or other options that do not change the look) to choose: there is no colour to show as a swatch.
  recnbgJzDarhgi4RH: (_ev, f) => {
    if (singleVersion(f.variants)) return { answer: 'na', evidence: 'This product has a single version, so there are no colour variants.' }
    const names: string[] = f.variants?.optionNames || []
    const VISUAL = /colou?r|couleur|kleur|farbe|color|style|pattern|motif|print|material|mati[eè]re|finish|shade|teinte|tint|design|model|mod[eè]le|edition|flavou?r|parfum|scent|geur/i
    if (names.length && !names.some((n) => VISUAL.test(n)) && names.every((n) => /size|taille|maat|größe|grosse|talla|taglia|length|longueur|lengte|width|largeur|pointure|quantity|pack|title/i.test(n)))
      return { answer: 'na', evidence: `The only choice is ${names.join(' and ').toLowerCase()}, which does not change how the product looks, so there are no colour variants to show.` }
    return null
  },
}
