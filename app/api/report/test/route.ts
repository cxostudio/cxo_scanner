import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { isTestEmail } from '@/lib/conversionCheckpoints/filterByUrlPageType'
import { kickoff, startReport } from '@/lib/fullReport/run'
import { claimStart } from '@/lib/scanJobs/store'

export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * A full report without paying, for CXO studio and +test emails only: the same run the Stripe
 * order will start. POST { url, email, locale?, revenue?, aov?, cr? } → { id, link }
 */
export async function POST(request: NextRequest) {
  const b = (await request.json().catch(() => ({}))) as Record<string, string | undefined>
  const email = (b.email || '').trim().toLowerCase()
  const url = (b.url || '').trim()
  if (!isTestEmail(email)) return NextResponse.json({ error: 'Test emails only' }, { status: 403 })
  if (!url) return NextResponse.json({ error: 'url is required' }, { status: 400 })
  const job = await startReport({ email, url, locale: b.locale || 'en', answers: { revenue: b.revenue, aov: b.aov, cr: b.cr, quiet: String(b.quiet) === 'true' }, origin: 'https://cxo.studio' })
  if (await claimStart(job.id)) waitUntil(kickoff(job))
  return NextResponse.json({ id: job.id, link: `https://cxo.studio/scan/report?id=${job.id}` })
}
