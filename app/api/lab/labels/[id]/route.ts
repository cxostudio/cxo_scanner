// Louis's blind labels for one test scan: { [checkpointId]: 'pass' | 'fail' | 'na' | 'skip' },
// or { labels, notes } with a short note per checkpoint.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getTestScan, labAllowed, saveLabels, saveModes, saveNotes } from '@/lib/lab/store'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const Labels = z.record(z.enum(['pass', 'fail', 'na', 'skip']))
const Body = z.union([z.object({ labels: Labels, notes: z.record(z.string().max(1000)).optional(), modes: z.record(z.enum(['blind', 'review'])).optional() }), Labels])

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  if (!labAllowed(req.nextUrl.searchParams.get('key'))) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid labels' }, { status: 400 })
  const body = 'labels' in parsed.data && typeof parsed.data.labels === 'object' ? (parsed.data as { labels: Record<string, 'pass' | 'fail' | 'na' | 'skip'>; notes?: Record<string, string>; modes?: Record<string, 'blind' | 'review'> }) : { labels: parsed.data as Record<string, 'pass' | 'fail' | 'na' | 'skip'>, notes: undefined, modes: undefined }
  try {
    const scan = await getTestScan(params.id)
    if (!scan) return NextResponse.json({ error: 'Scan not found' }, { status: 404 })
    const known = new Set(scan.checkpoints.map((c) => c.id))
    const clean = Object.fromEntries(Object.entries(body.labels).filter(([k]) => known.has(k)))
    await saveLabels(scan.id, clean)
    if (body.notes) await saveNotes(scan.id, Object.fromEntries(Object.entries(body.notes).filter(([k, v]) => known.has(k) && v.trim())))
    if (body.modes) await saveModes(scan.id, Object.fromEntries(Object.entries(body.modes).filter(([k]) => known.has(k) && clean[k])))
    return NextResponse.json({ ok: true, labelled: Object.keys(clean).length })
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message || e) }, { status: 500 })
  }
}
