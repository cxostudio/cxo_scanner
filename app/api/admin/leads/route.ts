// Lead dashboard API: every /start lead with its free scans, plus status and notes updates.
// Behind LAB_KEY, like the lab.
import { NextRequest, NextResponse } from 'next/server'
import { listLeads, updateLead, type Lead, type LeadScan, type LeadStatus } from '@/lib/leads/store'
import { estimate } from '@/lib/estimate'
import { isQualified } from '@/lib/report'

/** Leads hold real emails: unlike the lab, never open without the key, previews included. */
function allowed(key: string | null) {
  const expected = process.env.LAB_KEY?.trim()
  return !!expected && expected.length >= 24 && key === expected
}

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

/** Chunked scans write one row per request: fold rows that share a scan id into one scan. */
function mergeScans(rows: LeadScan[]): LeadScan[] {
  const byId = new Map<string, LeadScan>()
  for (const r of rows) {
    const k = r.scan_id || r.id
    const prev = byId.get(k)
    if (!prev) {
      byId.set(k, { ...r, results: [...(r.results || [])] })
      continue
    }
    const results = [...(prev.results || []), ...(r.results || [])]
    const n = (a: number | null, b: number | null) => (a || 0) + (b || 0)
    byId.set(k, {
      ...prev,
      results,
      passed: n(prev.passed, r.passed),
      failed: n(prev.failed, r.failed),
      na: n(prev.na, r.na),
      unknown: n(prev.unknown, r.unknown),
      // weighted the same way as the results page: high priority counts double
      score: (() => {
        let got = 0
        let max = 0
        for (const x of results) {
          if (x.answer === 'unknown') continue
          const w = x.priority === 'High' ? 2 : 1
          max += w
          if (x.answer !== 'fail') got += w
        }
        return max ? Math.round((got / max) * 100) : prev.score
      })(),
    })
  }
  return [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export async function GET(req: NextRequest) {
  if (!allowed(req.nextUrl.searchParams.get('key'))) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  try {
    const { leads, scans, scansError } = await listLeads()
    const scansByEmail = new Map<string, LeadScan[]>()
    for (const s of mergeScans(scans)) {
      const e = s.email.toLowerCase()
      scansByEmail.set(e, [...(scansByEmail.get(e) || []), s])
    }

    // one row per email: the newest /start answers, with every scan for that email
    const seen = new Set<string>()
    const rows: (Lead & { scans: LeadScan[]; leak: number | null; worthCall: boolean; test: boolean; earlier: number })[] = []
    for (const l of leads) {
      const e = l.email.toLowerCase()
      if (seen.has(e)) {
        const row = rows.find((r) => r.email.toLowerCase() === e)
        if (row) row.earlier++
        continue
      }
      seen.add(e)
      rows.push(build(l, scansByEmail.get(e) || []))
    }
    // scans started from a direct link, with no /start answers
    for (const [e, list] of scansByEmail) {
      if (seen.has(e)) continue
      rows.push(
        build(
          { id: `scan:${e}`, created_at: list[list.length - 1].created_at, email: e, name: null, site_type: 'ecommerce', platform: null, url: list[0].url, revenue_band: null, traffic_band: null, conversion_band: null, aov_band: null, goal: null, role: null, route: 'scan', locale: null, source: null },
          list,
        ),
      )
    }
    rows.sort((a, b) => latest(b).localeCompare(latest(a)))
    return NextResponse.json({ leads: rows, scansError })
  } catch (e) {
    return NextResponse.json({ error: String((e as Error).message || e) }, { status: 500 })
  }
}

const latest = (r: { created_at: string; scans: LeadScan[] }) => [r.created_at, ...r.scans.map((s) => s.created_at)].sort().pop() || ''

function build(l: Lead, scans: LeadScan[]) {
  const est = l.revenue_band ? estimate(l.revenue_band, l.aov_band || '', l.conversion_band || '') : null
  const last = scans[0]
  const qualified = !!l.revenue_band && isQualified(l.revenue_band)
  // worth a call: asked for one, or makes enough for the audit to pay off and the scan found real gaps
  const worthCall = l.route === 'call' || (qualified && !!last && (last.score ?? 100) < 80)
  return { ...l, scans, leak: est ? Math.round(est.lift10) : null, worthCall, test: scans.some((s) => s.test) || /@cxo\.studio$|\+test[^@]*@/i.test(l.email), earlier: 0 }
}

export async function PATCH(req: NextRequest) {
  if (!allowed(req.nextUrl.searchParams.get('key'))) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  const body = (await req.json().catch(() => ({}))) as { id?: string; status?: LeadStatus; notes?: string }
  if (!body.id || body.id.startsWith('scan:')) return NextResponse.json({ error: 'This lead has no /start answers to update.' }, { status: 400 })
  try {
    await updateLead(body.id, { status: body.status, notes: body.notes })
    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = String((e as Error).message || e)
    return NextResponse.json({ error: /status|notes/.test(msg) ? `${msg}. Run supabase/lead_scans.sql once in Supabase.` : msg }, { status: 500 })
  }
}
