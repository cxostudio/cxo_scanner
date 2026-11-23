// Send one email with Resend (https://resend.com). The key lives in Vercel only: RESEND_API_KEY.
// Sender: EMAIL_FROM, e.g. "Louis from CXO Studio <scan@cxo.studio>" (the domain must be verified in Resend).
// Without a key it logs and does nothing, so scans never fail because of email.

export async function sendEmail(msg: { to: string; subject: string; html: string; text: string; replyTo?: string }): Promise<{ sent: boolean; id?: string; error?: string }> {
  const key = process.env.RESEND_API_KEY
  if (!key) { console.warn('[email] RESEND_API_KEY not set; email not sent to', msg.to); return { sent: false, error: 'not configured' } }
  const from = process.env.EMAIL_FROM || 'Louis from CXO Studio <scan@cxo.studio>'
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text, reply_to: msg.replyTo || process.env.EMAIL_REPLY_TO || undefined }),
    })
    const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string }
    if (!res.ok) { console.error('[email] Resend error', res.status, data.message); return { sent: false, error: data.message || String(res.status) } }
    return { sent: true, id: data.id }
  } catch (e) {
    console.error('[email] send failed', e)
    return { sent: false, error: e instanceof Error ? e.message : 'send failed' }
  }
}
