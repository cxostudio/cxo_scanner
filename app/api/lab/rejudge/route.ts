// Test lab: judge saved test scans again, on the same evidence, with the checkpoint definitions as
// they are in Airtable right now. Louis labels each store once; we iterate definitions and the
// judge until a checkpoint reaches 90%, without new scans or new labels.
import { judgeErrors } from '@/lib/scanV2/judge'
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
    if (!l || l === 'skip' || a.answer === 'unknown') continue
    n++
    if (a.answer === l) agree++
  }
  return n ? { agree, labelled: n } : null
}

type Fresh = { records: { id: string; fields?: Record<string, unknown> }[]; rules: ScanRule[] }

/** Dry run: each checkpoint's proposed definitions (Proposed pass/fail/not relevant when) instead of the live ones. */
function withProposed(fresh: Fresh, only?: Set<string>): Map<string, ScanRule> {
  const rec = new Map(fresh.records.map((r) => [r.id, (r.fields || {}) as Record<string, unknown>]))
  const str = (f: Record<string, unknown>, k: string) => (typeof f[k] === 'string' && (f[k] as string).trim() ? (f[k] as string).trim() : undefined)
  return new Map(
    fresh.rules.map((r) => {
      const f = rec.get(r.id) || {}
      if (only && !only.has(r.id)) return [r.id, r]
      // without ?cps= only rewrites still in review; a checkpoint named in ?cps= is tested whatever its status
      if (!only && !['To review', 'Approved', 'Changes needed'].includes(String(f['Rewrite'] || ''))) return [r.id, r]
      return [r.id, { ...r, pass: str(f, 'Proposed pass when') ?? r.pass, fail: str(f, 'Proposed fail when') ?? r.fail, na: str(f, 'Proposed not relevant when') ?? r.na }]
    }),
  )
}

async function rejudgeOne(id: string, current: Map<string, ScanRule>, fresh: Fresh, apiKey: string, guards = true, gallery = false, nicheOverride?: string, dry = false) {
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
  // the store's niche was decided at scan time: keep it, so a re-judge only measures the definitions
  // (?niche= corrects a wrong one; it is saved with the re-judge)
  const keep = nicheOverride || scan.niche
  if (keep) (ev as { knownNiche?: string }).knownNiche = keep
  const { results, niche } = await judgeEvidence(ev, rules, apiKey, { guards, gallery })
  if (dry) {
    // nothing saved: per checkpoint, the live answer and the answer with the proposed wording, next to the label
    const was = new Map(scan.answers.map((a) => [a.id, a.answer]))
    const rows = results.map((r) => ({ id: r.ruleId, before: was.get(r.ruleId) || 'unknown', after: r.status, reason: r.reason, label: labels[r.ruleId] || null }))
    return { id, ok: true, url: scan.url, dry: true, rows, errors: judgeErrors.splice(0) }
  }
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
    // ?dry=1 judges with the proposed definitions and saves nothing (test before going live); ?cps=rec1,rec2 limits the override
    const dry = req.nextUrl.searchParams.get('dry') === '1'
    const cps = req.nextUrl.searchParams.get('cps')
    const current = dry ? withProposed(fresh.data, cps ? new Set(cps.split(',')) : undefined) : new Map(fresh.data.rules.map((r) => [r.id, r]))

    const one = req.nextUrl.searchParams.get('id')
    const ids = one ? [one] : (await listTestScans()).map((s) => s.id)
    const out: Awaited<ReturnType<typeof rejudgeOne>>[] = []
    // a few at a time: each re-judge sends ~20 screenshots per checkpoint group
    for (let i = 0; i < ids.length; i += 3) {
      const batch = await Promise.all(ids.slice(i, i + 3).map((id) => rejudgeOne(id, current, fresh.data, apiKey, req.nextUrl.searchParams.get('guards') !== '0', req.nextUrl.searchParams.get('gallery') === '1', req.nextUrl.searchParams.get('niche') || undefined, dry).catch((e) => ({ id, ok: false, error: (e as Error)?.message || JSON.stringify(e) }))))
      out.push(...batch)
    }
    return NextResponse.json({ model: V2_MODEL(), scans: out })
  } catch (e) {
    return NextResponse.json({ error: String((e as Error)?.message || e) }, { status: 500 })
  }
}
