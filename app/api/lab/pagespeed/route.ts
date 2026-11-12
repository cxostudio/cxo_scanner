// Test lab: what Google PageSpeed (Lighthouse) returns for a page, every audit with its score,
// so measured checkpoints can be mapped to real audit ids. The API key stays on the server.
import { NextRequest, NextResponse } from 'next/server'
import { labAllowed } from '@/lib/lab/store'

export const dynamic = 'force-dynamic'
export const maxDuration = 90

export async function GET(req: NextRequest) {
  if (!labAllowed(req.nextUrl.searchParams.get('key'))) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  const url = req.nextUrl.searchParams.get('url')
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 })
  const strategy = req.nextUrl.searchParams.get('strategy') === 'desktop' ? 'desktop' : 'mobile'
  const key = process.env.PAGESPEED_API_KEY ? `&key=${process.env.PAGESPEED_API_KEY}` : ''
  const cats = ['performance', 'accessibility', 'best-practices', 'seo'].map((c) => `&category=${c}`).join('')
  const res = await fetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}${cats}${key}`, { signal: AbortSignal.timeout(85000) })
  if (!res.ok) return NextResponse.json({ error: `PageSpeed answered ${res.status}` }, { status: 502 })
  const d = (await res.json()) as any
  const lr = d.lighthouseResult || {}
  const audits = Object.fromEntries(
    Object.entries(lr.audits || {}).map(([id, a]: [string, any]) => [
      id,
      { score: a.score, mode: a.scoreDisplayMode, title: a.title, value: a.displayValue ?? null, items: Array.isArray(a.details?.items) ? a.details.items.length : null, savingsMs: a.metricSavings?.LCP ?? a.details?.overallSavingsMs ?? null, savingsBytes: a.details?.overallSavingsBytes ?? null },
    ]),
  )
  const detail = (req.nextUrl.searchParams.get('detail') || '').split(',').filter(Boolean)
  const details = Object.fromEntries(detail.map((id) => [id, lr.audits?.[id]?.details ?? null]))
  return NextResponse.json({ details, version: lr.lighthouseVersion, categories: Object.fromEntries(Object.entries(lr.categories || {}).map(([k, c]: [string, any]) => [k, c.score])), audits })
}
