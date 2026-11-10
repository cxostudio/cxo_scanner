// GET /api/sitecheck?k=<password> — the CXO checklist run on the client's own pages (home, collection, product).
// Each page is a lab scan "client-<key>-<page>": Louis can label it like any test scan, and a re-scan
// replaces it. Clients only see Live checkpoints, with today's wording and fix from Airtable.
import type { NextApiRequest, NextApiResponse } from 'next'
import { resolveClient } from '../../lib/portal/clients.js'
import { getTestScan } from '../../lib/lab/store'
import { getConversionCheckpointRules } from '../../lib/conversionCheckpoints/getCheckpointRules'

export const PAGE_ORDER = ['home', 'collection', 'product', 'cart', 'checkout'] as const

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const k = String(req.query.k || '')
  if (!k) return res.status(403).json({ error: 'Missing password' })
  const who = resolveClient(k) as { key: string; cfg: { pages?: Record<string, string> } } | null
  if (!who) return res.status(403).json({ error: 'Invalid password' })
  const pages = who.cfg.pages
  if (!pages) return res.status(404).json({ error: 'not_enabled' })

  const rulesRes = await getConversionCheckpointRules().catch(() => null)
  const current = new Map((rulesRes && rulesRes.ok ? rulesRes.rules : []).map((r) => [r.id, r]))

  const out = []
  for (const page of Object.keys(pages)) {
    const scan = await getTestScan(`client-${who.key}-${page}`).catch(() => null)
    if (!scan) {
      out.push({ page, url: pages[page], scannedAt: null, items: [] })
      continue
    }
    const items = scan.answers
      .map((a) => {
        const r = current.get(a.id)
        if (!r || r.status !== 'Live') return null
        return {
          id: a.id,
          title: r.title,
          area: r.area || 'Page-wide',
          device: r.device || 'Both',
          status: a.coveredByShopify ? 'pass' : a.answer,
          reason: a.reason,
          fix: r.shortFix || null,
          impact: r.impact ?? null,
        }
      })
      .filter(Boolean)
    out.push({ page, url: scan.url || pages[page], scannedAt: scan.judgedAt || scan.createdAt, items })
  }
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600')
  return res.status(200).json({ client: who.key, pages: out })
}
