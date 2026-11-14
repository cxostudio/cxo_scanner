// Test lab: review every Draft checkpoint and record a decision (Promote, Fix, Keep draft, Drop).
// GET  → Draft checkpoints with their definitions and the decision saved so far
// POST { id, decision?, note? } → saves "Review decision" / "Review decision note" in Airtable.
// The decision is a call, not an action: Claude carries it out (promote, rewrite, turn off).
import { NextRequest, NextResponse } from 'next/server'
import { fetchAllRecordsForFormula, getListRecordsBaseUrl } from '@/lib/conversionCheckpoints/getCheckpointRules'
import { labAllowed } from '@/lib/lab/store'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 60

const apiUrl = () => process.env.API_URL ?? 'https://api.airtable.com/v0/app1HP8C17pAMjacf/Conversion%20Checkpoints'
const DECISIONS = ['Promote', 'Fix', 'Keep draft', 'Drop'] as const
const PAGE: Record<string, string> = {
  recLGdSV5rIc0dKKu: 'Header and footer',
  rectBaIRZLGEI24hg: 'Home',
  recpwT9MNrFfKtE9i: 'Category',
  recq3OalwwOefG2x5: 'Product',
  recDYiScpsBfRbbha: 'Cart',
  recOkHTZH3nxsQNMb: 'Checkout',
  recZlFAhenCGEFSaV: 'Thank you',
  rec8FE5EGGRXaRbU5: 'Search',
}
const s = (v: unknown) => (typeof v === 'string' ? v : '')

export async function GET(req: NextRequest) {
  if (!labAllowed(req.nextUrl.searchParams.get('key'))) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  const apiKey = process.env.API_KEY
  if (!apiKey) return NextResponse.json({ error: 'API_KEY is not set' }, { status: 500 })
  const res = await fetchAllRecordsForFormula(getListRecordsBaseUrl(apiUrl()), apiKey, "{Scanner status} = 'Draft'")
  if (!res.ok) return NextResponse.json({ error: 'Could not read Airtable' }, { status: 502 })
  const items = res.records.map((r) => {
    const f = (r.fields || {}) as Record<string, unknown>
    const pages = (Array.isArray(f['Page Type']) ? (f['Page Type'] as string[]) : []).map((id) => PAGE[id] || '').filter(Boolean)
    return {
      id: r.id,
      title: s(f['Conversion Checkpoint']),
      page: pages[0] || 'Other',
      area: s(f['Page area']),
      method: s(f['Check method']),
      device: s(f['Device']),
      pass: s(f['Pass when']),
      fail: s(f['Fail when']),
      na: s(f['Not relevant when']),
      free: f['Free scan'] === true,
      decision: s(f['Review decision']),
      note: s(f['Review decision note']),
    }
  })
  return NextResponse.json({ items })
}

export async function POST(req: NextRequest) {
  if (!labAllowed(req.nextUrl.searchParams.get('key'))) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  const apiKey = process.env.API_KEY
  if (!apiKey) return NextResponse.json({ error: 'API_KEY is not set' }, { status: 500 })
  const body = (await req.json().catch(() => ({}))) as { id?: string; decision?: string | null; note?: string }
  if (!body.id || !/^rec[A-Za-z0-9]{14}$/.test(body.id)) return NextResponse.json({ error: 'Need a checkpoint id.' }, { status: 400 })
  const fields: Record<string, unknown> = {}
  if (body.decision !== undefined) {
    if (body.decision !== null && !DECISIONS.includes(body.decision as (typeof DECISIONS)[number])) return NextResponse.json({ error: 'Unknown decision.' }, { status: 400 })
    fields['Review decision'] = body.decision
  }
  if (body.note !== undefined) fields['Review decision note'] = String(body.note).slice(0, 5000)
  const r = await fetch(`${getListRecordsBaseUrl(apiUrl())}/${body.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!r.ok) return NextResponse.json({ error: 'Airtable refused', detail: await r.text() }, { status: 502 })
  return NextResponse.json({ ok: true, fields })
}
