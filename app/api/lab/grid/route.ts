// Test lab, grid labelling: one checkpoint across many stores at once.
// GET ?cp=rec…&limit=12 → the checkpoint's definition and, per store, the screenshots that show it,
// the scanner's answer, the current label and a saved suggestion (if any). Unlabelled stores with an
// answer first, so every click teaches the scanner something.
import { NextRequest, NextResponse } from 'next/server'
import { getLabels, getModes, getSuggestions, getTestScan, imageUrls, labAllowed, labelQueue, listTestScans, saveLabels, saveModes, type LabLabel } from '@/lib/lab/store'
import { pickImages } from '@/lib/lab/gridImages'
import { minLabels } from '@/lib/lab/verdict'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  if (!labAllowed(req.nextUrl.searchParams.get('key'))) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  const cp = req.nextUrl.searchParams.get('cp') || ''
  const limit = Math.min(24, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 12))
  if (!/^rec[A-Za-z0-9]{14}$/.test(cp)) return NextResponse.json({ error: 'cp required' }, { status: 400 })

  const list = await listTestScans()
  const loaded = (await Promise.all(list.map(async (s) => ({ scan: await getTestScan(s.id).catch(() => null), labels: await getLabels(s.id).catch(() => ({}) as Record<string, string>) })))).filter(
    (x): x is { scan: NonNullable<typeof x.scan>; labels: Record<string, string> } => !!x.scan,
  )
  const rows = loaded
    .map(({ scan, labels }) => {
      const c = labelQueue(scan).find((x) => x.id === cp && x.skip !== 'niche')
      if (!c) return null
      const a = scan.answers.find((x) => x.id === cp)
      const answered = Boolean(a && a.answer !== 'unknown' && !a.coveredByShopify)
      return { scan, checkpoint: c, answer: a, label: labels[cp] || null, answered }
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
  const def = rows[0]?.checkpoint
  if (!def) return NextResponse.json({ error: 'No lab scan has this checkpoint' }, { status: 404 })
  const labelled = rows.filter((r) => r.label && r.label !== 'skip').length

  // unlabelled with an answer first, then unlabelled, then the labelled ones (to review)
  const order = (r: (typeof rows)[number]) => (r.label ? 2 : r.answered ? 0 : 1)
  const pick = rows.sort((a, b) => order(a) - order(b) || a.scan.id.localeCompare(b.scan.id)).slice(0, limit)

  const stores = await Promise.all(
    pick.map(async (r) => {
      const urls = await imageUrls(r.scan).catch(() => [] as string[])
      const labels = r.scan.images.map((i) => i.label)
      const idx = pickImages(r.checkpoint, labels, r.answer?.seen)
      const sugg = (await getSuggestions(r.scan.id).catch(() => ({}) as Awaited<ReturnType<typeof getSuggestions>>))[cp] || null
      return {
        id: r.scan.id,
        url: r.scan.url,
        label: r.label,
        answer: r.answer ? { answer: r.answer.answer, reason: r.answer.reason, by: r.answer.by, coveredByShopify: r.answer.coveredByShopify } : null,
        images: idx.map((i) => ({ label: labels[i], url: urls[i] })).filter((x) => x.url),
        suggestion: sugg,
      }
    }),
  )
  return NextResponse.json({
    checkpoint: { id: def.id, title: def.title, pass: def.pass, fail: def.fail, na: def.na, method: def.method, area: def.area, device: def.device, status: def.status },
    min: minLabels(def.method),
    labelled,
    total: rows.length,
    stores,
  })
}

// POST { scan, cp, label } → saves one label, merged on the server (label null removes it).
// The grid shows the scanner's answer, so the label is recorded as a "review" label.
export async function POST(req: NextRequest) {
  if (!labAllowed(req.nextUrl.searchParams.get('key'))) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  const b = (await req.json().catch(() => ({}))) as { scan?: string; cp?: string; label?: string | null }
  if (!b.scan || !b.cp || !/^rec[A-Za-z0-9]{14}$/.test(b.cp)) return NextResponse.json({ error: 'scan and cp required' }, { status: 400 })
  if (b.label != null && !['pass', 'fail', 'na', 'skip'].includes(b.label)) return NextResponse.json({ error: 'bad label' }, { status: 400 })
  const scan = await getTestScan(b.scan)
  if (!scan || !scan.checkpoints.some((c) => c.id === b.cp)) return NextResponse.json({ error: 'Scan or checkpoint not found' }, { status: 404 })
  const [labels, modes] = await Promise.all([getLabels(scan.id), getModes(scan.id)])
  if (b.label == null) {
    delete labels[b.cp]
    delete modes[b.cp]
  } else {
    labels[b.cp] = b.label as LabLabel
    modes[b.cp] = 'review'
  }
  await Promise.all([saveLabels(scan.id, labels), saveModes(scan.id, modes)])
  return NextResponse.json({ ok: true })
}
