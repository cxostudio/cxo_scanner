import { NextRequest, NextResponse } from 'next/server'
import { getJob, listJobsByPrefix } from '@/lib/scanJobs/store'
import { startPageJob } from '@/lib/fullReport/run'
import { detectPageTypeFromUrl } from '@/lib/conversionCheckpoints/pageType'

export const runtime = 'nodejs'
export const maxDuration = 30

const RESCANS = 3
const host = (u: string) => { try { return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname.toLowerCase().replace(/^www\./, '') } catch { return '' } }

/**
 * "Scan another page": the buyer swaps the report's collection or product page for one they choose.
 * POST { page: 'category' | 'product', url } → { id }. Same store only, the right kind of page, 3 per report.
 * The old results stay until the new scan is done (the report API shows the latest finished one).
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const b = (await request.json().catch(() => ({}))) as { page?: string; url?: string }
  const page = b.page === 'category' || b.page === 'product' ? b.page : null
  let url = (b.url || '').trim()
  if (!page || !url) return NextResponse.json({ error: 'Paste the link of a page from your store.' }, { status: 400 })
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  try { url = new URL(url).toString() } catch { return NextResponse.json({ error: "That doesn't look like a link." }, { status: 400 }) }

  const parent = /^[0-9a-f-]{36}$/i.test(params.id) ? await getJob(params.id).catch(() => null) : null
  if (!parent || !parent.scan_id.startsWith('report_') || parent.scan_id.includes('__')) return NextResponse.json({ error: 'Report not found.' }, { status: 404 })
  if (parent.status !== 'done') return NextResponse.json({ error: 'Your report is still being built. Try again in a few minutes.' }, { status: 409 })

  const pages = await listJobsByPrefix(`${parent.scan_id}__`)
  // same store: its own domain, or one the report already scanned (www., a market subdomain like de.huel.com)
  const known = new Set([host(parent.url), ...pages.map((j) => host(j.url))])
  const h = host(url)
  const sameStore = Array.from(known).some((k) => k && (h === k || h.endsWith(`.${k}`) || k.endsWith(`.${h}`)))
  if (!sameStore) return NextResponse.json({ error: `Use a page from ${host(parent.url)}.` }, { status: 400 })
  const kind = detectPageTypeFromUrl(url)
  if (kind !== page) return NextResponse.json({ error: page === 'category' ? 'That link is not a collection page. Paste a link that contains /collections/.' : 'That link is not a product page. Paste a link that contains /products/.' }, { status: 400 })

  const done = pages.filter((j) => j.scan_id.includes('~'))
  if (done.length >= RESCANS) return NextResponse.json({ error: `You have used your ${RESCANS} page changes for this report.` }, { status: 429 })
  if (pages.some((j) => j.answers?.page === page && j.status !== 'done' && j.status !== 'failed')) return NextResponse.json({ error: 'That page is already being scanned.' }, { status: 409 })

  const job = await startPageJob(parent, page, url, 'chosen by you', `~${done.length + 1}`)
  return NextResponse.json({ id: job.id, rescansLeft: RESCANS - done.length - 1 })
}
