import { NextRequest, NextResponse } from 'next/server'
import { getJob } from '@/lib/scanJobs/store'
import { saveJson } from '@/lib/fullReport/images'
import { sendEmail } from '@/lib/email/send'

export const runtime = 'nodejs'

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/**
 * Feedback from a full report: a checkpoint the buyer thinks is wrong, or a bug.
 * POST { reportId, kind: 'wrong' | 'bug', message, ruleId?, ruleTitle?, area?, verdict?, tab?, device? }
 * Kept in the reports bucket (feedback/) to improve the scan, and emailed to the team inbox:
 * FEEDBACK_TO, else EMAIL_REPLY_TO (both set in Vercel, never in code).
 */
export async function POST(request: NextRequest) {
  const b = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '')
  const reportId = str(b.reportId, 40)
  const message = str(b.message, 2000)
  const kind = b.kind === 'wrong' ? 'wrong' : 'bug'
  if (!/^[0-9a-f-]{36}$/i.test(reportId) || (!message && kind === 'bug')) return NextResponse.json({ error: 'reportId and message are required' }, { status: 400 })
  const job = await getJob(reportId).catch(() => null)
  if (!job || !job.scan_id.startsWith('report_')) return NextResponse.json({ error: 'Unknown report' }, { status: 404 })

  const item = {
    at: new Date().toISOString(), reportId, store: job.url, kind, message,
    ruleId: str(b.ruleId, 40), ruleTitle: str(b.ruleTitle, 300), area: str(b.area, 20), verdict: str(b.verdict, 10),
    tab: str(b.tab, 20), device: str(b.device, 10), userAgent: (request.headers.get('user-agent') || '').slice(0, 200),
  }
  await saveJson(`feedback/${item.at.slice(0, 10)}/${reportId}-${Date.now().toString(36)}.json`, item).catch((e) => console.error('[feedback] not stored', e))

  const to = process.env.FEEDBACK_TO || process.env.EMAIL_REPLY_TO
  if (to) {
    const link = `https://cxo.studio/scan/report?id=${reportId}${item.area ? `&tab=${item.area}` : ''}`
    const what = kind === 'wrong' ? `Checkpoint flagged as wrong: ${item.ruleTitle || item.ruleId} (${item.verdict || '?'}, ${item.area})` : 'Bug or comment'
    const store = job.url.replace(/^https?:\/\/(www\.)?/, '')
    await sendEmail({
      to, replyTo: job.email,
      subject: `Report feedback · ${store} · ${kind === 'wrong' ? 'wrong checkpoint' : 'bug'}`,
      text: `${what}\n\n${message || '(no comment)'}\n\nStore: ${job.url}\nSeen on: ${item.tab} / ${item.device}\nReply to this email to answer the buyer.\nReport: ${link}`,
      html: `<p><b>${esc(what)}</b></p><p style="white-space:pre-wrap">${esc(message || '(no comment)')}</p><p>Store: ${esc(job.url)}<br>Seen on: ${esc(item.tab)} / ${esc(item.device)}<br>Reply to this email to answer the buyer.<br><a href="${esc(link)}">Open the report</a></p>`,
    }).catch(() => null)
  }
  return NextResponse.json({ ok: true })
}
