'use client'

// Test lab: review the checkpoint rewrites one by one, as a client would read them in the report.
// Left: the card as clients see it today. Right: the same card with the proposed text.
// Below: the scanner side (definitions, short fix). Verdicts go straight to Airtable (Rewrite field).
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckpointResultBody } from '../../components/CheckpointResultBody'
import { api } from '@/lib/base'

type Text = { title: string; pass: string; fail: string; na: string; fix: string; actions: string; why: string }
type Item = {
  id: string
  page: string
  status: string
  area: string
  method: string
  rewrite: string
  comment: string
  notes: string
  now: Text
  proposed: Text
  examples: { url: string; filename: string; thumbnailUrl: string }[]
  finding?: { host: string; scan: string; reason: string; answer: string }
}
type Verdict = 'To review' | 'Approved' | 'Changes needed'
type View = 'both' | 'proposed'
type Width = 'desktop' | 'phone'

const STATE_STYLE: Record<string, { fg: string; bg: string }> = {
  Approved: { fg: 'var(--result-pass-fg)', bg: 'var(--result-pass-bg)' },
  'Changes needed': { fg: 'var(--result-fail-fg)', bg: 'var(--result-fail-bg)' },
  'To review': { fg: 'var(--text-muted)', bg: 'var(--surface-muted)' },
  Applied: { fg: 'var(--text-muted)', bg: 'var(--surface-muted)' },
}
const norm = (t: string) => t.replace(/\s+/g, ' ').trim()
const changed = (a: string, b: string) => norm(a) !== norm(b)

