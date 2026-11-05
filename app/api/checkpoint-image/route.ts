import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/checkpoint-image?r=<record id>&i=<example index>&s=thumb|full
 *
 * A permanent address for a checkpoint's example image. Airtable attachment links expire
 * after a few hours, but scan results keep them (and visitors keep results in their
 * browser), so the links in results point here instead: this asks Airtable for a fresh
 * link at request time and streams the image, cached at the edge for a long time.
 */
export const runtime = 'nodejs'

const DEFAULT_TABLE = 'https://api.airtable.com/v0/app1HP8C17pAMjacf/Conversion%20Checkpoints'

type Attachment = { url?: string; thumbnails?: { large?: { url?: string }; full?: { url?: string } } }

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams
  const record = q.get('r') || ''
  const index = Math.max(0, parseInt(q.get('i') || '0', 10) || 0)
  const full = q.get('s') === 'full'
  if (!/^rec[A-Za-z0-9]{10,20}$/.test(record)) return new NextResponse('bad record', { status: 400 })

  const apiKey = process.env.API_KEY
  if (!apiKey) return new NextResponse('not configured', { status: 500 })
  const table = (process.env.API_URL || DEFAULT_TABLE).split('?')[0]

  try {
    const rec = await fetch(`${table}/${record}`, { headers: { Authorization: `Bearer ${apiKey}` }, cache: 'no-store' })
    if (!rec.ok) return new NextResponse('record not found', { status: 404 })
    const data = (await rec.json()) as { fields?: { Examples?: Attachment[] } }
    const att = data.fields?.Examples?.[index]
    const src = full ? att?.url : att?.thumbnails?.large?.url || att?.thumbnails?.full?.url || att?.url
    if (!src) return new NextResponse('no image', { status: 404 })

    const img = await fetch(src, { cache: 'no-store' })
    if (!img.ok || !img.body) return new NextResponse('image unavailable', { status: 502 })
    return new NextResponse(img.body, {
      headers: {
        'Content-Type': img.headers.get('content-type') || 'image/png',
        // browsers 1 week, Vercel's edge 30 days: Airtable is asked rarely
        'Cache-Control': 'public, max-age=604800, s-maxage=2592000, stale-while-revalidate=86400',
      },
    })
  } catch (e) {
    console.error('[checkpoint-image]', e)
    return new NextResponse('error', { status: 500 })
  }
}
