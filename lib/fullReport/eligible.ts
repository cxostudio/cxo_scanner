// Can we deliver the full report for this store? Its cart and checkout come from adding a product to
// the cart through Shopify's standard product data (/products/<handle>.js). Custom ("headless")
// storefronts don't serve it, so the report would ship without cart and checkout: we don't sell it there.
// One small request, no add to cart (nothing shows up in the store's analytics).
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
export type Eligibility = { ok: boolean; reason: string; productUrl?: string }

const cache = new Map<string, { at: number; v: Eligibility }>()

async function productData(productUrl: string): Promise<boolean> {
  const u = new URL(productUrl)
  const path = u.pathname.replace(/\/$/, '')
  const r = await fetch(`${u.origin}${path}.js`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(8000), redirect: 'follow' }).catch(() => null)
  // Shopify serves it as text/javascript: parse whatever comes back, an HTML page fails the parse
  if (!r || !r.ok) return false
  const p = (await r.json().catch(() => null)) as { variants?: { id?: number; available?: boolean }[] } | null
  return !!p?.variants?.some((v) => v.id && v.available !== false)
}

/** A store's product: the URL itself when it is one, else the first product Shopify lists. */
async function someProduct(raw: string): Promise<string | null> {
  const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  if (/\/products\/[^/]+/.test(u.pathname)) return u.toString()
  const r = await fetch(`${u.origin}/products.json?limit=5`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) }).catch(() => null)
  const d = r && r.ok ? ((await r.json().catch(() => null)) as { products?: { handle?: string }[] } | null) : null
  const h = d?.products?.find((p) => p.handle)?.handle
  return h ? `${u.origin}/products/${h}` : null
}

/** Does the store serve Shopify's product list? Standard Shopify storefronts do, custom ones don't. */
async function productList(origin: string): Promise<boolean> {
  const r = await fetch(`${origin}/products.json?limit=1`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) }).catch(() => null)
  const d = r && r.ok ? ((await r.json().catch(() => null)) as { products?: unknown[] } | null) : null
  return !!d?.products?.length
}

export async function reportEligibility(url: string): Promise<Eligibility> {
  let key = url
  try { key = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).toString() } catch { return { ok: false, reason: 'bad url' } }
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 30 * 60_000) return hit.v
  let v: Eligibility
  try {
    const origin = new URL(key).origin
    // either signal is enough: the product's own data, or Shopify's product list (some stores rate-limit
    // one of them from servers). Custom storefronts serve neither.
    const product = await someProduct(key)
    if (product && (await productData(product))) v = { ok: true, reason: 'Shopify product data available', productUrl: product }
    else if (await productList(origin)) v = { ok: true, reason: 'Shopify product list available', productUrl: product || undefined }
    else v = { ok: false, reason: product ? 'no Shopify product data (custom storefront)' : 'no Shopify product found (custom storefront)' }
  } catch (e) {
    // can't tell: don't block a sale on our own hiccup
    v = { ok: true, reason: `check failed (${e instanceof Error ? e.message : 'error'}), allowed` }
  }
  cache.set(key, { at: Date.now(), v })
  return v
}
