import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/resolve-product?url=…  → { url, resolved, how }
 *
 * The free scan is a product-page scan (the 40 free checkpoints are product, header and footer
 * checks). When a store owner pastes their homepage or a collection, we scan their best-selling
 * product instead, so every free checkpoint applies:
 *   1. /collections/all?sort_by=best-selling (Shopify), first product link
 *   2. the page they gave, first product link in the main content
 *   3. /products.json, first product
 * A product URL, or a store we cannot read, comes back unchanged (resolved: false).
 */

export const runtime = 'nodejs'
export const maxDuration = 20

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const IGNORE = /gift-?card|carte-cadeau|cadeaubon|gutschein|sample|test-product|shipping-protection|route-package|insurance/i

async function get(u: string) {
  const r = await fetch(u, { headers: { 'user-agent': UA, accept: 'text/html,application/json' }, redirect: 'follow', cache: 'no-store', signal: AbortSignal.timeout(6000) })
  if (!r.ok) throw new Error(String(r.status))
  return { text: await r.text(), finalUrl: r.url }
}

/** First real product link in a page, as an absolute URL on the store's own origin. */
function firstProduct(html: string, origin: string) {
  // skip the header and footer: product links there are menus, not the catalogue
  const main = html.replace(/<header[\s\S]*?<\/header>/gi, '').replace(/<footer[\s\S]*?<\/footer>/gi, '')
  for (const m of Array.from(main.matchAll(/href=["']((?:https?:\/\/[^"'/]+)?(?:\/[a-z]{2}(?:-[a-z]{2})?)?\/(?:collections\/[^"'/?#]+\/)?products\/[^"'?#]+)/gi))) {
    const href = m[1]
    if (IGNORE.test(href)) continue
    try {
      const u = new URL(href, origin)
      if (u.origin !== origin) continue
      // drop the collection prefix: the canonical product page
      u.pathname = u.pathname.replace(/\/collections\/[^/]+(?=\/products\/)/, '')
      return u.origin + u.pathname
    } catch {}
  }
  return null
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url') || ''
  let start: URL
  try {
    start = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }
  const same = { url: start.toString(), resolved: false }
  if (/\/products\/[^/]+/.test(start.pathname)) return NextResponse.json(same)

  // the store's real origin (www, a custom domain after a redirect)
  let origin = start.origin
  let pageHtml = ''
  try {
    const page = await get(start.toString())
    origin = new URL(page.finalUrl).origin
    pageHtml = page.text
  } catch {}

  try {
    const best = await get(`${origin}/collections/all?sort_by=best-selling`)
    const u = firstProduct(best.text, origin)
    if (u) return NextResponse.json({ url: u, resolved: true, how: 'best-selling' })
  } catch {}

  if (pageHtml) {
    const u = firstProduct(pageHtml, origin)
    if (u) return NextResponse.json({ url: u, resolved: true, how: 'page' })
  }

  try {
    const j = JSON.parse((await get(`${origin}/products.json?limit=10`)).text) as { products?: { handle: string }[] }
    const p = (j.products || []).find((x) => !IGNORE.test(x.handle))
    if (p) return NextResponse.json({ url: `${origin}/products/${p.handle}`, resolved: true, how: 'catalog' })
  } catch {}

  return NextResponse.json(same)
}
