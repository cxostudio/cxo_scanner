// GET /api/shopify-callback — Shopify redirects here after the store owner approves the app.
// Verifies Shopify's signature and our signed state, exchanges the code for an offline token,
// and shows it ONCE so it can be pasted into Vercel as SHOPIFY_ACCESS_TOKEN_<ENV>.
// Nothing is stored server-side.
import { clientByShop } from '../../lib/portal/clients.js';
import { appCredentials, checkHmac, checkState, validShop } from '../../lib/portal/shopify.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>body{margin:0;background:#FAFAFA;color:#09090B;font:15px/1.6 'Inter Tight',system-ui,sans-serif;display:flex;justify-content:center;padding:48px 16px}
.c{max-width:620px;width:100%;background:#fff;border:1px solid #E4E4E7;border-radius:15px;padding:28px}h1{font-size:20px;margin:0 0 10px}
code{font:13px ui-monospace,monospace;background:#F4F4F5;border-radius:6px;padding:2px 6px}
.t{display:flex;gap:8px;margin:14px 0}.t input{flex:1;min-width:0;font:13px ui-monospace,monospace;padding:10px;border:1px solid #D4D4D8;border-radius:10px;background:#F4F4F5}
button{font:inherit;font-weight:600;color:#FAFAFA;background:#09090B;border:0;border-radius:10px;padding:10px 16px;cursor:pointer}ol{padding-left:20px}.m{color:#71717A;font-size:13px}</style></head>
<body><main class="c">${body}</main></body></html>`;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const q = req.query;
  const shop = String(q.shop || '');
  const entry = validShop(shop) ? clientByShop(shop) : null;
  if (!entry) return res.status(400).send(page('Unknown store', '<h1>Unknown store</h1><p>This store is not configured in the portal.</p>'));
  const [, cfg] = entry;
  const { id, secret } = appCredentials(cfg);
  if (!id || !secret) return res.status(503).send(page('Not configured', '<h1>App credentials missing</h1><p>Set the client ID and secret in Vercel first.</p>'));

  if (!checkHmac(q, secret) || !checkState(q.state, shop, secret)) {
    return res.status(401).send(page('Invalid request', '<h1>Request could not be verified</h1><p>Start again from the install link. Links are valid for 15 minutes.</p>'));
  }

  const r = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, code: String(q.code || '') }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    return res.status(502).send(page('Shopify error', `<h1>Shopify refused the token</h1><p class="m">${esc(JSON.stringify(j).slice(0, 300))}</p>`));
  }

  const name = `SHOPIFY_ACCESS_TOKEN_${cfg.shopEnv}`;
  return res.status(200).send(page('Store connected', `
<h1>${esc(cfg.name)} is connected</h1>
<p>Shopify granted read-only access (<code>${esc(j.scope || '')}</code>). Copy this token into Vercel. It is shown only once.</p>
<div class="t"><input id="tok" readonly value="${esc(j.access_token)}" aria-label="Access token"><button type="button" onclick="navigator.clipboard.writeText(document.getElementById('tok').value);this.textContent='Copied'">Copy</button></div>
<ol>
<li>Vercel → project → Settings → Environment Variables → Add</li>
<li>Key <code>${esc(name)}</code>, value: the token above, environments Production + Preview, type Secret</li>
<li>Redeploy, then close this tab.</li>
</ol>
<p class="m">To revoke later: uninstall the app from the store, or rotate the client secret in the Dev Dashboard.</p>`));
}
