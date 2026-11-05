// Test lab: every saved test scan, with labelling progress and accuracy per checkpoint.
import { NextRequest, NextResponse } from 'next/server'
import { getLabels, getNotes, getTestScan, labAllowed, labelQueue, listTestScans, type LabLabel, type LabScan } from '@/lib/lab/store'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

export async function GET(req: NextRequest) {
  if (!labAllowed(req.nextUrl.searchParams.get('key'))) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  try {
    const list = await listTestScans()
    const loaded = await Promise.all(list.map(async (s) => ({ scan: await getTestScan(s.id), labels: await getLabels(s.id), notes: await getNotes(s.id) })))
    const scans = loaded.filter((x): x is { scan: LabScan; labels: Record<string, LabLabel>; notes: Record<string, string> } => !!x.scan)
    scans.sort((a, b) => b.scan.createdAt.localeCompare(a.scan.createdAt))

    // accuracy per checkpoint: scanner answer vs Louis's label, on labelled scans ("skip" and
    // the scanner's "couldn't check" are counted apart, never as agreement)
    const acc = new Map<string, { id: string; title: string; status?: string; labelled: number; agree: number; unknown: number; mismatches: { scan: string; url: string; ai: string; louis: string }[] }>()
    for (const { scan, labels } of scans) {
      const answers = new Map(scan.answers.map((a) => [a.id, a]))
      for (const cp of scan.checkpoints) {
        const louis = labels[cp.id]
        if (!louis || louis === 'skip') continue
        const ai = answers.get(cp.id)?.answer || 'unknown'
        const row = acc.get(cp.id) || { id: cp.id, title: cp.title, status: cp.status, labelled: 0, agree: 0, unknown: 0, mismatches: [] }
        row.title = cp.title
        row.status = cp.status
        row.labelled++
        if (ai === 'unknown') row.unknown++
        else if (ai === louis) row.agree++
        else row.mismatches.push({ scan: scan.id, url: scan.url, ai, louis })
        acc.set(cp.id, row)
      }
    }

    return NextResponse.json({
      scans: scans.map(({ scan, labels }) => {
        const queue = labelQueue(scan).filter((c) => !c.skip)
        return {
          id: scan.id,
          url: scan.url,
          createdAt: scan.createdAt,
          niche: scan.niche,
          checkpoints: queue.length,
          labelled: queue.filter((c) => labels[c.id]).length,
        }
      }),
      // every note, for the definition fixes
      notes: scans.flatMap(({ scan, notes }) =>
        Object.entries(notes).map(([id, note]) => ({ scan: scan.id, url: scan.url, id, title: scan.checkpoints.find((c) => c.id === id)?.title || id, note })),
      ),
      accuracy: Array.from(acc.values()).sort((a, b) => a.agree / a.labelled - b.agree / b.labelled),
    })
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message || e) }, { status: 500 })
  }
}
