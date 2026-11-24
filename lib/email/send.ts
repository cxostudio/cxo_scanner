// Send one email with Resend (https://resend.com). The key lives in Vercel only: RESEND_API_KEY.
// Sender: EMAIL_FROM, e.g. "Louis from CXO studio <scan@cxo.studio>" (the domain must be verified in Resend).
// Without a key it logs and does nothing, so scans never fail because of email.

// Test inboxes: scans and reports run with these addresses never email them (results, report, follow-ups).
// More can be added in Vercel as NO_EMAIL_TO, comma separated. Counted as sent so nothing retries.
const TEST_INBOXES = ['forte.test.only@gmail.com']
export function isTestInbox(to: string) {
  const list = [...TEST_INBOXES, ...(process.env.NO_EMAIL_TO || '').split(',')].map((e) => e.trim().toLowerCase()).filter(Boolean)
  return list.includes(to.trim().toLowerCase())
}

export async function sendEmail(msg: { to: string; subject: string; html: string; text: string; replyTo?: string; headers?: Record<string, string> }): Promise<{ sent: boolean; id?: string; error?: string }> {
  if (isTestInbox(msg.to)) { console.log('[email] test inbox, not sent:', msg.subject); return { sent: true, id: 'test-inbox' } }
  const key = process.env.RESEND_API_KEY
  if (!key) { console.warn('[email] RESEND_API_KEY not set; email not sent to', msg.to); return { sent: false, error: 'not configured' } }
  const from = process.env.EMAIL_FROM || 'Louis from CXO studio <scan@cxo.studio>'
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text, reply_to: msg.replyTo || process.env.EMAIL_REPLY_TO || undefined, ...(msg.headers ? { headers: msg.headers } : {}) }),
    })
    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string }
    if (!res.ok) { console.error('[email] Resend error', res.status, data.message); return { sent: false, error: data.message || String(res.status) } }
    return { sent: true, id: data.id }
  } catch (e) {
    console.error('[email] send failed', e)
    return { sent: false, error: e instanceof Error ? e.message : 'send failed' }
  }
}
