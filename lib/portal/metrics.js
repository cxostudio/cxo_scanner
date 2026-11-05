// Pure computations for the cockpit: no I/O, so they can be tested with fixtures.
//
// Two kinds of numbers live here, and the UI keeps them apart on purpose:
// - Store health (sales, orders, AOV, conversion, revenue per visitor): context. Driven by
//   traffic, ads, promos and assortment as much as by CRO, so only ever compared with the
//   same weeks last year (seasonality cancels out), never claimed as CXO's result.
// - Return on tests: revenue we can attribute, because it comes from A/B tests with a
//   measured winner. That's the number that answers "is CXO paying off?".

const DAY = 86400000, WEEK = 7 * DAY;
const num = v => (v == null || v === '' ? 0 : Number(v));
const iso = ts => new Date(ts).toISOString().slice(0, 10);

// Monday-based week start (ShopifyQL's WEEK_TIMESTAMP), UTC.
export function weekStart(ts) {
  const d = new Date(ts); d.setUTCHours(0, 0, 0, 0);
  return d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY;
}

// Merge weekly sales with weekly *qualified* sessions (bot-filtered, see clients.js).
// The week still in progress is dropped: a partial week would read as a drop.
export function mergeWeeks(salesRows, sessionRows, now = Date.now()) {
  const map = new Map();
  const row = w => map.get(w) || map.set(w, { week: w, orders: 0, sales: 0, sessions: 0, atc: 0, checkout: 0, converted: 0 }).get(w);
  for (const r of salesRows) { const x = row(r.week); x.orders = num(r.orders); x.sales = num(r.net_sales); }
  for (const r of sessionRows) {
    const x = row(r.week);
    x.sessions = num(r.sessions);
    x.atc = num(r.sessions_with_cart_additions);
    x.checkout = num(r.sessions_that_reached_checkout);
    x.converted = num(r.sessions_that_completed_checkout);
  }
  const current = iso(weekStart(now));
  return [...map.values()].filter(x => x.week < current).sort((a, b) => a.week.localeCompare(b.week));
}

// Totals and ratios over a set of weeks.
// Conversion is measured inside the qualified sessions (converted / sessions). Revenue can't be
// split by session in ShopifyQL, so revenue per visitor = conversion x AOV.
export function summarize(weeks) {
  const t = weeks.reduce((s, w) => ({
    orders: s.orders + w.orders, sales: s.sales + w.sales, sessions: s.sessions + w.sessions,
    atc: s.atc + w.atc, checkout: s.checkout + w.checkout, converted: s.converted + w.converted,
  }), { orders: 0, sales: 0, sessions: 0, atc: 0, checkout: 0, converted: 0 });
  const aov = t.orders ? t.sales / t.orders : null;
  const cr = t.sessions ? t.converted / t.sessions : null;
  return {
    weeks: weeks.length,
    from: weeks[0]?.week || null, to: weeks[weeks.length - 1]?.week || null,
    sales: t.sales, orders: t.orders, sessions: t.sessions,
    aov, cr,
    rpv: cr != null && aov != null ? cr * aov : null,
    atcRate: t.sessions ? t.atc / t.sessions : null,
    checkoutRate: t.sessions ? t.checkout / t.sessions : null,
  };
}

const pct = (a, b) => (a == null || b == null || !b ? null : a / b - 1);
const KEYS = ['sales', 'orders', 'aov', 'cr', 'rpv', 'atcRate', 'checkoutRate'];

// Last N complete weeks vs the same weeks one year earlier. Both sides need the full window,
// otherwise the comparison is left null rather than made on uneven periods.
export function storeHealth(weeks, n = 13) {
  const byWeek = new Map(weeks.map(w => [w.week, w]));
  const recent = weeks.slice(-n);
  const shifted = recent.map(w => byWeek.get(iso(Date.parse(w.week) - 52 * WEEK))).filter(Boolean);
  const cur = summarize(recent);
  const ly = shifted.length === recent.length && recent.length ? summarize(shifted) : null;
  return { current: cur, lastYear: ly, vsLastYear: ly && Object.fromEntries(KEYS.map(k => [k, pct(cur[k], ly[k])])) };
}

// ── Return on tests ──
// A winning test with uplift u on revenue per visitor, exposed to a share e of revenue, means
// that out of today's revenue R, R x (1 - 1/(1 + u.e)) would not exist without it.
// Several winners combine multiplicatively (no double counting). Each one counts for 12 months
// after rollout, then drops out: effects fade and the site keeps changing.
export const LIFETIME_WEEKS = 52;

