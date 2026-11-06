'use client'

// Lead dashboard: everyone who went through cxo.studio/start, with their free scan results.
// Open with ?key=LAB_KEY (open on previews). Data: app/api/admin/leads, schema supabase/lead_scans.sql.
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/base'
import { eur } from '@/lib/estimate'

type Answer = 'pass' | 'fail' | 'na' | 'unknown'
type ScanRow = { id: string; created_at: string; scan_id: string | null; url: string; page_type: string | null; niche: string | null; score: number | null; passed: number | null; failed: number | null; na: number | null; unknown: number | null; test: boolean; results: { id: string; title: string; answer: Answer; reason: string; priority?: string; difficulty?: string }[] | null }
type Status = 'new' | 'contacted' | 'call' | 'won' | 'lost'
type LeadRow = {
  id: string
  created_at: string
  email: string
  name: string | null
  site_type: string
  platform: string | null
  url: string | null
  revenue_band: string | null
  traffic_band: string | null
  conversion_band: string | null
  aov_band: string | null
  goal: string | null
  route: string
  locale: string | null
  source: Record<string, string> | null
  status?: Status | null
  notes?: string | null
  scans: ScanRow[]
  leak: number | null
  worthCall: boolean
  test: boolean
  earlier: number
}

const BOOKING_URL = 'https://tally.so/r/w2dP9M'
const STATUSES: { id: Status; label: string; fg: string; bg: string }[] = [
  { id: 'new', label: 'New', fg: 'var(--status-progress-fg)', bg: 'var(--status-progress-bg)' },
  { id: 'contacted', label: 'Contacted', fg: 'var(--status-test-fg)', bg: 'var(--status-test-bg)' },
  { id: 'call', label: 'Call booked', fg: 'var(--status-finding-fg)', bg: 'var(--status-finding-bg)' },
  { id: 'won', label: 'Won', fg: 'var(--status-proven-fg)', bg: 'var(--status-proven-bg)' },
  { id: 'lost', label: 'Lost', fg: 'var(--status-observed-fg)', bg: 'var(--status-observed-bg)' },
]
const statusOf = (s?: Status | null) => STATUSES.find((x) => x.id === s) || STATUSES[0]

type Filter = 'all' | 'worth' | Status
const FILTERS: { id: Filter; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'worth', label: 'Worth a call' }, ...STATUSES.map((s) => ({ id: s.id as Filter, label: s.label }))]

