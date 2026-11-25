// GET /api/scan/speed?key=LAB_KEY[&n=100]: how long visitors fill the form and wait for their results
// since background scans, against the wait before them (the whole scan after the email).
// Per scan: /api/scan/job/<id> → speed.
import { NextRequest, NextResponse } from 'next/server'
import { labAllowed } from '@/lib/lab/store'
import { listRecentBackground, speedOf } from '@/lib/scanJobs/store'

export const dynamic = 'force-dynamic'

const median = (xs: number[]) => {
  if (!xs.length) return null
  const v = [...xs].sort((a, b) => a - b)
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : Math.round(((v[m - 1] + v[m]) / 2) * 10) / 10
}

export async function GET(req: NextRequest) {
  if (!labAllowed(req.nextUrl.searchParams.get('key'))) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const n = Math.min(500, Math.max(1, Number(req.nextUrl.searchParams.get('n')) || 100))
  const jobs = await listRecentBackground(n)
  const rows = jobs
    .map((j) => ({ id: j.id, at: j.created_at, host: (() => { try { return new URL(j.answers?.scanUrl || j.url).host } catch { return j.url } })(), status: j.status, ...speedOf(j) }))
    .filter((r) => r.waitS != null)
  const col = (k: 'formS' | 'scanS' | 'headStartS' | 'waitS' | 'beforeS') => rows.map((r) => r[k]).filter((x): x is number => x != null)
  return NextResponse.json(
    {
      scans: rows.length,
      median: { formS: median(col('formS')), scanS: median(col('scanS')), headStartS: median(col('headStartS')), waitS: median(col('waitS')), beforeS: median(col('beforeS')) },
      readyAtEmail: rows.filter((r) => r.doneBeforeEmail).length,
      rows,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