export function winners(items) {
  return items
    .filter(i => i.type === 'test' && i.verdict === 'winner' && i.uplift > 0 && (i.goLive || i.end))
    .map(i => ({ ...i, rollout: i.goLive || i.end, exposure: i.exposed != null ? Math.min(100, Math.max(0, i.exposed)) / 100 : 1 }));
}
const share = (active) => 1 - active.reduce((p, w) => p / (1 + (w.uplift / 100) * w.exposure), 1);
const activeAt = (ws, weekIso) => ws.filter(w => {
  const start = iso(weekStart(Date.parse(w.rollout)) + WEEK); // first full week after rollout
  const end = iso(Date.parse(start) + LIFETIME_WEEKS * WEEK);
  return weekIso >= start && weekIso < end;
});

export function returnOnTests(items, weeks, monthlyFee = null) {
  const ws = winners(items);
  let toDate = 0;
  const perWeek = weeks.map(w => {
    const gain = w.sales * share(activeAt(ws, w.week));
    toDate += gain;
    return { week: w.week, gain };
  });
  const last4 = weeks.slice(-4);
  const nowIso = last4.length ? last4[last4.length - 1].week : null;
  const activeNow = nowIso ? activeAt(ws, nowIso) : [];
  const weeklySales = last4.length ? last4.reduce((s, w) => s + w.sales, 0) / last4.length : 0;
  const perMonth = weeklySales * share(activeNow) * 52 / 12;
  return {
    winners: ws.map(w => ({ id: w.id, name: w.name, stage: w.stage, uplift: w.uplift, exposure: w.exposure, rollout: w.rollout,
      active: activeNow.some(a => a.id === w.id) })),
    perMonth, toDate,
    monthlyFee, multiple: monthlyFee ? perMonth / monthlyFee : null,
    lifetimeWeeks: LIFETIME_WEEKS,
  };
}

// Experiment programme health: velocity and hit rate.
export function experimentStats(items, since, now = Date.now()) {
  const tests = items.filter(i => i.type === 'test' && (i.start || i.goLive || '') >= (since || ''));
  const today = iso(now), d90 = iso(now - 90 * DAY);
  const concluded = tests.filter(t => ['winner', 'neutral', 'loser'].includes(t.verdict));
  const won = concluded.filter(t => t.verdict === 'winner');
  const upl = won.map(t => t.uplift).filter(u => u > 0);
  return {
    total: tests.length,
    running: tests.filter(t => !t.verdict && (t.end || t.goLive || today) >= today).length,
    pendingVerdict: tests.filter(t => !t.verdict && (t.end || t.goLive || today) < today).length,
    concluded: concluded.length,
    winners: won.length,
    winRate: concluded.length ? won.length / concluded.length : null,
    avgWinnerUplift: upl.length ? upl.reduce((s, u) => s + u, 0) / upl.length : null,
    last90: tests.filter(t => (t.start || t.goLive) >= d90).length,
  };
}

// ── Where growth came from ──
// Rows from a ShopifyQL GROUP BY ... COMPARE TO query: current columns plus `comparison_<col>__<date>`.
export function growthSources(rows, dim) {
  const cmp = (r, col) => { const k = Object.keys(r).find(x => x.startsWith(`comparison_${col}__`)); return k ? num(r[k]) : 0; };
  const list = rows.map(r => ({
    key: r[dim] || '', orders: num(r.orders), sales: num(r.net_sales),
    ordersLY: cmp(r, 'orders'), salesLY: cmp(r, 'net_sales'),
  }));
  const tot = list.reduce((s, x) => ({ sales: s.sales + x.sales, salesLY: s.salesLY + x.salesLY }), { sales: 0, salesLY: 0 });
  const delta = tot.sales - tot.salesLY;
  return list.map(x => ({ ...x,
    change: x.salesLY ? x.sales / x.salesLY - 1 : null,
    shareOfGrowth: delta ? (x.sales - x.salesLY) / delta : null,
  })).sort((a, b) => b.sales - a.sales);
}

// Same 13 complete weeks as storeHealth, as ShopifyQL date ranges (current + one year earlier).
export function healthRanges(now = Date.now(), n = 13) {
  const end = weekStart(now);                // Monday of the current, incomplete week
  const from = end - n * WEEK, until = end - DAY;
  const shift = 52 * WEEK;
  return { from: iso(from), until: iso(until), lyFrom: iso(from - shift), lyUntil: iso(until - shift) };
}