const host = (u?: string | null) => {
  if (!u) return ''
  try {
    return new URL(/^https?:\/\//.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, '')
  } catch {
    return u
  }
}
const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const shortBand = (b?: string | null) => (b ? b.replace(' / month', '').replace(/€(\d+),000/g, '€$1k') : '')
const sourceOf = (s: LeadRow['source']) => {
  if (!s) return 'Direct'
  if (s.utm_source) return [s.utm_source, s.utm_campaign].filter(Boolean).join(' · ')
  return host(s.referrer) || 'Direct'
}
const scoreColor = (n: number | null) => (n === null ? 'var(--text-muted)' : n < 50 ? 'var(--result-fail-fg)' : n < 75 ? 'var(--status-finding-fg)' : 'var(--result-pass-fg)')

/** Failed checkpoints, the ones worth fixing first on top: high priority, then easiest. */
function topFails(scan?: ScanRow) {
  const eff = (d?: string) => ({ Easy: 0, Moderate: 1, Difficult: 2 })[d || ''] ?? 1
  return (scan?.results || []).filter((r) => r.answer === 'fail').sort((a, b) => (a.priority === 'High' ? 0 : 10) + eff(a.difficulty) - ((b.priority === 'High' ? 0 : 10) + eff(b.difficulty)))
}

function draftEmail(l: LeadRow) {
  const scan = l.scans[0]
  const fails = topFails(scan).slice(0, 3)
  const site = host(scan?.url || l.url)
  const fr = l.locale === 'fr'
  const name = l.name?.split(' ')[0]
  const list = fails.map((f, i) => `${i + 1}. ${f.title}`).join('\n')
  if (fr) {
    return {
      subject: `Votre scan ${site} : par où commencer`,
      body: [
        `Bonjour${name ? ` ${name}` : ''},`,
        '',
        `Vous avez lancé notre scan de conversion gratuit sur ${site}. Score : ${scan?.score ?? '?'}/100, ${scan?.failed ?? 0} points à corriger.`,
        '',
        'Les trois que je corrigerais en premier :',
        list,
        '',
        l.leak ? `À vos chiffres, +10 % de conversion représente environ ${eur(l.leak)} par mois.` : '',
        `Je vous montre comment les corriger en 20 minutes : ${BOOKING_URL}`,
        '',
        'Louis',
        'CXO Studio',
      ].filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n'),
    }
  }
  return {
    subject: `Your ${site} scan: where to start`,
    body: [
      `Hi${name ? ` ${name}` : ''},`,
      '',
      `You ran our free conversion scan on ${site}. It scored ${scan?.score ?? '?'}/100 with ${scan?.failed ?? 0} things to fix.`,
      '',
      "The three I'd fix first:",
      list,
      '',
      l.leak ? `At your numbers, a 10% conversion lift is worth about ${eur(l.leak)} a month.` : '',
      `Happy to walk you through the fixes in 20 minutes: ${BOOKING_URL}`,
      '',
      'Louis',
      'CXO Studio',
    ].filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n'),
  }
}

export default function LeadsPage() {
  const [key, setKey] = useState('')
  const [data, setData] = useState<{ leads: LeadRow[]; scansError: string | null } | null>(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [showTests, setShowTests] = useState(false)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [saving, setSaving] = useState<Record<string, string>>({})

  const load = (k: string) =>
    fetch(api(`/admin/leads${k ? `?key=${encodeURIComponent(k)}` : ''}`))
      .then(async (r) => {
        const d = await r.json()
        if (!r.ok) throw new Error(d.error || String(r.status))
        setData(d)
        setError('')
      })
      .catch((e) => setError(String(e.message || e)))

  useEffect(() => {
    const k = new URLSearchParams(window.location.search).get('key') || ''
    setKey(k)
    load(k)
  }, [])

  const save = async (l: LeadRow, patch: { status?: Status; notes?: string }) => {
    setSaving((m) => ({ ...m, [l.id]: 'Saving…' }))
    const r = await fetch(api(`/admin/leads${key ? `?key=${encodeURIComponent(key)}` : ''}`), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: l.id, ...patch }) })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) {
      setSaving((m) => ({ ...m, [l.id]: d.error || 'Not saved' }))
      return
    }
    setData((cur) => (cur ? { ...cur, leads: cur.leads.map((x) => (x.id === l.id ? { ...x, ...patch } : x)) } : cur))
    setSaving((m) => ({ ...m, [l.id]: 'Saved' }))
  }

  const visible = useMemo(() => {
    if (!data) return []
    const q = query.trim().toLowerCase()
    return data.leads.filter((l) => {
      if (!showTests && l.test) return false
      if (filter === 'worth' && !(l.worthCall && (l.status || 'new') === 'new')) return false
      if (filter !== 'all' && filter !== 'worth' && (l.status || 'new') !== filter) return false
      if (q && !`${l.email} ${l.name || ''} ${l.url || ''} ${l.scans.map((s) => s.url).join(' ')}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [data, filter, showTests, query])

  const stats = useMemo(() => {
    const real = (data?.leads || []).filter((l) => !l.test)
    const week = Date.now() - 7 * 864e5
    const scanned = real.filter((l) => l.scans.length)
    const scores = scanned.map((l) => l.scans[0].score).filter((n): n is number => typeof n === 'number')
    return {
      total: real.length,
      week: real.filter((l) => new Date(l.created_at).getTime() > week).length,
      scanned: scanned.length,
      avg: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
      worth: real.filter((l) => l.worthCall && (l.status || 'new') === 'new').length,
    }
  }, [data])

  const q = key ? `?key=${encodeURIComponent(key)}` : ''

  return (
    <main className="min-h-screen bg-[var(--bg)] px-[var(--gutter)] py-10 font-[family-name:var(--font-body)] text-[var(--text)]">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-8">
        <header className="flex flex-col gap-2">
          <Link href={`/lab${q}`} className="text-sm text-[var(--text-muted)] hover:underline">
            ← Lab
          </Link>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-extrabold tracking-[-0.02em]">Leads</h1>
          <p className="max-w-[680px] text-sm leading-relaxed text-[var(--text-muted)]">
            Everyone who went through cxo.studio/start, newest first, with their free scan. Leak is a 10% conversion lift on the revenue they gave. Worth a call: asked for one, or over €10k a month with a score under 80, and not contacted yet.
          </p>
        </header>

        {data?.scansError && (
          <p className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--status-finding-bg)] p-4 text-sm text-[var(--status-finding-fg)]">
            Scan results are not stored yet ({data.scansError}). Run <code>supabase/lead_scans.sql</code> once in Supabase → SQL Editor.
          </p>
        )}
        {error && <p className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--result-fail-fg)]">Could not load leads: {error}</p>}
        {!data && !error && <p className="text-sm text-[var(--text-muted)]">Loading…</p>}

        {data && (
          <>
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {[
                ['Leads', stats.total],
                ['This week', stats.week],
                ['Scanned', stats.scanned],
                ['Avg. score', stats.avg ?? '–'],
                ['Worth a call', stats.worth],
              ].map(([label, value]) => (
                <div key={label} className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4">
                  <p className="text-xs font-semibold text-[var(--text-muted)]">{label}</p>
                  <p className="font-[family-name:var(--font-display)] text-2xl font-extrabold">{value}</p>
                </div>
              ))}
            </section>

            <section className="flex flex-wrap items-center gap-2">
              {FILTERS.map((f) => (
                <button key={f.id} type="button" onClick={() => setFilter(f.id)} className="rounded-[var(--radius-pill)] border border-[var(--border)] px-3 py-1 text-xs font-semibold" style={{ background: filter === f.id ? 'var(--text)' : 'var(--surface)', color: filter === f.id ? 'var(--surface)' : 'var(--text)' }}>
                  {f.label}
                </button>
              ))}
              <label className="ml-1 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                <input type="checkbox" checked={showTests} onChange={(e) => setShowTests(e.target.checked)} /> Show test scans
              </label>
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search email or store" className="ml-auto w-full min-w-0 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm sm:w-[240px]" />
            </section>

            <section className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
              <div className="hidden grid-cols-[70px_1.4fr_1.1fr_1fr_60px_50px_80px_1.6fr_110px] gap-3 border-b border-[var(--border)] px-4 py-2 text-xs font-semibold text-[var(--text-muted)] lg:grid">
                <span>Date</span>
                <span>Store · email</span>
                <span>Revenue · AOV · CR</span>
                <span>Source</span>
                <span>Score</span>
                <span>Fails</span>
                <span>Leak</span>
                <span>Top issues</span>
                <span>Status</span>
              </div>
              {visible.length === 0 && <p className="px-4 py-6 text-sm text-[var(--text-muted)]">No leads match.</p>}
              <div className="divide-y divide-[var(--border)]">
                {visible.map((l) => {
                  const scan = l.scans[0]
                  const fails = topFails(scan)
                  const st = statusOf(l.status)
                  const isOpen = open === l.id
                  return (
                    <div key={l.id}>
                      <button type="button" onClick={() => setOpen(isOpen ? null : l.id)} className="grid w-full grid-cols-2 gap-x-3 gap-y-1 px-4 py-3 text-left text-sm hover:bg-[var(--bg-subtle)] lg:grid-cols-[70px_1.4fr_1.1fr_1fr_60px_50px_80px_1.6fr_110px] lg:items-center">
                        <span className="text-[var(--text-muted)]">{day(scan?.created_at || l.created_at)}</span>
                        <span className="col-span-2 min-w-0 lg:col-span-1">
                          <span className="block truncate font-semibold">
                            {host(scan?.url || l.url) || '–'}
                            {l.worthCall && (l.status || 'new') === 'new' && <span className="ml-2 rounded-[var(--radius-pill)] bg-[var(--status-finding-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--status-finding-fg)]">Worth a call</span>}
                          </span>
                          <span className="block truncate text-xs text-[var(--text-muted)]">{l.email}{l.name ? ` · ${l.name}` : ''}</span>
                        </span>
                        <span className="text-xs text-[var(--text-muted)]">
                          {l.site_type !== 'ecommerce' ? `${l.site_type}${l.goal ? ` · ${l.goal}` : ''}` : [shortBand(l.revenue_band), l.aov_band && `AOV ${l.aov_band}`, l.conversion_band && `CR ${l.conversion_band}`].filter(Boolean).join(' · ') || '–'}
                        </span>
                        <span className="truncate text-xs text-[var(--text-muted)]">{sourceOf(l.source)}{l.route === 'call' ? ' · asked for a call' : ''}</span>
                        <span className="font-[family-name:var(--font-display)] font-bold" style={{ color: scoreColor(scan?.score ?? null) }}><span className="font-[family-name:var(--font-body)] text-xs font-normal text-[var(--text-muted)] lg:hidden">Score </span>{scan?.score ?? '–'}</span>
                        <span>{scan ? scan.failed : '–'}<span className="text-xs text-[var(--text-muted)] lg:hidden"> fails</span></span>
                        <span className="font-semibold"><span className="text-xs font-normal text-[var(--text-muted)] lg:hidden">Leak </span>{l.leak ? `${eur(l.leak)}/mo` : '–'}</span>
                        <span className="col-span-2 truncate text-xs text-[var(--text-muted)] lg:col-span-1">{fails.slice(0, 3).map((f) => f.title).join(' · ') || (scan ? 'No fails' : 'No scan')}</span>
                        <span className="w-fit rounded-[var(--radius-pill)] px-2.5 py-0.5 text-xs font-semibold" style={{ background: st.bg, color: st.fg }}>{st.label}</span>
                      </button>
                      {isOpen && <Detail lead={l} saving={saving[l.id]} onSave={(p) => save(l, p)} />}
                    </div>
                  )
                })}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  )
}

function Detail({ lead: l, saving, onSave }: { lead: LeadRow; saving?: string; onSave: (p: { status?: Status; notes?: string }) => void }) {
  const [notes, setNotes] = useState(l.notes || '')
  const [copied, setCopied] = useState('')
  const [scanIdx, setScanIdx] = useState(0)
  const scan = l.scans[scanIdx]
  const email = draftEmail(l)
  const editable = !l.id.startsWith('scan:')
  const groups: { answer: Answer; label: string; fg: string }[] = [
    { answer: 'fail', label: 'To fix', fg: 'var(--result-fail-fg)' },
    { answer: 'unknown', label: "Couldn't check", fg: 'var(--text-muted)' },
    { answer: 'pass', label: 'Passed', fg: 'var(--result-pass-fg)' },
    { answer: 'na', label: 'Not relevant', fg: 'var(--text-muted)' },
  ]
  const copy = (what: string, text: string) => navigator.clipboard.writeText(text).then(() => setCopied(what))

  return (
    <div className="grid gap-6 border-t border-[var(--border)] bg-[var(--bg-subtle)] px-4 py-5 lg:grid-cols-[1.3fr_1fr]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {l.scans.length > 1 &&
            l.scans.map((s, i) => (
              <button key={s.id} type="button" onClick={() => setScanIdx(i)} className="rounded-[var(--radius-pill)] border border-[var(--border)] px-2.5 py-0.5 text-xs font-semibold" style={{ background: i === scanIdx ? 'var(--text)' : 'var(--surface)', color: i === scanIdx ? 'var(--surface)' : 'var(--text)' }}>
                {day(s.created_at)} · {s.page_type}
              </button>
            ))}
          {scan && (
            <a href={scan.url} target="_blank" rel="noreferrer" className="truncate text-[var(--text-muted)] underline">
              {scan.url}
            </a>
          )}
        </div>
        {!scan && <p className="text-sm text-[var(--text-muted)]">{l.route === 'call' ? 'Asked for a call, no scan.' : 'No scan stored for this email.'}</p>}
        {scan &&
          groups.map((g) => {
            const items = (g.answer === 'fail' ? topFails(scan) : (scan.results || []).filter((r) => r.answer === g.answer))
            if (!items.length) return null
            const short = g.answer === 'pass' || g.answer === 'na'
            return (
              <details key={g.answer} open={g.answer === 'fail'} className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
                <summary className="cursor-pointer px-3 py-2 text-sm font-semibold" style={{ color: g.fg }}>
                  {g.label} ({items.length})
                </summary>
                <ul className="flex flex-col divide-y divide-[var(--border)] border-t border-[var(--border)]">
                  {items.map((r) => (
                    <li key={r.id} className="px-3 py-2 text-sm">
                      <span className="font-semibold">{r.title}</span>
                      {r.priority === 'High' && g.answer === 'fail' && <span className="ml-2 text-xs text-[var(--status-finding-fg)]">High</span>}
                      {r.difficulty && g.answer === 'fail' && <span className="ml-2 text-xs text-[var(--text-muted)]">{r.difficulty}</span>}
                      {!short && <p className="text-[var(--text-muted)]">{r.reason}</p>}
                    </li>
                  ))}
                </ul>
              </details>
            )
          })}
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-[var(--text-muted)]">First seen</dt>
          <dd>{new Date(l.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}{l.earlier ? ` (${l.earlier + 1} visits to /start)` : ''}</dd>
          <dt className="text-[var(--text-muted)]">Platform</dt>
          <dd>{[l.site_type, l.platform].filter(Boolean).join(' · ')}</dd>
          {l.traffic_band && (
            <>
              <dt className="text-[var(--text-muted)]">Traffic</dt>
              <dd>{l.traffic_band}</dd>
            </>
          )}
          <dt className="text-[var(--text-muted)]">Language</dt>
          <dd>{l.locale || '–'}</dd>
          {scan?.niche && (
            <>
              <dt className="text-[var(--text-muted)]">Niche</dt>
              <dd>{scan.niche}</dd>
            </>
          )}
          {l.source && (
            <>
              <dt className="text-[var(--text-muted)]">Source</dt>
              <dd className="break-all">{Object.entries(l.source).map(([k, v]) => `${k}: ${v}`).join(' · ')}</dd>
            </>
          )}
        </dl>

        {editable ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-1.5">
              {STATUSES.map((s) => (
                <button key={s.id} type="button" onClick={() => onSave({ status: s.id })} className="rounded-[var(--radius-pill)] border px-2.5 py-0.5 text-xs font-semibold" style={{ background: (l.status || 'new') === s.id ? s.bg : 'var(--surface)', color: s.fg, borderColor: (l.status || 'new') === s.id ? s.fg : 'var(--border)' }}>
                  {s.label}
                </button>
              ))}
            </div>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Notes" className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm" />
            <div className="flex items-center gap-3">
              <button type="button" className="cxo-btn cxo-btn-primary" onClick={() => onSave({ notes })} disabled={notes === (l.notes || '')}>
                Save notes
              </button>
              {saving && <span className="text-xs text-[var(--text-muted)]">{saving}</span>}
            </div>
          </div>
        ) : (
          <p className="text-xs text-[var(--text-muted)]">Scanned from a direct link, without the /start questions: no status or notes.</p>
        )}

        {scan && (
          <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">Outreach draft</p>
              <div className="flex gap-2">
                <button type="button" className="text-xs font-semibold underline" onClick={() => copy('subject', email.subject)}>
                  {copied === 'subject' ? 'Copied' : 'Copy subject'}
                </button>
                <button type="button" className="text-xs font-semibold underline" onClick={() => copy('body', email.body)}>
                  {copied === 'body' ? 'Copied' : 'Copy email'}
                </button>
                <a className="text-xs font-semibold underline" href={`mailto:${l.email}?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`}>
                  Open in mail
                </a>
              </div>
            </div>
            <p className="text-sm font-semibold">{email.subject}</p>
            <pre className="whitespace-pre-wrap font-[family-name:var(--font-body)] text-sm text-[var(--text-muted)]">{email.body}</pre>
          </div>
        )}
      </div>
    </div>
  )
}
