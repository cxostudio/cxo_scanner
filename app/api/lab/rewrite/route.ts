// Test lab: review the checkpoint rewrites. GET lists every checkpoint with a Rewrite status
// (live fields next to the Proposed ones), plus a real finding from a lab scan so the card reads
// like a client report. POST saves Louis's verdict (Rewrite + Rewrite comment) in Airtable.
import { NextRequest, NextResponse } from 'next/server'
import { fetchAllRecordsForFormula, getListRecordsBaseUrl, type AirtableSingleRecord } from '@/lib/conversionCheckpoints/getCheckpointRules'
import { getLabels, getTestScan, labAllowed, listTestScans } from '@/lib/lab/store'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 60

const PAGE: Record<string, string> = {
  recLGdSV5rIc0dKKu: 'Header, footer and navigation',
  rectBaIRZLGEI24hg: 'Home',
  recpwT9MNrFfKtE9i: 'Category',
  recq3OalwwOefG2x5: 'Product',
  recDYiScpsBfRbbha: 'Cart',
  recOkHTZH3nxsQNMb: 'Checkout',
  recZlFAhenCGEFSaV: 'Thank you',
  rec8FE5EGGRXaRbU5: 'Search',
}
const ORDER = ['Home', 'Header, footer and navigation', 'Category', 'Product', 'Cart', 'Checkout', 'Search', 'Thank you']
const VERDICTS = ['To review', 'Approved', 'Changes needed'] as const
const PROPOSED: Record<string, string> = {
  title: 'Proposed title',
  pass: 'Proposed pass when',
  fail: 'Proposed fail when',
  na: 'Proposed not relevant when',
  fix: 'Proposed short fix',
  actions: 'Proposed required actions',
  why: 'Proposed justification',
}
const LIVE: Record<string, string> = {
  title: 'Conversion Checkpoint',
  pass: 'Pass when',
  fail: 'Fail when',
  na: 'Not relevant when',
  fix: 'Short fix',
  actions: 'Required Actions',
  why: 'Justifications & Benefits',
}

const apiUrl = () => process.env.API_URL ?? 'https://api.airtable.com/v0/app1HP8C17pAMjacf/Conversion%20Checkpoints'

export type ReviewText = { title: string; pass: string; fail: string; na: string; fix: string; actions: string; why: string }
export type ReviewItem = {
  id: string
  page: string
  status: string
  area: string
  method: string
  rewrite: string
  comment: string
  notes: string
  now: ReviewText
  proposed: ReviewText
  examples: { url: string; filename: string; thumbnailUrl: string }[]
  finding?: { host: string; scan: string; reason: string; answer: string }
}

const s = (v: unknown) => (typeof v === 'string' ? v : '')
// a Proposed field that was never written keeps the live text; an empty string is a real proposal
const p = (f: Record<string, unknown>, k: string, fallback: string) => (k in f && typeof f[k] === 'string' ? (f[k] as string) : fallback)

function toItem(r: AirtableSingleRecord): ReviewItem {
  const f = (r.fields || {}) as Record<string, unknown>
  const now: ReviewText = {
    title: s(f['Conversion Checkpoint']),
    pass: s(f['Pass when']),
    fail: s(f['Fail when']),
    na: s(f['Not relevant when']),
    fix: s(f['Short fix']),
    actions: s(f['Required Actions']),
    why: s(f['Justifications & Benefits']),
  }
  const proposed: ReviewText = {
    title: p(f, 'Proposed title', now.title),
    pass: p(f, 'Proposed pass when', now.pass),
    fail: p(f, 'Proposed fail when', now.fail),
    na: p(f, 'Proposed not relevant when', now.na),
    fix: p(f, 'Proposed short fix', now.fix),
    actions: p(f, 'Proposed required actions', now.actions),
    why: p(f, 'Proposed justification', now.why),
  }
  const pages = (Array.isArray(f['Page Type']) ? (f['Page Type'] as string[]) : []).map((id) => PAGE[id]).filter(Boolean)
  const examples = (Array.isArray(f['Examples']) ? (f['Examples'] as Record<string, unknown>[]) : []).map((_, i) => ({
    url: `/scan/api/checkpoint-image?r=${r.id}&i=${i}&s=full`,
    thumbnailUrl: `/scan/api/checkpoint-image?r=${r.id}&i=${i}&s=thumb`,
    filename: s(_.filename) || 'Example',
  }))
  return {
    id: r.id,
    page: pages.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))[0] || 'No page type',
    status: s(f['Scanner status']),
    area: s(f['Page area']),
    method: s(f['Check method']),
    rewrite: s(f['Rewrite']),
    comment: s(f['Rewrite comment']),
    notes: s(f['Rewrite notes']),
    now,
    proposed,
    examples,
  }
}

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return u
  }
}

