'use client'

// Test lab: every Draft checkpoint on one page, grouped by what holds it back, with a decision per
// checkpoint (Promote, Fix, Keep draft, Drop) and a note. Decisions are saved in Airtable; Claude
// carries them out. Mismatches (scanner vs your label) open in the grid.
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/base'
import { HINTS, NO_CAPTURE, PARKED } from './hints'

type Decision = 'Promote' | 'Fix' | 'Keep draft' | 'Drop'
type Item = { id: string; title: string; page: string; area: string; method: string; device: string; pass: string; fail: string; na: string; free: boolean; decision: string; note: string }
type Acc = { id: string; labelled: number; agree: number; unknown: number; flips: number; mismatches: { scan: string; url: string; ai: string; louis: string }[] }
type Group = 'ready' | 'under' | 'labels' | 'capture' | 'parked'

const GROUPS: { key: Group; title: string; intro: string }[] = [
  { key: 'ready', title: 'Ready to promote', intro: 'At 90% or more against your labels, with enough labels. Promote unless the definition itself is wrong.' },
  { key: 'under', title: 'Under 90%', intro: 'The scanner and you disagree too often. Open the mismatches: either the definition needs a fix, or the label does.' },
  { key: 'labels', title: 'Needs labels', intro: 'Not enough labels to judge yet. Label in the grid, or drop it if it is not worth it.' },
  { key: 'capture', title: 'Missing a capture step', intro: 'The scanner does not collect what this needs yet. Decide if it is worth building.' },
  { key: 'parked', title: 'Parked', intro: 'Being rebuilt or kept back on purpose.' },
]
const DECISIONS: { v: Decision; tone: { bg: string; fg: string } }[] = [
  { v: 'Promote', tone: { bg: 'var(--result-pass-bg)', fg: 'var(--result-pass-fg)' } },
  { v: 'Fix', tone: { bg: 'var(--status-progress-bg)', fg: 'var(--status-progress-fg)' } },
  { v: 'Keep draft', tone: { bg: 'var(--surface-muted)', fg: 'var(--text-muted)' } },
  { v: 'Drop', tone: { bg: 'var(--result-fail-bg)', fg: 'var(--result-fail-fg)' } },
]
const WORD: Record<string, string> = { pass: 'Pass', fail: 'Fail', na: 'Not relevant', unknown: 'Couldn’t check', skip: 'Can’t tell' }
const minFor = (method: string) => (method === 'Measured' ? 3 : 5)
const host = (u: string) => {
  try {
    return new URL(u).host.replace(/^www\./, '')
  } catch {
    return u
  }
}