export default function RewriteReview() {
  const [key, setKey] = useState('')
  const [items, setItems] = useState<Item[] | null>(null)
  const [error, setError] = useState('')
  const [page, setPage] = useState('')
  const [state, setState] = useState<Verdict | 'all'>('To review')
  const [view, setView] = useState<View>('both')
  const [width, setWidth] = useState<Width>('desktop')
  const [id, setId] = useState('')
  const [comment, setComment] = useState('')
  const [asking, setAsking] = useState(false)
  const [save, setSave] = useState<{ state: 'idle' | 'saving' | 'saved' | 'error'; note?: string }>({ state: 'idle' })

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const k = q.get('key') || ''
    setKey(k)
    if (q.get('page')) setPage(q.get('page')!)
    try {
      const w = localStorage.getItem('review-width')
      if (w === 'phone') setWidth('phone')
      if (localStorage.getItem('review-view') === 'proposed') setView('proposed')
    } catch {}
    fetch(api(`/lab/rewrite${k ? `?key=${encodeURIComponent(k)}` : ''}`))
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({})))?.error || String(r.status)))))
      .then((d: { items: Item[] }) => {
        setItems(d.items)
        const want = q.get('id')
        const first = (want && d.items.find((x) => x.id === want)) || d.items.find((x) => x.rewrite === 'To review') || d.items[0]
        if (first) setId(first.id)
      })
      .catch((e) => setError(String(e.message || e)))
  }, [])

  const pages = useMemo(() => [...new Set((items || []).map((x) => x.page))], [items])
  const list = useMemo(
    () => (items || []).filter((x) => (!page || x.page === page) && (state === 'all' || x.rewrite === state || x.id === id)),
    [items, page, state, id],
  )
  const i = list.findIndex((x) => x.id === id)
  const cp = i >= 0 ? list[i] : list[0]

  const counts = useMemo(() => {
    const c: Record<string, number> = { 'To review': 0, Approved: 0, 'Changes needed': 0 }
    for (const x of items || []) if (!page || x.page === page) c[x.rewrite] = (c[x.rewrite] || 0) + 1
    return c
  }, [items, page])

  const go = useCallback(
    (d: number) => {
      if (!list.length) return
      const n = Math.min(Math.max((i < 0 ? 0 : i) + d, 0), list.length - 1)
      setId(list[n].id)
      setAsking(false)
      window.scrollTo({ top: 0 })
    },
    [list, i],
  )

  useEffect(() => {
    if (cp) {
      setComment(cp.comment || '')
      const u = new URL(window.location.href)
      u.searchParams.set('id', cp.id)
      window.history.replaceState(null, '', u)
    }
  }, [cp?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const decide = useCallback(
    async (verdict: Verdict, note?: string) => {
      if (!cp) return
      setSave({ state: 'saving' })
      const body: Record<string, string> = { id: cp.id, rewrite: verdict }
      if (note !== undefined) body.comment = note
      try {
        const r = await fetch(api(`/lab/rewrite${key ? `?key=${encodeURIComponent(key)}` : ''}`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const out = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(out.error || String(r.status))
        setItems((xs) => (xs || []).map((x) => (x.id === cp.id ? { ...x, rewrite: verdict, comment: note ?? x.comment } : x)))
        setSave({ state: 'saved', note: `${verdict} saved in Airtable` })
        setAsking(false)
        // on to the next one still waiting, in the current filter
        const next = list.slice(i + 1).find((x) => x.rewrite === 'To review' && x.id !== cp.id)
        if (next && verdict !== 'To review') {
          setId(next.id)
          window.scrollTo({ top: 0 })
        }
      } catch (e) {
        setSave({ state: 'error', note: String((e as Error).message || e) })
      }
    },
    [cp, key, list, i],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.tagName === 'SELECT')) return
      if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
      else if (e.key.toLowerCase() === 'a') decide('Approved')
      else if (e.key.toLowerCase() === 'c') setAsking(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, decide])

  const setW = (w: Width) => {
    setWidth(w)
    try {
      localStorage.setItem('review-width', w)
    } catch {}
  }
  const setV = (v: View) => {
    setView(v)
    try {
      localStorage.setItem('review-view', v)
    } catch {}
  }

  if (error) return <Shell keyQs={key}><p className="text-[var(--result-fail-fg)]">Could not load the rewrites: {error}</p></Shell>
  if (!items) return <Shell keyQs={key}><p className="text-[var(--text-muted)]">Loading the checkpoints and a real finding for each from the lab scans…</p></Shell>

  const total = (counts['To review'] || 0) + (counts.Approved || 0) + (counts['Changes needed'] || 0)
  const done = (counts.Approved || 0) + (counts['Changes needed'] || 0)

  return (
    <Shell keyQs={key}>
      {/* progress and filters */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-[length:var(--text-2xl)] font-bold text-[var(--text)]">Checkpoint review</h1>
            <p className="text-sm text-[var(--text-muted)]">
              {done} of {total} reviewed{page ? ` on ${page}` : ''} · {counts.Approved || 0} approved · {counts['Changes needed'] || 0} need changes
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Seg value={view} set={setV} options={[['both', 'Now vs proposed'], ['proposed', 'Proposed only']]} />
            <Seg value={width} set={setW} options={[['desktop', 'Desktop'], ['phone', 'Phone']]} />
          </div>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-muted)]">
          <div className="h-full bg-[var(--result-pass-fg)] transition-all" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={page} onChange={(e) => setPage(e.target.value)} className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)]" aria-label="Page">
            <option value="">All pages</option>
            {pages.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          {(['To review', 'Changes needed', 'Approved', 'all'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setState(s)}
              aria-pressed={state === s}
              className={`rounded-full border px-3 py-1 text-[13px] font-medium ${state === s ? 'border-[var(--text)] bg-[var(--text)] text-[var(--text-inverse)]' : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text)]'}`}
            >
              {s === 'all' ? 'All' : s} {s !== 'all' && <span className="opacity-70">{counts[s] || 0}</span>}
            </button>
          ))}
          <span className="ml-auto text-[13px] text-[var(--text-muted)]">
            {list.length ? `${(i < 0 ? 0 : i) + 1} / ${list.length}` : 'Nothing here'}
          </span>
        </div>
      </div>

      {!cp ? (
        <p className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--card-padding)] text-[var(--text-muted)]">
          {state === 'To review' ? 'Everything here is reviewed. Pick another page or filter.' : 'No checkpoint matches this filter.'}
        </p>
      ) : (
        <>
          {/* context */}
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <Pill>{cp.page}</Pill>
            {cp.area && <Pill>{cp.area}</Pill>}
            <Pill>{cp.status}</Pill>
            <Pill>{cp.method}</Pill>
            <span className="rounded-full px-2.5 py-0.5 font-semibold" style={{ color: STATE_STYLE[cp.rewrite]?.fg, background: STATE_STYLE[cp.rewrite]?.bg }}>
              {cp.rewrite}
            </span>
            <code className="text-[11px] text-[var(--text-muted)]">{cp.id}</code>
          </div>
          {cp.notes && (
            <p className="rounded-[var(--radius-md)] bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text)]">
              <b>What changed:</b> {cp.notes}
            </p>
          )}

          {/* the client view */}
          <div className={`grid items-start gap-5 ${view === 'both' ? 'lg:grid-cols-2' : ''}`}>
            {view === 'both' && <ClientCard label="Now: what clients read today" item={cp} text={cp.now} width={width} />}
            <ClientCard label={view === 'both' ? 'Proposed' : 'Proposed: what clients will read'} item={cp} text={cp.proposed} width={width} compare={view === 'both' ? cp.now : undefined} />
          </div>

          {/* scanner side */}
          <details className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]" open={changed(cp.now.pass + cp.now.fail + cp.now.na + cp.now.fix, cp.proposed.pass + cp.proposed.fail + cp.proposed.na + cp.proposed.fix)}>
            <summary className="cursor-pointer px-[var(--card-padding)] py-3 text-sm font-semibold text-[var(--text)]">
              Behind the scenes: short fix and definitions the scanner judges with
            </summary>
            <div className="grid gap-x-6 gap-y-3 border-t border-[var(--border)] px-[var(--card-padding)] py-4 text-sm">
              {(
                [
                  ['Short fix', 'fix'],
                  ['Pass when', 'pass'],
                  ['Fail when', 'fail'],
                  ['Not relevant when', 'na'],
                ] as const
              ).map(([label, k]) => (
                <div key={k} className="grid gap-1 md:grid-cols-[140px_1fr_1fr] md:gap-4">
                  <span className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{label}</span>
                  {changed(cp.now[k], cp.proposed[k]) ? (
                    <>
                      <span className="text-[var(--text-muted)] line-through decoration-[var(--border-strong)]">{cp.now[k] || '(empty)'}</span>
                      <span className="text-[var(--text)]">
                        <Changed /> {cp.proposed[k] || '(empty)'}
                      </span>
                    </>
                  ) : (
                    <span className="text-[var(--text)] md:col-span-2">{cp.now[k] || '(empty)'}</span>
                  )}
                </div>
              ))}
            </div>
          </details>

          {/* verdict bar */}
          <div className="sticky bottom-0 z-10 -mx-[var(--gutter)] border-t border-[var(--border)] bg-[var(--surface)] px-[var(--gutter)] py-3">
            {asking ? (
              <div className="flex flex-col gap-2">
                <label htmlFor="cmt" className="text-sm font-semibold text-[var(--text)]">
                  What should change?
                </label>
                <textarea
                  id="cmt"
                  autoFocus
                  rows={3}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="e.g. Too long. Drop step 3. The evidence link does not fit this checkpoint."
                  className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-2 text-sm text-[var(--text)]"
                />
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="cxo-btn cxo-btn-primary" onClick={() => decide('Changes needed', comment)}>
                    Save as changes needed
                  </button>
                  <button type="button" className="cxo-btn" onClick={() => setAsking(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="cxo-btn" onClick={() => go(-1)} disabled={i <= 0} aria-label="Previous checkpoint">
                  ←
                </button>
                <button type="button" className="cxo-btn" onClick={() => go(1)} disabled={i >= list.length - 1} aria-label="Next checkpoint">
                  →
                </button>
                <button type="button" onClick={() => decide('Approved')} className="rounded-full px-5 py-2 text-sm font-semibold" style={{ background: 'var(--result-pass-fg)', color: 'var(--text-inverse)' }}>
                  Approve <kbd className="ml-1 opacity-70">A</kbd>
                </button>
                <button type="button" onClick={() => setAsking(true)} className="rounded-full px-5 py-2 text-sm font-semibold" style={{ background: 'var(--result-fail-bg)', color: 'var(--result-fail-fg)' }}>
                  Changes needed <kbd className="ml-1 opacity-70">C</kbd>
                </button>
                {cp.rewrite !== 'To review' && (
                  <button type="button" onClick={() => decide('To review')} className="text-sm text-[var(--text-muted)] underline">
                    Undo
                  </button>
                )}
                <span className={`ml-auto text-[13px] ${save.state === 'error' ? 'text-[var(--result-fail-fg)]' : 'text-[var(--text-muted)]'}`} role="status">
                  {save.state === 'saving' ? 'Saving…' : save.note || '← → to move'}
                </span>
              </div>
            )}
            {!asking && cp.comment && <p className="mt-2 text-[13px] text-[var(--text-muted)]">Your comment: {cp.comment}</p>}
          </div>
        </>
      )}
    </Shell>
  )
}

