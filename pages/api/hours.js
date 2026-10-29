// GET /api/hours?k=<password>[&month=YYYY-MM] — hours for the month + live status board. Time only, no money.
import { TEAM_ID, CXO_LOGO, monthBounds, monthsSince, lane, resolveClient } from '../../lib/portal/clients.js';

async function fetchAllTasks(listId, token) {
  let page = 0, out = [], last = false;
  while (!last && page < 6) {
    const url = `https://api.clickup.com/api/v2/list/${listId}/task?include_closed=true&subtasks=true&page=${page}`;
    const r = await fetch(url, { headers: { Authorization: token } });
    if (!r.ok) break;
    const j = await r.json();
    const batch = Array.isArray(j.tasks) ? j.tasks : [];
    out = out.concat(batch);
    last = j.last_page === true || batch.length === 0;
    page++;
  }
  return out;
}

// ClickUp's time-entries endpoint returns only the caller's own entries unless
// every member is named explicitly — without this, a teammate's tracked hours
// silently vanish from the portal. Null on failure = previous behaviour.
async function teamMemberIds(token) {
  const r = await fetch('https://api.clickup.com/api/v2/team', { headers: { Authorization: token } });
  if (!r.ok) return null;
  const j = await r.json();
  const team = (j.teams || []).find(t => String(t.id) === String(TEAM_ID));
  const ids = (team?.members || []).map(m => m.user?.id).filter(Boolean);
  return ids.length ? ids.join(',') : null;
}

export default async function handler(req, res) {
  const token = process.env.CLICKUP_TOKEN;
  if (!token) return res.status(500).json({ error: 'CLICKUP_TOKEN not set' });

  if (!req.query.k) return res.status(403).json({ error: 'Missing password' });
  const who = resolveClient(req.query.k);
  if (!who) return res.status(403).json({ error: 'Invalid password' });
  const { key, cfg, strong } = who;

  // Which month? Default = current. Anything outside the client's range is clamped,
  // and the month actually served comes back in the payload so the UI stays in sync.
  const months = monthsSince(cfg.since, new Date());
  const asked = String(req.query.month || '');
  const wanted = months.includes(asked) ? asked : months[months.length - 1];
  const { key: month, start, reset, isCurrent } = monthBounds(wanted);
  const end = isCurrent ? Date.now() : reset - 1;

  try {
    const [members, allTasks] = await Promise.all([
      teamMemberIds(token).catch(() => null),
      fetchAllTasks(cfg.listId, token),
    ]);
    const timeUrl = assignee => `https://api.clickup.com/api/v2/team/${TEAM_ID}/time_entries`
      + `?start_date=${start}&end_date=${end}&list_id=${cfg.listId}`
      + (assignee ? `&assignee=${assignee}` : '');
    const getTime = a => fetch(timeUrl(a), { headers: { Authorization: token } });
    // Naming every assignee needs Owner/Admin rights on the workspace. If the token
    // lacks them, fall back to the caller's own entries rather than failing the page.
    let timeRes = await getTime(members);
    if (!timeRes.ok && members) timeRes = await getTime(null);
    if (!timeRes.ok) return res.status(502).json({ error: `ClickUp ${timeRes.status}`, detail: (await timeRes.text()).slice(0, 300) });

    // hours
    const entries = (await timeRes.json()).data || [];
    const spent = Math.round(entries.reduce((s, e) => s + Number(e.duration || 0), 0) / 3600000 * 100) / 100;
    const byTask = {};
    for (const e of entries) {
      const n = e.task?.name || '—';
      byTask[n] = (byTask[n] || 0) + Number(e.duration || 0) / 3600000;
    }
    const tasksByHours = Object.entries(byTask)
      .map(([name, hours]) => ({ name, hours: Math.round(hours * 100) / 100 }))
      .sort((a, b) => b.hours - a.hours);

    // split top-level tasks from subtasks
    const children = {};
    const tops = [];
    for (const t of allTasks) {
      if (t.parent) { (children[t.parent] = children[t.parent] || []).push(t); }
      else tops.push(t);
    }

    // tasks closed inside the selected month — the positive number for a closed period
    const delivered = tops.filter(t => {
      const c = Number(t.date_closed) || 0;
      return c >= start && c < reset;
    }).length;

    // The board is always live: it reflects today's status, whatever month is selected.
    const lanes = { todo: [], progress: [], backlog: [], done: [] };
    for (const t of tops) {
      const l = lane(t.status);
      const subs = (children[t.id] || []).map(s => ({
        name: s.name, color: s.status?.color || '#8A8F94', done: lane(s.status) === 'done',
      }));
      lanes[l].push({
        id: t.id,
        name: t.name,
        color: t.status?.color || '#8A8F94',
        status: t.status?.status || '',
        desc: String(t.text_content || t.description || '').trim().slice(0, 700),
        due: t.due_date ? new Date(Number(t.due_date)).toISOString() : null,
        subs,
        closed: Number(t.date_closed) || 0,
      });
    }
    lanes.done.sort((a, b) => b.closed - a.closed);
    const strip = arr => arr.slice(0, 30).map(({ closed, ...rest }) => rest);
    const statusCounts = { todo: lanes.todo.length, progress: lanes.progress.length, backlog: lanes.backlog.length, done: lanes.done.length };
    const board = { todo: strip(lanes.todo), progress: strip(lanes.progress), backlog: strip(lanes.backlog), done: strip(lanes.done) };

    // Closed months never change → cache them hard. The live month stays short-lived.
    res.setHeader('Cache-Control', isCurrent
      ? 's-maxage=300, stale-while-revalidate=600'
      : 's-maxage=86400, stale-while-revalidate=604800');

    return res.status(200).json({
      client: key, name: cfg.name, logo: cfg.logo, cxoLogo: CXO_LOGO, lang: cfg.lang || 'en',
      cockpit: Boolean(strong && cfg.shop), timeline: Boolean(cfg.timelineLists?.length),
      perfUrl: cfg.perfUrl || null, perfLabel: cfg.perfLabel || null,
      mode: cfg.capHours != null ? 'retainer' : 'payg',
      cap: cfg.capHours ?? null,
      spent,
      remaining: cfg.capHours != null ? Math.round((cfg.capHours - spent) * 100) / 100 : null,
      statusCounts, board, tasksByHours,
      month, months, isCurrent, delivered,
      periodStartISO: new Date(start).toISOString(),
      resetISO: new Date(reset).toISOString(),
      updatedISO: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: 'Fetch failed', detail: String(err).slice(0, 300) });
  }
}