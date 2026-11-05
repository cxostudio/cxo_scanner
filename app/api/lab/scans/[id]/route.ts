// One test scan for labelling. The scanner's answers stay hidden until ?reveal=1, so labels are blind.
import { NextRequest, NextResponse } from 'next/server'
import { deleteTestScan, getHiddenText, getLabels, getNotes, getTestScan, imageUrls, labAllowed, labelQueue, lastReadError } from '@/lib/lab/store'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!labAllowed(req.nextUrl.searchParams.get('key'))) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  try {
    const scan = await getTestScan(params.id)
    if (!scan) return NextResponse.json({ error: 'Scan not found', detail: lastReadError }, { status: 404 })
    const [labels, notes, urls, hiddenText] = await Promise.all([getLabels(scan.id), getNotes(scan.id), imageUrls(scan), getHiddenText(scan.id)])
    const reveal = req.nextUrl.searchParams.get('reveal') === '1'
    // history holds earlier answers: never sent, or labelling would not be blind
    const { history, rules: _rules, ...rest } = scan
    return NextResponse.json({
      ...rest,
      runs: (history?.length || 0) + 1,
      judgedAt: scan.judgedAt,
      // in page order, with the reason a checkpoint is left out of labelling
      checkpoints: labelQueue(scan),
      notes,
      hiddenText,
      answers: reveal ? scan.answers : undefined,
      images: scan.images.map((img, i) => ({ label: img.label, url: urls[i] })),
      labels,
    })
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message || e) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  if (!labAllowed(req.nextUrl.searchParams.get('key'))) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  try {
    return NextResponse.json({ ok: true, removed: await deleteTestScan(params.id) })
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message || e) }, { status: 500 })
  }
}
