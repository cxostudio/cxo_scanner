// Test lab: judge saved test scans again, on the same evidence, with the checkpoint definitions as
// they are in Airtable right now. Louis labels each store once; we iterate definitions and the
// judge until a checkpoint reaches 90%, without new scans or new labels.
import { NextRequest, NextResponse } from 'next/server'
import { refreshCheckpointRulesCache, type ScanRule } from '@/lib/conversionCheckpoints/getCheckpointRules'
import { filterCheckpointsByUrl } from '@/lib/conversionCheckpoints/filterByUrlPageType'
import { judgeEvidence } from '@/lib/scanV2'
import { V2_MODEL } from '@/lib/scanV2/judge'
import { getLabels, getTestScan, labAllowed, listTestScans, loadEvidence, saveRejudge, type LabLabel, type LabScan } from '@/lib/lab/store'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 300

/** Share of labelled checkpoints (not "can't tell") where the scanner gave the same answer. */
function agreement(answers: LabScan['answers'], labels: Record<string, LabLabel>) {
  let n = 0
  let agree = 0
  for (const a of answers) {
    const l = labels[a.id]
    if (!l || l === 'skip') continue
    n++
    if (a.answer === l) agree++
  }
  return n ? { agree, labelled: n } : null
}

type Fresh = { records: { id: string; fields?: Record<string, unknown> }[]; rules: ScanRule[] }

async function rejudgeOne(id: string, current: Map<string, ScanRule>, fresh: Fresh, apiKey: string) {
  const scan = await getTestScan(id)
  if (!scan) return { id, ok: false, error: 'not found' }
  const ev = await loadEvidence(scan)
  if (!ev) return { id, ok: false, url: scan.url, error: 'saved before evidence was kept: scan this store again' }
  // same checkpoints as the original scan, with today's definitions (stored copy if gone from Airtable)
  const stored = new Map((scan.rules || []).map((r) => [r.id, r]))
  const rules = scan.checkpoints.map((c) => current.get(c.id) || stored.get(c.id)).filter(Boolean) as ScanRule[]
  // checkpoints added in Airtable since the scan (same page type, Live or Draft) join it unlabelled
  const have = new Set(rules.map((r) => r.id))
  const added = filterCheckpointsByUrl(fresh.records, fresh.rules, scan.url, { includeDrafts: true }).rules.filter((r) => !have.has(r.id))
  rules.push(...added)
  const labels = await getLabels(scan.id)
  const before = agreement(scan.answers, labels)
  const { results, niche } = await judgeEvidence(ev, rules, apiKey)
  const next = await saveRejudge(scan, { rules, results, niche, model: V2_MODEL() })
  return { id, ok: true, url: scan.url, before, after: agreement(next.answers, labels), added: added.length }
}

export async function POST(req: NextRequest) {
  if (!labAllowed(req.nextUrl.searchParams.get('key'))) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'OPENROUTER_API_KEY is not set' }, { status: 500 })
  try {
    // fresh definitions: an edit in Airtable counts at once (the scan cache is kept for a day)
    const fresh = await refreshCheckpointRulesCache()
    if (!fresh.ok) return NextResponse.json({ error: 'Could not read Airtable', detail: fresh.body }, { status: 502 })
    const current = new Map(fresh.data.rules.map((r) => [r.id, r]))

    const one = req.nextUrl.searchParams.get('id')
    const ids = one ? [one] : (await listTestScans()).map((s) => s.id)
    const out: Awaited<ReturnType<typeof rejudgeOne>>[] = []
    // a few at a time: each re-judge sends ~20 screenshots per checkpoint group
    for (let i = 0; i < ids.length; i += 3) {
      const batch = await Promise.all(ids.slice(i, i + 3).map((id) => rejudgeOne(id, current, fresh.data, apiKey).catch((e) => ({ id, ok: false, error: (e as Error)?.message || JSON.stringify(e) }))))
      out.push(...batch)
    }
    return NextResponse.json({ model: V2_MODEL(), scans: out })
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message || e) }, { status: 500 })
  }
}
