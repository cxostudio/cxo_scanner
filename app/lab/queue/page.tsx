'use client'

// Test lab: pick one checkpoint and label it across every store that has it, one store after another.
// Opens the normal labelling page on that checkpoint; after each label it moves to the next store.
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/base'

type Row = { id: string; title: string; status?: string; area?: string; method?: string; stores: number; labelled: number; min?: number }

export default function LabelQueue() {
  const [key, setKey] = useState('')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [min, setMin] = useState(5)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'need' | 'all'>('need')
  const [q, setQ] = useState('')
  const [going, setGoing] = useState('')

  useEffect(() => {
    const k = new URLSearchParams(window.location.search).get('key') || ''
    setKey(k)
    fetch(api(`/lab/queue${k ? `?key=${encodeURIComponent(k)}` : ''}`))
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({})))?.error || String(r.status)))))
      .then((d: { min: number; checkpoints: Row[] }) => {
        setRows(d.checkpoints)
        setMin(d.min)
      })
      .catch((e) => setError(String(e.message || e)))
  }, [])

  const shown = useMemo(
    () => (rows || []).filter((r) => (filter === 'all' || r.labelled < (r.min ?? min)) && (!q || r.title.toLowerCase().includes(q.toLowerCase()))),
    [rows, filter, min, q],
  )

  const start = async (r: Row) => {
    setGoing(r.id)
    const qs = new URLSearchParams({ cp: r.id })
    if (key) qs.set('key', key)
    const d = await fetch(api(`/lab/queue?${qs}`)).then((x) => x.json()).catch(() => null)
    const next = d?.scans?.find((s: { label: string | null }) => !s.label) || d?.scans?.[0]
    if (!next) return setGoing('')
    window.location.href = `/scan/lab/${next.id}?cp=${r.id}&queue=1${key ? `&key=${encodeURIComponent(key)}` : ''}`
  }

  return (
    <main className="min-h-dvh bg-[var(--bg)]">
      <div className="mx-auto flex max-w-[var(--container)] flex-col gap-5 px-[var(--gutter)] py-6">
        <Link href={`/lab${key ? `?key=${encodeURIComponent(key)}` : ''}`} className="text-sm text-[var(--text-muted)] underline">
          ← Lab
        </Link>
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-[length:var(--text-2xl)] font-bold text-[var(--text)]">Label by checkpoint</h1>
          <p className="text-sm text-[var(--text-muted)]">
            One checkpoint, store after store. A checkpoint needs {min} labelled stores before it can go Live.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(['need', 'all'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={`rounded-full border px-3 py-1 text-[13px] font-medium ${filter === f ? 'border-[var(--text)] bg-[var(--text)] text-[var(--text-inverse)]' : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text)]'}`}
            >
              {f === 'need' ? `Need labels (under ${min})` : 'All'}
            </button>
          ))}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search a checkpoint"
            aria-label="Search a checkpoint"
            className="min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)]"
          />
        </div>
        {error && <p className="text-[var(--result-fail-fg)]">Could not load: {error}</p>}
        {!rows && !error && <p className="text-[var(--text-muted)]">Loading every lab scan…</p>}
        <ul className="flex flex-col gap-2">
          {shown.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[var(--text)]">{r.title}</p>
                <p className="text-[12px] text-[var(--text-muted)]">
                  {[r.status, r.area, r.method].filter(Boolean).join(' · ')}
                </p>
              </div>
              <span className="text-[13px] text-[var(--text-muted)]">
                <b className="text-[var(--text)]">{r.labelled}</b>/{r.min ?? min} needed · {r.stores} stores
              </span>
              <Link href={`/lab/grid?cp=${r.id}${key ? `&key=${encodeURIComponent(key)}` : ''}`} className="cxo-btn cxo-btn-primary !px-4 !py-1.5 text-sm">
                Grid
              </Link>
              <button type="button" className="cxo-btn cxo-btn-ghost !px-4 !py-1.5 text-sm" onClick={() => start(r)} disabled={going === r.id || r.labelled >= r.stores}>
                {r.labelled >= r.stores ? 'Done' : going === r.id ? 'Opening…' : 'One by one'}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </main>
  )
}
