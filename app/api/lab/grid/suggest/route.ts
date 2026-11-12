// Test lab, grid labelling: a suggested label for one store, from a second model that is not the
// scanner's (a stronger one), looking at the same screenshots with the checkpoint's definition.
// Saved, so it is paid for once. POST { cp, scan } → { label, why, model }
import { NextRequest, NextResponse } from 'next/server'
import { OpenRouter } from '@openrouter/sdk'
import { getSuggestions, getTestScan, imageUrls, labAllowed, labelQueue, saveSuggestions, type LabLabel } from '@/lib/lab/store'
import { pickImages } from '@/lib/lab/gridImages'

export const dynamic = 'force-dynamic'
export const maxDuration = 90

const MODEL = process.env.OPENROUTER_SUGGEST_MODEL || 'google/gemini-2.5-pro'

export async function POST(req: NextRequest) {
  if (!labAllowed(req.nextUrl.searchParams.get('key'))) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  const body = (await req.json().catch(() => ({}))) as { cp?: string; scan?: string; force?: boolean }
  if (!body.cp || !body.scan) return NextResponse.json({ error: 'cp and scan required' }, { status: 400 })
  const saved = await getSuggestions(body.scan).catch(() => ({}) as Awaited<ReturnType<typeof getSuggestions>>)
  if (saved[body.cp] && !body.force) return NextResponse.json(saved[body.cp])

  const scan = await getTestScan(body.scan)
  if (!scan) return NextResponse.json({ error: 'Scan not found' }, { status: 404 })
  const cp = labelQueue(scan).find((c) => c.id === body.cp)
  if (!cp) return NextResponse.json({ error: 'Checkpoint not in this scan' }, { status: 404 })
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'OPENROUTER_API_KEY missing' }, { status: 500 })

  const urls = await imageUrls(scan)
  const labels = scan.images.map((i) => i.label)
  const idx = pickImages(cp, labels)
  const imgs = idx.map((i) => urls[i]).filter(Boolean)
  if (!imgs.length) return NextResponse.json({ error: 'No screenshot for this checkpoint' }, { status: 422 })

  const prompt = `You are a senior e-commerce CRO specialist labelling a test set. Look at the screenshots of ${scan.url} and answer one checkpoint.

Checkpoint: ${cp.title}
Pass when: ${cp.pass || '(not set)'}
Fail when: ${cp.fail || '(not set)'}
Not relevant when: ${cp.na || '(not set)'}

Judge only what the screenshots show. If they do not show the part of the page the checkpoint is about, answer "skip".
Reply with JSON only: {"label":"pass"|"fail"|"na"|"skip","why":"one short sentence citing what you see"}`

  const client = new OpenRouter({ apiKey })
  let out: { label?: string; why?: string } = {}
  try {
    const res = (await client.chat.send({
      model: MODEL,
      temperature: 0,
      maxTokens: 400,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, ...imgs.map((u) => ({ type: 'image_url' as const, imageUrl: { url: u } }))] }],
      responseFormat: { type: 'json_object' },
    } as never)) as { choices?: { message?: { content?: unknown } }[] }
    const content = res.choices?.[0]?.message?.content
    const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((c: any) => c?.text || '').join('') : ''
    out = JSON.parse(text.replace(/^```(json)?|```$/g, '').trim())
  } catch (e) {
    return NextResponse.json({ error: `Suggestion failed: ${(e as Error)?.message || e}` }, { status: 502 })
  }
  const label = (['pass', 'fail', 'na', 'skip'].includes(out.label || '') ? out.label : 'skip') as LabLabel
  const s = { label, why: String(out.why || '').slice(0, 300), model: MODEL, at: new Date().toISOString() }
  await saveSuggestions(body.scan, { ...saved, [body.cp]: s })
  return NextResponse.json(s)
}
