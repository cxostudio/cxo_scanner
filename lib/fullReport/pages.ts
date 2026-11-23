// Which pages the full report scans for a store: the homepage, one collection, the best seller.
// The product scan also adds an item to the cart and opens checkout, so cart and checkout
// checkpoints come with it; store-wide checks (header, menu, footer, speed) are judged there too.
import { selfOrigin } from '@/lib/scanJobs/runServer'

export type ReportPageKey = 'homepage' | 'category' | 'product'
export type ReportPage = { key: ReportPageKey; url: string; how?: string }

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
const SKIP = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?collections\/(?:all|vendors|types|frontpage)(?:[/?#]|$)/i

/** The first real collection linked from the homepage (menu order), else /collections/all. */
async function firstCollection(origin: string): Promise<{ url: string; how: string }> {
  try {
    const ctl = AbortSignal.timeout(12000)
    const html = await (await fetch(origin, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: ctl, redirect: 'follow' })).text()
    const seen = new Set<string>()
    for (const m of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
      let href = m[1]
      try { const u = new URL(href, origin); if (u.origin !== new URL(origin).origin) continue; href = u.pathname } catch { continue }
      if (!/\/collections\/[^/]+\/?$/i.test(href) || SKIP.test(href) || seen.has(href)) continue
      seen.add(href)
      return { url: new URL(href, origin).toString(), how: 'first collection linked from the homepage' }
    }
  } catch (e) { console.warn('[report] homepage read failed', e) }
  return { url: `${origin}/collections/all`, how: 'all products' }
}

async function bestSeller(origin: string): Promise<{ url: string; how: string } | null> {
  try {
    const r = await fetch(`${selfOrigin()}/scan/api/resolve-product?url=${encodeURIComponent(origin)}`)
    const d = (await r.json().catch(() => null)) as { url?: string; resolved?: boolean; how?: string } | null
    if (r.ok && d?.resolved && d.url) return { url: d.url, how: d.how || 'best seller' }
  } catch (e) { console.warn('[report] resolve-product failed', e) }
  return null
}

export async function pickReportPages(raw: string): Promise<ReportPage[]> {
  const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  const origin = u.origin
  const [col, prod] = await Promise.all([firstCollection(origin), bestSeller(origin)])
  const pages: ReportPage[] = [{ key: 'homepage', url: `${origin}/`, how: 'homepage' }, { key: 'category', ...col }]
  // a product URL given by the buyer wins over our pick
  const given = /\/products\/[^/]+/i.test(u.pathname) ? { url: u.toString(), how: 'the page you gave us' } : null
  const p = given || prod
  if (p) pages.push({ key: 'product', ...p })
  return pages
}
