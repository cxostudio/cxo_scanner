// Finish a free scan on the server, the same way the browser runs it on /scan/run, for when the
// visitor closed the tab. Calls this project's own API routes in the same order:
// resolve the product page → load the checkpoints → capture the previews → scan → combine.
import { detectPageTypeFromUrl, isTestEmail } from '@/lib/conversionCheckpoints/filterByUrlPageType'
import type { ScanJob, ScanSnapshot } from './store'

/** This deployment, reachable from itself (same rule as SCANNER_ORIGIN in lib/base.ts). */
export function selfOrigin(): string {
  if (process.env.SCAN_SELF_URL) return process.env.SCAN_SELF_URL.replace(/\/$/, '')
  if (process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_BRANCH_URL) return `https://${process.env.VERCEL_BRANCH_URL}`
  if (process.env.VERCEL_ENV === 'production') return 'https://audit.cxo.studio'
  return 'http://localhost:3000'
}
const api = (p: string) => `${selfOrigin()}/scan/api${p}`
const CART = 'recdyiscpsbfrbbha'

type Rule = { id: string; title: string; freeScan?: boolean; pageTypeIds?: string[] } & Record<string, unknown>

export async function previews(url: string): Promise<{ desktop: string | null; mobile: string | null }> {
  const out = { desktop: null as string | null, mobile: null as string | null }
  try {
    const res = await fetch(api('/preview_website'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) })
    if (!res.ok || !res.body) return out
    const text = await res.text()
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        const m = JSON.parse(line) as Record<string, unknown>
        const d = (m.previewDesktop ?? (m.type === 'preview' ? m.preview : undefined)) as unknown
        if (typeof d === 'string' && d.length > 80) out.desktop = d
        if (typeof m.previewMobile === 'string' && m.previewMobile.length > 80) out.mobile = m.previewMobile
      } catch { /* a partial line */ }
    }
  } catch (e) {
    console.warn('[scan-job] preview failed', e)
  }
  return out
}

export async function runScanOnServer(job: ScanJob): Promise<ScanSnapshot> {
  const email = job.email
  let url = /^https?:\/\//i.test(job.url) ? job.url : `https://${job.url}`
  let resolvedFrom: string | undefined
  let resolvedHow: string | undefined

  // the free scan is a product-page scan: a homepage or collection becomes the best seller
  if (!isTestEmail(email) && detectPageTypeFromUrl(url) !== 'product') {
    try {
      const r = await fetch(api(`/resolve-product?url=${encodeURIComponent(url)}`))
      const d = (await r.json().catch(() => null)) as { url?: string; resolved?: boolean; how?: string } | null
      if (r.ok && d?.resolved && d.url) { resolvedFrom = url; resolvedHow = d.how || ''; url = d.url }
    } catch (e) { console.warn('[scan-job] resolve-product failed', e) }
  }

  const pageType = detectPageTypeFromUrl(url)
  const cpRes = await fetch(api(`/conversion-checkpoints?pageType=${encodeURIComponent(pageType)}` + (isTestEmail(email) ? `&email=${encodeURIComponent(email)}` : '')))
  if (!cpRes.ok) throw new Error(`checkpoints ${cpRes.status}`)
  const cp = (await cpRes.json()) as { rules?: Rule[] }
  const rules = Array.isArray(cp.rules) ? cp.rules : []
  if (!rules.length) throw new Error('no checkpoints for this page')
  const free = rules.filter((r) => r.freeScan)
  const scanRules = !isTestEmail(email) && free.length ? free : rules
  const pageOnly = rules.filter((r) => { const ids = (r.pageTypeIds || []).map((x) => x.toLowerCase()); return !(ids.length && ids.every((x) => x === CART)) }).length

  // previews and the scan run side by side, as in the browser
  const previewP = previews(url)
  let results: unknown[] = []
  let labId: string | null = null
  let lastErr = ''
  // with the email, so the scan counts once against the daily limit (it counts when a scan completes).
  // If the browser's run already counted it before the tab closed, the limit may now say no: then
  // the same scan runs without the email (it was allowed when it started).
  let withEmail = true
  for (let attempt = 1; attempt <= 3 && !results.length; attempt++) {
    const res = await fetch(api('/scan'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, rules: scanRules, captureScreenshot: true, scanId: job.scan_id, ...(withEmail ? { email } : {}) }) })
    const data = (await res.json().catch(() => ({}))) as { results?: unknown[]; labId?: string; error?: string }
    if (res.ok && Array.isArray(data.results)) { results = data.results; labId = data.labId || null; break }
    lastErr = data.error || `scan ${res.status}`
    if (res.status === 429 && withEmail) { withEmail = false; continue }
    if (res.status === 422) break  // the page can't be scanned: retrying won't help
  }
  if (!results.length) throw new Error(lastErr || 'scan failed')

  try {
    const c = await fetch(api('/scan/combine'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ results }) })
    if (c.ok) { const d = (await c.json()) as { results?: unknown[] }; if (Array.isArray(d.results)) results = d.results }
  } catch (e) { console.warn('[scan-job] combine failed, keeping raw results', e) }

  const p = await previewP
  return {
    results, scanUrl: url, revenue: job.answers?.revenue, aov: job.answers?.aov, cr: job.answers?.cr, locale: job.locale,
    pageChecks: pageOnly || rules.length, resolvedFrom, resolvedHow, labId, previewDesktop: p.desktop, previewMobile: p.mobile,
  }
}
