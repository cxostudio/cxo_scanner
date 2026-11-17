// Test lab: a cropped screenshot becomes a good example of a checkpoint. The image is saved in the lab
// storage and attached to the checkpoint's "Examples" field in Airtable (existing examples are kept).
import { NextRequest, NextResponse } from 'next/server'
import { getListRecordsBaseUrl } from '@/lib/conversionCheckpoints/getCheckpointRules'
import { labAllowed, logPromotion, saveExample } from '@/lib/lab/store'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function POST(req: NextRequest) {
  if (!labAllowed(req.nextUrl.searchParams.get('key'))) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  const body = (await req.json().catch(() => ({}))) as { id?: string; image?: string; store?: string; label?: string }
  if (!body.id || !/^rec[A-Za-z0-9]{14}$/.test(body.id) || !body.image?.startsWith('data:image/jpeg;base64,'))
    return NextResponse.json({ error: 'Need a checkpoint id and a JPEG image.' }, { status: 400 })
  const jpeg = Buffer.from(body.image.split(',')[1], 'base64')
  if (jpeg.length > 3_000_000) return NextResponse.json({ error: 'Image too large: crop a smaller area.' }, { status: 413 })

  const apiUrl = process.env.API_URL ?? 'https://api.airtable.com/v0/app1HP8C17pAMjacf/Conversion%20Checkpoints'
  const apiKey = process.env.API_KEY
  if (!apiKey) return NextResponse.json({ error: 'API_KEY missing on this deployment.' }, { status: 500 })
  const recordUrl = `${getListRecordsBaseUrl(apiUrl)}/${body.id}`
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }

  try {
    const url = await saveExample(body.id, jpeg)
    // keep what is there: Airtable replaces the whole attachment list on update
    const current = await fetch(recordUrl, { headers, cache: 'no-store' }).then((r) => r.json())
    const existing = ((current?.fields?.Examples as { id: string }[]) || []).map((a) => ({ id: a.id }))
    const filename = `${(body.store || 'example').replace(/[^a-z0-9.-]/gi, '-')}-${(body.label || '').replace(/[^a-z0-9]/gi, '-').slice(0, 40)}.jpg`
    const res = await fetch(recordUrl, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ fields: { Examples: [...existing, { url, filename }] } }),
      cache: 'no-store',
    })
    const out = await res.json().catch(() => ({}))
    if (!res.ok) {
      const msg = (out as any)?.error?.message || (out as any)?.error?.type || res.status
      return NextResponse.json({ error: `Airtable refused the example (${msg}). The token needs write access to this base.` }, { status: 502 })
    }
    await logPromotion({ id: body.id, action: 'example', store: body.store, label: body.label }).catch(() => {})
    return NextResponse.json({ ok: true, examples: existing.length + 1 })
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message || e) }, { status: 500 })
  }
}
