// GET /api/timeline?k=<password> — what went live, when, on which part of the funnel.
// Reads the cockpit custom fields on every list in cfg.timelineLists (live list + archives).
// Only tasks ticked "Client Visible" are returned. No money here, so any valid login may read it.
import { resolveClient, FIELDS } from '../../lib/portal/clients.js';

const STAGE = { 'home / landing': 'home', 'collection (plp)': 'plp', 'product (pdp)': 'pdp', 'cart': 'cart', 'checkout': 'checkout', 'site-wide': 'site' };
const TYPE = { 'best practice': 'bp', 'a/b test': 'test', 'fix': 'fix', 'build': 'build' };

async function listTasks(listId, token) {
  let page = 0, out = [], last = false;
  while (!last && page < 10) {
    const r = await fetch(`https://api.clickup.com/api/v2/list/${listId}/task?include_closed=true&subtasks=true&page=${page}`,
      { headers: { Authorization: token } });
    if (!r.ok) throw new Error(`ClickUp ${r.status} on list ${listId}`);
    const j = await r.json();
    const batch = Array.isArray(j.tasks) ? j.tasks : [];
    out = out.concat(batch);
    last = j.last_page === true || batch.length === 0;
    page++;
  }
  return out;
}

// ClickUp v2 returns a dropdown value as the option's orderindex (sometimes its id): handle both.
function dropdown(field) {
  if (!field || field.value == null || field.value === '') return null;
  const opts = field.type_config?.options || [];
  const o = opts.find(x => x.id === field.value) || opts.find(x => Number(x.orderindex) === Number(field.value));
  return o ? String(o.name).toLowerCase() : null;
}
const cf = (task, id) => (task.custom_fields || []).find(f => f.id === id);
const ms = v => (v == null || v === '' ? null : Number(v) || null);

export function toItem(t) {
  const visible = cf(t, FIELDS.clientVisible)?.value;
  if (!(visible === true || visible === 'true')) return null;
  const stage = STAGE[dropdown(cf(t, FIELDS.funnelStage))] || null;
  const type = TYPE[dropdown(cf(t, FIELDS.workType))] || null;
  const goLive = ms(cf(t, FIELDS.goLive)?.value);
  const verdict = dropdown(cf(t, FIELDS.testVerdict));
  const numField = id => { const v = cf(t, id)?.value; return v == null || v === '' || isNaN(Number(v)) ? null : Number(v); };
  const uplift = type === 'test' ? numField(FIELDS.testUplift) : null;
  const exposed = type === 'test' ? numField(FIELDS.revenueExposed) : null;
  const start = ms(t.start_date), end = ms(t.due_date);
  if (!goLive && !(type === 'test' && start)) return null; // nothing to place on a timeline yet
  return {
    id: t.id, name: t.name, stage, type, verdict, uplift, exposed,
    goLive: goLive ? new Date(goLive).toISOString().slice(0, 10) : null,
    start: type === 'test' && start ? new Date(start).toISOString().slice(0, 10) : null,
    end: type === 'test' && end ? new Date(end).toISOString().slice(0, 10) : null,
  };
}

// Every client-visible item with a date, oldest first. Shared with /api/performance (return on tests).
export async function loadTimeline(cfg, token) {
  const lists = await Promise.all(cfg.timelineLists.map(id => listTasks(id, token)));
  return lists.flat().map(toItem).filter(Boolean)
    .sort((a, b) => (a.goLive || a.start).localeCompare(b.goLive || b.start));
}

export default async function handler(req, res) {
  const token = process.env.CLICKUP_TOKEN;
  if (!token) return res.status(500).json({ error: 'CLICKUP_TOKEN not set' });
  if (!req.query.k) return res.status(403).json({ error: 'Missing password' });
  const who = resolveClient(req.query.k);
  if (!who) return res.status(403).json({ error: 'Invalid password' });
  const { cfg } = who;
  if (!cfg.timelineLists?.length) return res.status(404).json({ error: 'not_enabled' });

  try {
    const items = await loadTimeline(cfg, token);
    const since = cfg.day0 || '0000';
    const live = items.filter(i => (i.goLive || i.start) >= since);
    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600');
    return res.status(200).json({
      day0: cfg.day0 || null,
      items,
      totals: {
        shipped: live.filter(i => i.goLive).length,
        tests: live.filter(i => i.type === 'test').length,
        winners: live.filter(i => i.verdict === 'winner').length,
      },
      updatedISO: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(502).json({ error: 'fetch_failed', detail: String(err).slice(0, 300) });
  }
}
