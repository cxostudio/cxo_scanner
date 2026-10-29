// GET /api/performance?k=<passphrase> — the money side of the cockpit.
// Only served to a passphrase login, never to the guessable domain.
//  - returnOnTests: revenue attributable to winning A/B tests (ClickUp verdict + uplift) vs the fee
//  - experiments:   programme health (tests run, win rate, velocity)
//  - health:        store KPIs vs the same weeks last year, conversion on qualified sessions
//  - weeks:         weekly series for the timeline chart
import { resolveClient } from '../../lib/portal/clients.js';
import { shopifyql } from '../../lib/portal/shopify.js';
import { mergeWeeks, storeHealth, returnOnTests, experimentStats, growthSources, healthRanges } from '../../lib/portal/metrics.js';
import { loadTimeline } from './timeline.js';

const DAY = 86400000;
const q = s => `'${String(s).replace(/'/g, "\\'")}'`;

// WHERE clause for "qualified sessions" (see clients.js). Empty when the client has no filter.
export function sessionFilter(cfg) {
  const f = cfg.qualifiedSessions;
  if (!f) return '';
  const parts = [];
  if (f.markets?.length) parts.push(`session_country IN (${f.markets.map(q).join(', ')})`);
  if (f.excludeDesktopReferrers?.length) parts.push(`NOT (session_device_type = 'desktop' AND referrer_source IN (${f.excludeDesktopReferrers.map(q).join(', ')}))`);
  return parts.length ? ` WHERE ${parts.join(' AND ')}` : '';
}

export default async function handler(req, res) {
  if (!req.query.k) return res.status(403).json({ error: 'Missing password' });
  const who = resolveClient(req.query.k);
  if (!who) return res.status(403).json({ error: 'Invalid password' });
  const { cfg, strong } = who;
  if (!cfg.shop) return res.status(404).json({ error: 'not_enabled' });
  if (!strong) return res.status(403).json({ error: 'passphrase_required' });

  // From one year before Day 0: every week since Day 0 has its "same week last year".
  const since = new Date(Date.parse(cfg.day0) - 371 * DAY).toISOString().slice(0, 10);
  const r = healthRanges();
  const cmp = `SINCE ${r.from} UNTIL ${r.until} COMPARE TO ${r.lyFrom} UNTIL ${r.lyUntil}`;
  const queries = {
    bySource: `FROM sales SHOW orders, net_sales GROUP BY order_referrer_source ${cmp} ORDER BY net_sales DESC LIMIT 10`,
    byChannel: `FROM sales SHOW orders, net_sales GROUP BY sales_channel ${cmp} ORDER BY net_sales DESC LIMIT 10`,
    customers: `FROM sales SHOW customers, new_customers, returning_customers ${cmp}`,
    sales: `FROM sales SHOW orders, net_sales TIMESERIES week SINCE ${since} UNTIL today`,
  };
  const trust = cfg.trustSessions !== false;
  // Visit data is only fetched where it can be trusted (each ShopifyQL call costs rate-limit budget).
  if (trust) queries.sessions = `FROM sessions SHOW sessions, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout${sessionFilter(cfg)} TIMESERIES week SINCE ${since} UNTIL today`;

  try {
    const token = process.env.CLICKUP_TOKEN;
    const [data, items] = await Promise.all([
      shopifyql(cfg, queries),
      token && cfg.timelineLists?.length ? loadTimeline(cfg, token).catch(() => []) : [],
    ]);
    const weeks = mergeWeeks(data.sales, data.sessions || []);
    const health = storeHealth(weeks);
    if (!trust) for (const part of [health.current, health.lastYear, health.vsLastYear]) {
      if (part) for (const k of ['cr', 'rpv', 'atcRate', 'checkoutRate', 'sessions']) delete part[k];
    }
    const c = data.customers[0] || {};
    const cv = (col) => { const k = Object.keys(c).find(x => x.startsWith(`comparison_${col}__`)); return k ? Number(c[k]) : null; };
    const customers = c.customers == null ? null : {
      newCustomers: Number(c.new_customers), returning: Number(c.returning_customers),
      newCustomersLY: cv('new_customers'), returningLY: cv('returning_customers'),
    };

    // Store data moves slowly; 6h at the edge keeps Shopify calls to a handful per day.
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
    return res.status(200).json({
      currency: data.currency,
      day0: cfg.day0,
      qualifiedSessions: Boolean(cfg.qualifiedSessions),
      returnOnTests: returnOnTests(items, weeks, cfg.monthlyFee ?? null),
      experiments: experimentStats(items, cfg.day0),
      trustSessions: trust,
      health,
      growth: { range: r, bySource: growthSources(data.bySource, 'order_referrer_source'), byChannel: growthSources(data.byChannel, 'sales_channel'), customers },
      weeks: weeks.map(w => trust
        ? { w: w.week, o: w.orders, s: Math.round(w.sales), v: w.sessions, a: w.atc, c: w.checkout, x: w.converted }
        : { w: w.week, o: w.orders, s: Math.round(w.sales) }),
      updatedISO: new Date().toISOString(),
    });
  } catch (err) {
    const status = err.code === 'not_configured' ? 503 : 502;
    return res.status(status).json({ error: err.code || 'fetch_failed', detail: err.detail || String(err).slice(0, 300) });
  }
}
