// Test lab: change a checkpoint's Scanner status in Airtable (Promote to Live, back to Draft, audit only).
// Louis clicks; the change and the score at that moment are logged in the lab storage.
import { NextRequest, NextResponse } from 'next/server'
import { getListRecordsBaseUrl, refreshCheckpointRulesCache } from '@/lib/conversionCheckpoints/getCheckpointRules'
import { labAllowed, logPromotion } from '@/lib/lab/store'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

const ACTIONS: Record<string, Record<string, unknown>> = {
  live: { 'Scanner status': 'Live' },
  draft: { 'Scanner status': 'Draft' },
  audit: { 'Scanner status': 'Draft', 'Check method': 'Manual (audit only)' },
  off: { 'Scanner status': 'Off' },
}

export async function POST(req: NextRequest) {
  if (!labAllowed(req.nextUrl.searchParams.get('key'))) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  const body = (await req.json().catch(() => ({}))) as { id?: string; action?: string; title?: string; score?: string }
  const fields = ACTIONS[body.action || '']
  if (!body.id || !/^rec[A-Za-z0-9]{14}$/.test(body.id) || !fields) return NextResponse.json({ error: 'Need a checkpoint id and an action (live, draft, audit, off).' }, { status: 400 })
  const apiUrl = process.env.API_URL ?? 'https://api.airtable.com/v0/app1HP8C17pAMjacf/Conversion%20Checkpoints'
  const apiKey = process.env.API_KEY
  if (!apiKey) return NextResponse.json({ error: 'API_KEY missing on this deployment.' }, { status: 500 })
  const res = await fetch(`${getListRecordsBaseUrl(apiUrl)}/${body.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields, typecast: true }),
    cache: 'no-store',
  })
  const out = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = (out as any)?.error?.message || (out as any)?.error?.type || res.status
    return NextResponse.json({ error: `Airtable refused the change (${msg}). The token needs write access to this base.` }, { status: 502 })
  }
  await logPromotion({ id: body.id, title: body.title, action: body.action, score: body.score }).catch(() => {})
  await refreshCheckpointRulesCache().catch(() => {})
  return NextResponse.json({ ok: true, fields })
}
