// GET /api/shopify-install?k=<passphrase>
// One-time step per client store: sends the store owner to Shopify's permission screen
// (authorization code grant, offline token). Shopify then calls /api/shopify-callback.
// Only a passphrase login can start it, and the redirect URI must be listed in the app's
// "Allowed redirection URL(s)" in the Dev Dashboard (https://portal.cxo.studio/api/shopify-callback).
import { resolveClient } from '../../lib/portal/clients.js';
import { appCredentials, makeState, SCOPES } from '../../lib/portal/shopify.js';

export default function handler(req, res) {
  const who = req.query.k ? resolveClient(req.query.k) : null;
  if (!who || !who.strong) return res.status(403).send('Passphrase required.');
  const { cfg } = who;
  if (!cfg.shop) return res.status(404).send('No Shopify store configured for this client.');
  const { id, secret } = appCredentials(cfg);
  if (!id || !secret) return res.status(503).send('Shopify app credentials are not set in Vercel.');

  const redirect = `https://${req.headers.host}/api/shopify-callback`;
  const url = `https://${cfg.shop}/admin/oauth/authorize?` + new URLSearchParams({
    client_id: id,
    scope: SCOPES,
    redirect_uri: redirect,
    state: makeState(cfg.shop, secret),
  });
  res.setHeader('Cache-Control', 'no-store');
  res.writeHead(302, { Location: url });
  res.end();
}
