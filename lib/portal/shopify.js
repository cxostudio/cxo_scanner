// Shopify Admin API access for the cockpit. One Dev Dashboard app per client (custom distribution).
// Read-only: the app only holds read_reports (+ read_orders), and we only run ShopifyQL.
//
// Two ways to get a token, in this order:
// 1. SHOPIFY_ACCESS_TOKEN_<ENV>: an offline token obtained once through /api/shopify-install
//    (authorization code grant). Needed for client stores: Shopify refuses the client
//    credentials grant on stores outside our own organization ("shop_not_permitted").
// 2. Client credentials grant with SHOPIFY_CLIENT_ID_<ENV> + SHOPIFY_CLIENT_SECRET_<ENV>
//    (24h token). Only works on stores owned by the CXO Studio organization.
import crypto from 'node:crypto';

export const API_VERSION = '2026-10';
export const SCOPES = 'read_reports,read_orders';

export function appCredentials(cfg) {
  return {
    id: process.env[`SHOPIFY_CLIENT_ID_${cfg.shopEnv}`],
    secret: process.env[`SHOPIFY_CLIENT_SECRET_${cfg.shopEnv}`],
  };
}

// ── OAuth helpers (authorization code grant) ──
export const validShop = s => /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(String(s || ''));

// Stateless, signed `state`: no database needed. Valid 15 minutes, bound to the shop.
export function makeState(shop, secret, now = Date.now()) {
  const ts = String(now);
  return `${ts}.${crypto.createHmac('sha256', secret).update(`${ts}:${shop}`).digest('hex')}`;
}
export function checkState(state, shop, secret, now = Date.now()) {
  const [ts, sig] = String(state || '').split('.');
  if (!ts || !sig || now - Number(ts) > 15 * 60000 || Number(ts) > now + 60000) return false;
  const want = crypto.createHmac('sha256', secret).update(`${ts}:${shop}`).digest('hex');
  return safeEqual(sig, want);
}
// Shopify signs the callback query: every param except `hmac`, sorted, joined as k=v&k=v.
export function checkHmac(query, secret) {
  const { hmac, signature, ...rest } = query;
  if (!hmac) return false;
  const msg = Object.keys(rest).sort().map(k => `${k}=${Array.isArray(rest[k]) ? rest[k].join(',') : rest[k]}`).join('&');
  return safeEqual(hmac, crypto.createHmac('sha256', secret).update(msg).digest('hex'));
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Tokens from the client credentials grant live 24h. Keep them per warm instance.
const tokenCache = new Map();

export async function shopToken(cfg) {
  const stored = process.env[`SHOPIFY_ACCESS_TOKEN_${cfg.shopEnv}`];
  if (stored) return stored.trim();

  const { id, secret } = appCredentials(cfg);
  if (!id || !secret) throw Object.assign(new Error('Shopify credentials not set'), { code: 'not_configured' });

  const hit = tokenCache.get(cfg.shop);
  if (hit && hit.exp > Date.now()) return hit.token;

  const r = await fetch(`https://${cfg.shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: 'client_credentials' }),
  });
  if (!r.ok) {
    const detail = (await r.text()).slice(0, 300);
    // Client store: this grant is refused, the one-time install is required instead.
    const code = /shop_not_permitted/.test(detail) ? 'install_required' : 'auth_failed';
    throw Object.assign(new Error(`Token request failed (${r.status})`), { code, detail });
  }
  const j = await r.json();
  const ttl = Math.max(60, Number(j.expires_in || 86399) - 600) * 1000;
  tokenCache.set(cfg.shop, { token: j.access_token, exp: Date.now() + ttl });
  return j.access_token;
}

// Run several ShopifyQL queries in ONE GraphQL request (aliased fields).
// `queries` = { alias: 'FROM … SHOW …' }. Returns { alias: rows[] , currency }.
// Each shopifyqlQuery costs ~180 points of a 1,000-point bucket, so batching all of them in one
// request trips the rate limit on the second page load. Queries run one by one instead, and a
// THROTTLED answer waits for the bucket to refill (Shopify gives the restore rate) and retries.
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function gql(cfg, token, query) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const r = await fetch(`https://${cfg.shop}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({ query }),
    });
    if (r.status === 429) { await sleep(1000 * (attempt + 1)); continue; }
    if (!r.ok) throw Object.assign(new Error(`Shopify ${r.status}`), { code: 'api_failed', detail: (await r.text()).slice(0, 300) });
    const j = await r.json();
    const throttled = (j.errors || []).find(e => e.extensions?.code === 'THROTTLED');
    if (throttled) {
      const c = j.extensions?.cost || throttled.extensions?.cost || {};
      const need = (c.requestedQueryCost || 200) - (c.throttleStatus?.currentlyAvailable ?? c.currentlyAvailable ?? 0);
      const rate = c.throttleStatus?.restoreRate || 50;
      await sleep(Math.min(6000, Math.max(1000, Math.ceil(need / rate) * 1000)));
      continue;
    }
    if (j.errors?.length) throw Object.assign(new Error('GraphQL error'), { code: 'api_failed', detail: JSON.stringify(j.errors).slice(0, 300) });
    return j.data;
  }
  throw Object.assign(new Error('Shopify rate limit'), { code: 'api_failed', detail: 'Still throttled after retries' });
}

export async function shopifyql(cfg, queries) {
  const token = await shopToken(cfg);
  const out = {};
  for (const [alias, q] of Object.entries(queries)) {
    const data = await gql(cfg, token,
      `{ ${out.currency ? '' : 'shop { currencyCode } '}r: shopifyqlQuery(query: ${JSON.stringify(q)}) { tableData { columns { name } rows } parseErrors } }`);
    if (!out.currency) out.currency = data?.shop?.currencyCode || 'EUR';
    const node = data?.r;
    if (node?.parseErrors?.length) throw Object.assign(new Error('ShopifyQL parse error'), { code: 'api_failed', detail: `${alias}: ${node.parseErrors.join('; ')}` });
    out[alias] = toObjects(node?.tableData);
  }
  return out;
}

// Rows come back either as objects keyed by column (current API) or as arrays: accept both.
function toObjects(table) {
  if (!table) return [];
  const cols = (table.columns || []).map(c => c.name);
  return (table.rows || []).map(row => Array.isArray(row)
    ? Object.fromEntries(cols.map((c, i) => [c, row[i]]))
    : row);
}
