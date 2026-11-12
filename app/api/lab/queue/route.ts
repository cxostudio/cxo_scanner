// Test lab: label one checkpoint across every store that has it.
// GET            → checkpoints with how many stores have them and how many are labelled (most needed first)
// GET ?cp=rec…   → the scans with that checkpoint, labelled or not, in a stable order
import { NextRequest, NextResponse } from 'next/server'
import { MIN_LABELS } from '@/lib/lab/verdict'
import { getLabels, getTestScan, labAllowed, labelQueue, listTestScans, type LabScan } from '@/lib/lab/store'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  if (!labAllowed(req.nextUrl.searchParams.get('key'))) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  const list = await listTestScans()
  const loaded = (
    await Promise.all(list.map(async (s) => ({ scan: await getTestScan(s.id).catch(() => null), labels: await getLabels(s.id).catch(() => ({}) as Record<string, string>) })))
  ).filter((x): x is { scan: LabScan; labels: Record<string, string> } => !!x.scan)
  loaded.sort((a, b) => a.scan.id.localeCompare(b.scan.id))

  const cp = req.nextUrl.searchParams.get('cp')
  if (cp) {
    const scans = loaded
      .filter(({ scan }) => labelQueue(scan).some((c) => c.id === cp && c.skip !== 'niche'))
      .map(({ scan, labels }) => {
        const a = scan.answers.find((x) => x.id === cp)
        return { id: scan.id, url: scan.url, label: labels[cp] || null, answered: Boolean(a && a.answer !== 'unknown') }
      })
      // scans where the scanner gave an answer first: a label on a "couldn't check" teaches nothing
      // (older scans have no data for new measurements)
      .sort((a, b) => Number(b.answered) - Number(a.answered))
    return NextResponse.json({ cp, scans })
  }

  const rows = new Map<string, { id: string; title: string; status?: string; area?: string; method?: string; stores: number; labelled: number }>()
  for (const { scan, labels } of loaded) {
    for (const c of labelQueue(scan)) {
      // measured checkpoints are in too: a new measurement needs your eye before it can go Live
      if (c.skip === 'niche') continue
      const r = rows.get(c.id) || { id: c.id, title: c.title, status: c.status, area: c.area, method: c.method, stores: 0, labelled: 0 }
      r.stores++
      if (labels[c.id] && labels[c.id] !== 'skip') r.labelled++
      rows.set(c.id, r)
    }
  }
  // most useful first: checkpoints still short of the labels needed to go Live, then the rest
  const checkpoints = Array.from(rows.values()).sort((a, b) => {
    const need = (r: typeof a) => (r.labelled < MIN_LABELS ? 0 : 1)
    return need(a) - need(b) || a.labelled - b.labelled || b.stores - a.stores
  })
  return NextResponse.json({ min: MIN_LABELS, checkpoints })
}