/** One real "What we saw" per checkpoint: a fail you confirmed first, then any scanner fail, then any answer. */
async function findings(): Promise<Map<string, ReviewItem['finding']>> {
  const out = new Map<string, { rank: number; f: NonNullable<ReviewItem['finding']> }>()
  const list = await listTestScans().catch(() => [])
  const scans = await Promise.all(list.slice(0, 60).map(async (x) => ({ scan: await getTestScan(x.id).catch(() => null), labels: await getLabels(x.id).catch(() => ({}) as Record<string, string>) })))
  for (const { scan, labels } of scans) {
    if (!scan) continue
    for (const a of scan.answers || []) {
      if (!a.reason || a.answer === 'unknown') continue
      const rank = a.answer === 'fail' && labels[a.id] === 'fail' ? 3 : a.answer === 'fail' ? 2 : 1
      const prev = out.get(a.id)
      if (!prev || rank > prev.rank) out.set(a.id, { rank, f: { host: host(scan.url), scan: scan.id, reason: a.reason, answer: a.answer } })
    }
  }
  return new Map([...out].map(([k, v]) => [k, v.f]))
}

export async function GET(req: NextRequest) {
  if (!labAllowed(req.nextUrl.searchParams.get('key'))) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  const apiKey = process.env.API_KEY
  if (!apiKey) return NextResponse.json({ error: 'API_KEY missing on this deployment.' }, { status: 500 })
  const [res, seen] = await Promise.all([fetchAllRecordsForFormula(getListRecordsBaseUrl(apiUrl()), apiKey, "NOT({Rewrite} = '')"), findings()])
  if (!res.ok) return NextResponse.json({ error: 'Airtable did not answer.', detail: res.body }, { status: 502 })
  const items = res.records.map(toItem).map((it) => ({ ...it, finding: seen.get(it.id) }))
  items.sort((a, b) => ORDER.indexOf(a.page) - ORDER.indexOf(b.page) || (a.status === 'Live' ? 0 : 1) - (b.status === 'Live' ? 0 : 1) || a.proposed.title.localeCompare(b.proposed.title))
  return NextResponse.json({ items })
}

export async function POST(req: NextRequest) {
  if (!labAllowed(req.nextUrl.searchParams.get('key'))) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  const body = (await req.json().catch(() => ({}))) as {
    id?: string
    rewrite?: string
    comment?: string
    notes?: string
    /** proposed texts, written by Claude for review (lab only) */
    proposed?: Partial<Record<keyof ReviewText, string | null>>
    /** copy the proposed texts into the live fields the report reads, and mark the rewrite Applied */
    apply?: boolean
  }
  if (!body.id || !/^rec[A-Za-z0-9]{14}$/.test(body.id)) return NextResponse.json({ error: 'Need a checkpoint id.' }, { status: 400 })
  const apiKey = process.env.API_KEY
  if (!apiKey) return NextResponse.json({ error: 'API_KEY missing on this deployment.' }, { status: 500 })
  const fields: Record<string, unknown> = {}
  if (body.rewrite !== undefined) {
    if (!VERDICTS.includes(body.rewrite as (typeof VERDICTS)[number])) return NextResponse.json({ error: 'Unknown verdict.' }, { status: 400 })
    fields['Rewrite'] = body.rewrite
  }
  if (body.comment !== undefined) fields['Rewrite comment'] = String(body.comment).slice(0, 5000)
  if (body.notes !== undefined) fields['Rewrite notes'] = String(body.notes).slice(0, 5000)
  for (const [k, v] of Object.entries(body.proposed || {})) {
    const name = PROPOSED[k as keyof ReviewText]
    if (name) fields[name] = v
  }
  if (body.apply) {
    // only an approved rewrite goes live, from the record as it is in Airtable now
    const cur = await fetch(`${getListRecordsBaseUrl(apiUrl())}/${body.id}`, { headers: { Authorization: `Bearer ${apiKey}` }, cache: 'no-store' })
    const rec = (await cur.json().catch(() => null)) as AirtableSingleRecord | null
    if (!cur.ok || !rec) return NextResponse.json({ error: 'Could not read the checkpoint.' }, { status: 502 })
    const item = toItem(rec)
    if (item.rewrite !== 'Approved') return NextResponse.json({ error: `Not approved (${item.rewrite || 'no rewrite'}).` }, { status: 409 })
    for (const k of Object.keys(LIVE) as (keyof ReviewText)[]) fields[LIVE[k]] = item.proposed[k]
    fields['Rewrite'] = 'Applied'
  }
  const res = await fetch(`${getListRecordsBaseUrl(apiUrl())}/${body.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
    cache: 'no-store',
  })
  if (!res.ok) {
    const out = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    return NextResponse.json({ error: `Airtable refused the change (${out?.error?.message || res.status}).` }, { status: 502 })
  }
  return NextResponse.json({ ok: true, fields })
}
