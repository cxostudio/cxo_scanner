// POST /api/submit-task  { client, title, description }
// Creates a task in the client's ClickUp list, tagged as a client request, unassigned.
import { resolveClient } from '../../lib/portal/clients.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const token = process.env.CLICKUP_TOKEN;
  if (!token) return res.status(500).json({ error: 'CLICKUP_TOKEN not set' });

  const { title, description } = req.body || {};
  if (!req.body?.k) return res.status(403).json({ error: 'Missing password' });
  const who = resolveClient(req.body.k);
  if (!who) return res.status(403).json({ error: 'Invalid password' });
  const { cfg } = who;

  const name = String(title || '').trim();
  if (name.length < 3) return res.status(400).json({ error: 'Title too short' });
  if (name.length > 200) return res.status(400).json({ error: 'Title too long' });
  const desc = String(description || '').slice(0, 2000);

  const fullDesc = (desc ? desc + '\n\n' : '')
    + `— Submitted via client cockpit on ${new Date().toISOString().slice(0, 10)}`;

  const url = `https://api.clickup.com/api/v2/list/${cfg.listId}/task`;
  const withTags = { name, description: fullDesc, tags: ['client request'] };

  try {
    let r = await fetch(url, {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify(withTags),
    });
    // If the tag doesn't exist in the space, ClickUp errors — retry without tags.
    if (!r.ok) {
      r = await fetch(url, {
        method: 'POST',
        headers: { Authorization: token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: fullDesc }),
      });
      if (!r.ok) return res.status(502).json({ error: `ClickUp ${r.status}`, detail: (await r.text()).slice(0, 300) });
    }
    const j = await r.json();
    return res.status(200).json({ ok: true, id: j.id, url: j.url });
  } catch (err) {
    return res.status(500).json({ error: 'Create failed', detail: String(err).slice(0, 300) });
  }
}