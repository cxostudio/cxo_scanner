// GET /api/precheck?url=… : the first step of cxo.studio/start. One plain request to the store,
// no browser, no AI, so it is instant and costs nothing:
//   - is it a Shopify store? (true / false / null when we can't tell, e.g. a bot wall)
//   - its name, its own icon (empty when it has none: the page then shows the Shopify logo) and share
//     image, so the visitor sees their store while answering
// The free scan itself still starts when the email is given (phase 1).
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 15

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
const SHOPIFY_HTML = /cdn\.shopify\.com|shopify\.theme|myshopify\.com|shopify-section|Shopify\.shop/i

const meta = (html: string, re: RegExp) => {
  const m = html.match(re)
  return m ? m[1].replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').trim() : ''
}

export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get('url') || '').trim()
  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    if (!url.hostname.includes('.')) throw new Error('no host')
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid url' }, { status: 400 })
  }
  const host = url.hostname.replace(/^www\./, '')
  const out = { ok: true, host, url: url.toString(), shopify: null as boolean | null, title: '', image: '', favicon: '' }
  try {
    const res = await fetch(url.toString(), { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(7000) })
    const headerSays = !!(res.headers.get('x-shopid') || res.headers.get('x-shopify-stage') || res.headers.get('x-sorting-hat-shopid') || /shopify/i.test(res.headers.get('powered-by') || ''))
    const html = (await res.text()).slice(0, 400_000)
    if (res.ok || headerSays) out.shopify = headerSays || SHOPIFY_HTML.test(html)
    // a bot wall or an error page tells us nothing: leave it unknown
    if (!res.ok && !headerSays) out.shopify = null
    out.title = meta(html, /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/i) || meta(html, /<title[^>]*>([^<]{1,120})/i)
    const img = meta(html, /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)/i)
    if (img) out.image = new URL(img.startsWith('//') ? `https:${img}` : img, res.url || url.toString()).toString()
    // the store's own icon, from its <link rel="icon">: no generic globe when it has none
    const icon = meta(html, /<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)/i) || meta(html, /<link[^>]+href=["']([^"']+)["'][^>]+rel=["'](?:shortcut )?icon["']/i)
    if (icon) out.favicon = new URL(icon.startsWith('//') ? `https:${icon}` : icon, res.url || url.toString()).toString()
  } catch {
    // unreachable or too slow: unknown, the scan will find out
  }
  return NextResponse.json(out, { headers: { 'Cache-Control': 'public, s-maxage=600' } })
}
