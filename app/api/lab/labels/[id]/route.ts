// Louis's blind labels for one test scan: { [checkpointId]: 'pass' | 'fail' | 'na' | 'skip' }
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getTestScan, labAllowed, saveLabels } from '@/lib/lab/store'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const Labels = z.record(z.enum(['pass', 'fail', 'na', 'skip']))

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  if (!labAllowed(req.nextUrl.searchParams.get('key'))) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  const parsed = Labels.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid labels' }, { status: 400 })
  try {
    const scan = await getTestScan(params.id)
    if (!scan) return NextResponse.json({ error: 'Scan not found' }, { status: 404 })
    const known = new Set(scan.checkpoints.map((c) => c.id))
    const clean = Object.fromEntries(Object.entries(parsed.data).filter(([k]) => known.has(k)))
    await saveLabels(scan.id, clean)
    return NextResponse.json({ ok: true, labelled: Object.keys(clean).length })
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message || e) }, { status: 500 })
  }
}
