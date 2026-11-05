// One test scan for labelling. The scanner's answers stay hidden until ?reveal=1, so labels are blind.
import { NextRequest, NextResponse } from 'next/server'
import { getLabels, getTestScan, imageUrls, labAllowed, lastReadError } from '@/lib/lab/store'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!labAllowed(req.nextUrl.searchParams.get('key'))) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  try {
    const scan = await getTestScan(params.id)
    if (!scan) return NextResponse.json({ error: 'Scan not found', detail: lastReadError }, { status: 404 })
    const [labels, urls] = await Promise.all([getLabels(scan.id), imageUrls(scan)])
    const reveal = req.nextUrl.searchParams.get('reveal') === '1'
    // history holds earlier answers: never sent, or labelling would not be blind
    const { history, rules: _rules, ...rest } = scan
    return NextResponse.json({
      ...rest,
      runs: (history?.length || 0) + 1,
      judgedAt: scan.judgedAt,
      answers: reveal ? scan.answers : undefined,
      images: scan.images.map((img, i) => ({ label: img.label, url: urls[i] })),
      labels,
    })
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message || e) }, { status: 500 })
  }
}
