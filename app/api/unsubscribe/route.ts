import { NextRequest, NextResponse } from 'next/server'
import { getJob } from '@/lib/scanJobs/store'
import { optOut, unsubscribeToken } from '@/lib/followups/run'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// "Stop these emails": the link carries the scan id and a signature, never the address.
async function handle(request: NextRequest): Promise<{ ok: boolean; fr: boolean }> {
  const j = request.nextUrl.searchParams.get('j') || ''
  const t = request.nextUrl.searchParams.get('t') || ''
  if (!/^[0-9a-f-]{36}$/i.test(j) || t !== unsubscribeToken(j)) return { ok: false, fr: false }
  const job = await getJob(j).catch(() => null)
  if (!job) return { ok: false, fr: false }
  await optOut(job.email)
  return { ok: true, fr: job.locale === 'fr' }
}

const page = (ok: boolean, fr: boolean) => `<!doctype html><html lang="${fr ? 'fr' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>CXO studio</title>
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;600&family=Plus+Jakarta+Sans:wght@700&display=swap" rel="stylesheet"></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#fafafa;font-family:'Inter Tight',Arial,sans-serif;color:#09090b">
<main style="max-width:460px;padding:32px 24px;text-align:center">
<img src="https://audit.cxo.studio/scan/cxo_studio_logo.png" alt="CXO studio" width="132" style="display:block;margin:0 auto 28px">
<h1 style="font:700 26px/1.2 'Plus Jakarta Sans',Arial,sans-serif;letter-spacing:-0.5px;margin:0">${ok ? (fr ? 'C’est noté' : 'You’re unsubscribed') : (fr ? 'Lien invalide' : 'This link doesn’t work')}</h1>
<p style="color:#71717a;font-size:16px;line-height:1.6;margin:12px 0 0">${ok ? (fr ? 'Vous ne recevrez plus d’emails de suivi de notre part. Vos résultats restent accessibles avec leur lien.' : 'You won’t get any more follow-up emails from us. Your results stay available at their link.') : (fr ? 'Répondez à notre email et nous vous retirerons de la liste.' : 'Reply to our email and we’ll take you off the list.')}</p>
</main></body></html>`

export async function GET(request: NextRequest) {
  const r = await handle(request).catch(() => ({ ok: false, fr: false }))
  return new NextResponse(page(r.ok, r.fr), { status: r.ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
/** One-click unsubscribe from the mail app (List-Unsubscribe-Post). */
export async function POST(request: NextRequest) {
  const r = await handle(request).catch(() => ({ ok: false, fr: false }))
  return NextResponse.json({ ok: r.ok }, { status: r.ok ? 200 : 400 })
}
