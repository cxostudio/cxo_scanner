// Shared client config + helpers. Add a client = add one entry to CLIENTS.
export const TEAM_ID = '90152412068';
export const TZ = 'Europe/Amsterdam';
export const CXO_LOGO = 'https://cxo.studio/framer/YhfPidMDBtIF430QppvXfExAM5w.png';

export const CLIENTS = {
  skinlovers: {
    name: 'Skinlovers',
    key: 'skinlovers.com',   // fallback password (client domain), disabled once keyEnv is set
    keyEnv: 'PORTAL_KEY_SKINLOVERS', // strong passphrase in Vercel env → required for revenue data
    listId: '901523077756',
    capHours: 16,     // fixed retainer → gauge view
    since: '2026-07', // first month browsable in the portal (YYYY-MM)
    lang: 'en',
    perfUrl: 'https://drive.google.com/drive/folders/1nPWu_BWKkr9gca2lPbzi8cyP46Cibpu8',
    perfLabel: 'A/B test results',
    logo: 'https://www.skinlovers.com/cdn/shop/files/Logo_2facf971-8fea-401f-b49e-22e518508ec7_100x@2x.webp?v=1782191881',
    // ── cockpit ──
    shop: 'skinlovers-eu.myshopify.com',
    shopEnv: 'SKINLOVERS',            // → SHOPIFY_CLIENT_ID_SKINLOVERS / SHOPIFY_CLIENT_SECRET_SKINLOVERS
    day0: '2025-02-01',               // start of the engagement: every "since" is measured from here
    timelineLists: ['901523077756', '1200630000011654'], // live list + Asana archive
    monthlyFee: null,
    // Shopify sessions can't give a whole-store conversion rate here: the bot-free subset holds only
    // ~60-80% of orders, and that share moves over time. Conversion / revenue per visitor stay hidden.
    trustSessions: false,                 // € per month the client pays CXO; null hides the return multiple
    // "Qualified sessions": Shopify counts a lot of bot traffic on this store (China, LatAm,
    // fake Facebook/direct desktop visits, almost never buying). Conversion metrics are computed
    // only on sessions from the markets the store sells to, minus desktop visits arriving as
    // direct/social/unknown. Validated Oct 2026: add-to-cart stable at 10-12% instead of 2-45%.
    qualifiedSessions: {
      markets: ['United States', 'Australia', 'Canada', 'Portugal', 'United Arab Emirates', 'United Kingdom',
        'Saudi Arabia', 'Qatar', 'Spain', 'France', 'Ireland', 'Netherlands', 'Belgium', 'Italy',
        'Switzerland', 'Kuwait', 'Bahrain', 'New Zealand', 'Israel', 'Malta', 'Luxembourg'],
      excludeDesktopReferrers: ['direct', 'social', 'unknown', ''],
    },
  },
  esteden: {
    name: "À l'Est d'Eden",
    key: 'esteden.be',       // access password (client domain)
    listId: '901523078135',
    capHours: null,   // pay-as-you-go → composition view
    since: '2026-07',
    lang: 'fr',
    perfUrl: 'https://docs.google.com/spreadsheets/d/1ANjtjT2OHreRjKG9rPEhUJm-Gw9GzQQ6NhmbFCrziFg/edit?gid=259038589#gid=259038589',
    perfLabel: 'Performances du site',
    logo: 'https://www.esteden.be/cdn/shop/files/A_l_Est_d_Eden.png?v=1750948596&width=136',
  },
};

// ClickUp workspace custom fields that feed the cockpit (created Oct 2026, shared by every client).
export const FIELDS = {
  funnelStage: '5f212d73-ed78-4c94-b938-434b6bdedac2',
  workType: '46ed1584-ccdd-4092-9c4c-452f6d26db2a',
  goLive: 'd68d6ac9-8dca-4664-a1a0-9380ad9755b7',
  clientVisible: 'f16d6429-2184-458e-8cb2-1fba189153a6',
  testVerdict: '22edecb2-066a-454e-bfad-6d56b2e14c89',
  testUplift: '3a4ddb26-f16b-4760-99af-9c11cb6c513e',
  revenueExposed: '0dc355df-258e-4808-a580-010477b86e41',
};

const norm = v => String(v || '').trim().toLowerCase()
  .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');

// Resolve a client from the password typed at the gate.
// - The passphrase in `keyEnv` (Vercel env) is a "strong" login: the only one allowed to read
//   revenue data.
// - The client's domain stays a "weak" login: hours, tasks and the timeline, never revenue.
//   So adding a passphrase never locks anyone out of what they could already see.
export function resolveClient(raw) {
  const cred = norm(raw);
  if (!cred) return null;
  for (const [key, cfg] of Object.entries(CLIENTS)) {
    const strongKey = cfg.keyEnv ? norm(process.env[cfg.keyEnv]) : '';
    if (strongKey && cred === strongKey) return { key, cfg, strong: true };
  }
  for (const [key, cfg] of Object.entries(CLIENTS)) {
    if (cfg.key && norm(cfg.key) === cred) return { key, cfg, strong: false };
  }
  return null;
}

export const clientByShop = shop => Object.entries(CLIENTS).find(([, c]) => c.shop === shop) || null;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// Midnight in TZ for a given calendar date, independent of the server's own timezone.
export function zonedTs(y, m, d) {
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(guess).reduce((o, p) => (p.type !== 'literal' && (o[p.type] = Number(p.value)), o), {});
  const asUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
  return guess - (asUTC - guess);
}

// 'YYYY-MM' for right now, in TZ.
export function currentMonthKey(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' }).format(now);
}

// Window for a month. No argument (or an invalid one) = the current month.
export function monthBounds(monthKey, now = new Date()) {
  const current = currentMonthKey(now);
  const key = MONTH_RE.test(monthKey || '') ? monthKey : current;
  const [y, m] = key.split('-').map(Number);
  const start = zonedTs(y, m, 1);
  const reset = m === 12 ? zonedTs(y + 1, 1, 1) : zonedTs(y, m + 1, 1);
  return { key, start, reset, isCurrent: key === current };
}

// Every month from `since` up to and including the current one, oldest first.
export function monthsSince(since, now = new Date()) {
  const current = currentMonthKey(now);
  if (!MONTH_RE.test(since || '') || since > current) return [current];
  let [y, m] = since.split('-').map(Number);
  const out = [];
  for (let i = 0; i < 120; i++) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    out.push(key);
    if (key === current) break;
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

// Four client-facing lanes: backlog is now distinct from to-do.
export function lane(status) {
  const type = (status?.type || '').toLowerCase();
  const name = (status?.status || '').toLowerCase();
  if (type === 'closed' || type === 'done') return 'done';
  if (name.includes('backlog')) return 'backlog';
  if (/progress|doing|review|wip|en cours/.test(name)) return 'progress';
  return 'todo';
}