/** The checkpoint exactly as the results page shows an opened finding. */
function ClientCard({ label, item, text, width, compare }: { label: string; item: Item; text: Text; width: Width; compare?: Text }) {
  const passed = item.finding?.answer === 'pass'
  const t = passed ? 'pass' : 'fail'
  const tags = compare ? (['title', 'actions', 'why'] as const).filter((k) => changed(compare[k], text[k])) : []
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{label}</h2>
        {tags.length > 0 && (
          <span className="text-[12px] text-[var(--text-muted)]">
            <Changed /> {tags.map((k) => ({ title: 'title', actions: 'actions', why: 'justification' })[k]).join(', ')}
          </span>
        )}
      </div>
      <div className={`rounded-[var(--radius-lg)] bg-[var(--bg-subtle)] p-3 ${width === 'phone' ? 'mx-auto w-full max-w-[390px]' : ''}`}>
        <div
          className="rounded-[16px] border border-[var(--border-strong)] bg-[var(--surface)] px-4"
          style={{ ['--result-fg' as string]: `var(--result-${t}-fg)`, ['--result-bg' as string]: `var(--result-${t}-bg)` }}
        >
          <div className="flex w-full items-center gap-3 py-4 text-left">
            <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full text-xs font-bold" style={{ background: `var(--result-${t}-fg)`, color: 'var(--text-inverse)' }} aria-hidden>
              {passed ? '✓' : '1'}
            </span>
            <span className="min-w-0 flex-1 font-[family-name:var(--font-display)] text-[16px] font-bold leading-[1.35] tracking-[-0.01em] text-[var(--text)]">{text.title}</span>
          </div>
          <div className="border-t border-[var(--border)] pb-4 pt-4">
            <div className="flex flex-col gap-4 rounded-[12px] bg-[var(--result-bg)] p-5">
              <div className="flex flex-col gap-1.5">
                <p className="font-[family-name:var(--font-display)] text-[17px] font-bold text-[var(--result-fg)]">What we saw:</p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text)]">
                  {item.finding ? item.finding.reason : <span className="text-[var(--text-muted)]">No lab scan has judged this checkpoint yet. The scanner&apos;s finding for the store appears here.</span>}
                </p>
                {item.finding && <p className="text-[11px] text-[var(--text-muted)]">Real finding from the lab scan of {item.finding.host}</p>}
              </div>
              <CheckpointResultBody checkpoint={{ requiredActions: text.actions, justificationsBenefits: text.why, examples: item.examples }} passed={passed} />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function Shell({ children, keyQs }: { children: React.ReactNode; keyQs: string }) {
  return (
    <main className="min-h-dvh bg-[var(--bg)]">
      <div className="mx-auto flex max-w-[var(--container)] flex-col gap-5 px-[var(--gutter)] py-6">
        <Link href={`/lab${keyQs ? `?key=${encodeURIComponent(keyQs)}` : ''}`} className="text-sm text-[var(--text-muted)] underline">
          ← Lab
        </Link>
        {children}
      </div>
    </main>
  )
}

function Seg<T extends string>({ value, set, options }: { value: T; set: (v: T) => void; options: [T, string][] }) {
  return (
    <div role="group" className="inline-flex gap-0.5 rounded-full bg-[var(--surface-muted)] p-[3px]">
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          onClick={() => set(v)}
          aria-pressed={value === v}
          className={`rounded-full px-3.5 py-1.5 text-[13px] font-semibold ${value === v ? 'bg-[var(--surface)] text-[var(--text)] shadow-[0_1px_2px_rgba(9,9,11,.12)]' : 'text-[var(--text-muted)]'}`}
        >
          {l}
        </button>
      ))}
    </div>
  )
}

const Pill = ({ children }: { children: React.ReactNode }) => <span className="rounded-full bg-[var(--surface-muted)] px-2.5 py-0.5 text-[var(--text)]">{children}</span>
const Changed = () => (
  <span className="rounded-full px-1.5 py-px text-[11px] font-semibold" style={{ color: 'var(--result-pass-fg)', background: 'var(--result-pass-bg)' }}>
    changed
  </span>
)