export default function DraftsReview() {
  const [key, setKey] = useState('')
  const [items, setItems] = useState<Item[] | null>(null)
  const [acc, setAcc] = useState<Map<string, Acc>>(new Map())
  const [error, setError] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [filter, setFilter] = useState<'all' | 'todo'>('all')

  const q = useCallback((k: string) => (k ? `?key=${encodeURIComponent(k)}` : ''), [])

  useEffect(() => {
    const k = new URLSearchParams(window.location.search).get('key') || ''
    setKey(k)
    const get = (p: string) => fetch(api(p + q(k))).then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({})))?.error || String(r.status)))))
    Promise.all([get('/lab/drafts'), get('/lab/scans')])
      .then(([d, s]) => {
        setItems(d.items)
        setAcc(new Map((s.accuracy as Acc[]).map((a) => [a.id, a])))
      })
      .catch((e) => setError(String(e.message || e)))
  }, [q])

  const groupOf = useCallback(
    (it: Item): Group => {
      if (NO_CAPTURE.has(it.id)) return 'capture'
      if (PARKED.has(it.id)) return 'parked'
      const a = acc.get(it.id)
      const judged = a ? a.labelled : 0
      if (judged < minFor(it.method)) return 'labels'
      return a && a.agree / a.labelled >= 0.9 ? 'ready' : 'under'
    },
    [acc],
  )

  const grouped = useMemo(() => {
    const out: Record<Group, Item[]> = { ready: [], under: [], labels: [], capture: [], parked: [] }
    for (const it of items || []) out[groupOf(it)].push(it)
    for (const g of Object.keys(out) as Group[]) out[g].sort((a, b) => a.page.localeCompare(b.page) || a.title.localeCompare(b.title))
    return out
  }, [items, groupOf])

  const save = async (id: string, patch: { decision?: string | null; note?: string }) => {
    setSaving((s) => ({ ...s, [id]: true }))
    setItems((list) => (list ? list.map((x) => (x.id === id ? { ...x, ...(patch.decision !== undefined ? { decision: patch.decision || '' } : {}), ...(patch.note !== undefined ? { note: patch.note } : {}) } : x)) : list))
    await fetch(api(`/lab/drafts${q(key)}`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...patch }) }).catch(() => {})
    setSaving((s) => ({ ...s, [id]: false }))
  }

  const decided = (items || []).filter((x) => x.decision).length

  return (
    <main className="min-h-dvh bg-[var(--bg)]">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-6 px-[var(--gutter)] py-6">
        <Link href={`/lab${q(key)}`} className="text-sm text-[var(--text-muted)] underline">
          ← Lab
        </Link>
        <header className="flex flex-col gap-2">
          <h1 className="font-[family-name:var(--font-display)] text-[length:var(--text-2xl)] font-bold leading-tight text-[var(--text)]">Draft checkpoints review</h1>
          <p className="text-sm leading-relaxed text-[var(--text-muted)]">
            One decision per checkpoint. <b>Promote</b> puts it in the paid scan, <b>Fix</b> means the definition or the measurement needs work (say what in the note), <b>Keep draft</b> waits for more stores, <b>Drop</b> turns it off.
            Decisions are saved in Airtable; I carry them out.
          </p>
          {items && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-[var(--text)]">
                <b>{decided}</b> of {items.length} decided
              </span>
              <span className="text-[var(--text-muted)]">·</span>
              {(['all', 'todo'] as const).map((f) => (
                <button key={f} type="button" onClick={() => setFilter(f)} className={`rounded-full border px-3 py-1 text-[13px] font-semibold ${filter === f ? 'border-[var(--text)] text-[var(--text)]' : 'border-[var(--border)] text-[var(--text-muted)]'}`}>
                  {f === 'all' ? 'All' : 'Not decided yet'}
                </button>
              ))}
            </div>
          )}
        </header>

        {error && <p className="text-[var(--result-fail-fg)]">Could not load: {error}</p>}
        {!items && !error && <p className="text-[var(--text-muted)]">Loading the Draft checkpoints and their accuracy…</p>}

        {items &&
          GROUPS.map((g) => {
            const list = grouped[g.key].filter((x) => filter === 'all' || !x.decision)
            if (!grouped[g.key].length) return null
            return (
              <section key={g.key} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <h2 className="font-[family-name:var(--font-display)] text-[length:var(--text-xl)] font-bold text-[var(--text)]">
                    {g.title} <span className="font-normal text-[var(--text-muted)]">({grouped[g.key].length})</span>
                  </h2>
                  <p className="text-[13px] text-[var(--text-muted)]">{g.intro}</p>
                </div>
                {list.length === 0 && <p className="text-[13px] text-[var(--text-muted)]">All decided.</p>}
                <ul className="flex flex-col gap-2">
                  {list.map((it) => {
                    const a = acc.get(it.id)
                    const pct = a && a.labelled ? Math.round((100 * a.agree) / a.labelled) : null
                    const hint = HINTS[it.id]
                    const isOpen = !!open[it.id]
                    return (
                      <li key={it.id} className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
                        <div className="flex flex-wrap items-start gap-3 p-4 max-[560px]:flex-col">
                          <button type="button" onClick={() => setOpen((o) => ({ ...o, [it.id]: !o[it.id] }))} className="flex min-w-0 flex-1 flex-col gap-1 text-left" aria-expanded={isOpen}>
                            <span className="text-[15px] font-semibold leading-snug text-[var(--text)]">{it.title}</span>
                            <span className="text-[12px] text-[var(--text-muted)]">
                              {it.page}
                              {it.area ? ` · ${it.area}` : ''} · {it.method || 'No method'}
                              {a ? ` · ${a.agree}/${a.labelled} agree${pct !== null ? ` (${pct}%)` : ''}` : ' · no labels'}
                              {a?.unknown ? ` · ${a.unknown} couldn’t check` : ''}
                              {a?.flips ? ` · ${a.flips} flips` : ''}
                            </span>
                            {hint && <span className="text-[13px] leading-relaxed text-[var(--text)]">My take: {hint}</span>}
                          </button>
                          <div className="flex shrink-0 flex-wrap gap-1.5" role="group" aria-label="Decision">
                            {DECISIONS.map((d) => {
                              const on = it.decision === d.v
                              return (
                                <button
                                  key={d.v}
                                  type="button"
                                  disabled={saving[it.id]}
                                  aria-pressed={on}
                                  onClick={() => save(it.id, { decision: on ? null : d.v })}
                                  className="rounded-full border px-3 py-1 text-[12px] font-semibold"
                                  style={on ? { background: d.tone.bg, color: d.tone.fg, borderColor: d.tone.fg } : { borderColor: 'var(--border)', color: 'var(--text-muted)' }}
                                >
                                  {d.v}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                        {isOpen && (
                          <div className="flex flex-col gap-4 border-t border-[var(--border)] bg-[var(--bg-subtle)] p-4">
                            <dl className="grid gap-3 text-[13px] leading-relaxed md:grid-cols-3">
                              {[
                                ['Pass when', it.pass],
                                ['Fail when', it.fail],
                                ['Not relevant when', it.na],
                              ].map(([k, v]) => (
                                <div key={k}>
                                  <dt className="font-semibold text-[var(--text)]">{k}</dt>
                                  <dd className="text-[var(--text-muted)]">{v || '–'}</dd>
                                </div>
                              ))}
                            </dl>
                            {a && a.mismatches.length > 0 && (
                              <div className="flex flex-col gap-1.5 text-[13px]">
                                <p className="font-semibold text-[var(--text)]">Where you and the scanner disagree</p>
                                <ul className="flex flex-col gap-1">
                                  {a.mismatches.map((m) => (
                                    <li key={m.scan} className="flex flex-wrap gap-2 text-[var(--text-muted)]">
                                      <Link href={`/lab/${m.scan}?cp=${it.id}${key ? `&key=${encodeURIComponent(key)}` : ''}`} className="font-semibold text-[var(--text)] underline">
                                        {host(m.url)}
                                      </Link>
                                      <span>
                                        scanner {WORD[m.ai] || m.ai}, you {WORD[m.louis] || m.louis}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            <div className="flex flex-wrap items-center gap-3 text-[13px]">
                              <Link href={`/lab/grid?cp=${it.id}${key ? `&key=${encodeURIComponent(key)}` : ''}`} className="font-semibold text-[var(--text)] underline">
                                Open in the grid
                              </Link>
                              {it.free && <span className="text-[var(--text-muted)]">In the free scan</span>}
                            </div>
                            <label className="flex flex-col gap-1 text-[13px]">
                              <span className="font-semibold text-[var(--text)]">Your note (what to fix, or why)</span>
                              <textarea
                                defaultValue={it.note}
                                rows={2}
                                onBlur={(e) => e.target.value !== it.note && save(it.id, { note: e.target.value })}
                                className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-2 text-[var(--text)]"
                              />
                            </label>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
      </div>
    </main>
  )
}
