'use client'

// Test lab, grid labelling: one checkpoint, many stores side by side. Each card shows the screenshots
// that matter for this checkpoint, the scanner's answer, one-click labels, and a suggestion from a
// second model that only appears once you ask for it (look first, then compare).
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/base'

type Label = 'pass' | 'fail' | 'na' | 'skip'
type Suggestion = { label: Label; why: string; model: string }
type Store = {
  id: string
  url: string
  label: Label | null
  answer: { answer: string; reason: string; by?: string; coveredByShopify?: boolean } | null
  images: { label: string; url: string }[]
  suggestion: Suggestion | null
}
type Data = {
  checkpoint: { id: string; title: string; pass?: string; fail?: string; na?: string; method?: string; area?: string; device?: string; status?: string }
  min: number
  labelled: number
  total: number
  stores: Store[]
}

const LABELS: { v: Label; text: string }[] = [
  { v: 'pass', text: 'Pass' },
  { v: 'fail', text: 'Fail' },
  { v: 'na', text: 'Not relevant' },
  { v: 'skip', text: 'Can’t tell' },
]
const TONE: Record<string, { bg: string; fg: string }> = {
  pass: { bg: 'var(--result-pass-bg)', fg: 'var(--result-pass-fg)' },
  fail: { bg: 'var(--result-fail-bg)', fg: 'var(--result-fail-fg)' },
  na: { bg: 'var(--surface-muted)', fg: 'var(--text-muted)' },
  skip: { bg: 'var(--surface-muted)', fg: 'var(--text-muted)' },
  unknown: { bg: 'var(--surface-muted)', fg: 'var(--text-muted)' },
}
const WORD: Record<string, string> = { pass: 'Pass', fail: 'Fail', na: 'Not relevant', skip: 'Can’t tell', unknown: 'Couldn’t check' }
const host = (u: string) => {
  try {
    return new URL(/^https?:\/\//.test(u) ? u : `https://${u}`).host.replace(/^www\./, '')
  } catch {
    return u
  }
}

export default function GridLabelling() {
  const [key, setKey] = useState('')
  const [cp, setCp] = useState('')
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [asking, setAsking] = useState<Record<string, boolean>>({})
  const [showDef, setShowDef] = useState(true)

  const qs = useCallback((extra: Record<string, string> = {}) => {
    const q = new URLSearchParams(extra)
    if (key) q.set('key', key)
    return q.toString()
  }, [key])

  const load = useCallback(
    (c: string, k: string) => {
      const q = new URLSearchParams({ cp: c, limit: '12' })
      if (k) q.set('key', k)
      setData(null)
      fetch(api(`/lab/grid?${q}`))
        .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({})))?.error || String(r.status)))))
        .then(setData)
        .catch((e) => setError(String(e.message || e)))
    },
    [],
  )

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const k = q.get('key') || ''
    const c = q.get('cp') || ''
    setKey(k)
    setCp(c)
    if (c) load(c, k)
  }, [load])

  const setLabel = async (store: Store, label: Label) => {
    const next = store.label === label ? null : label
    setSaving((s) => ({ ...s, [store.id]: true }))
    setData((d) => (d ? { ...d, labelled: d.labelled + (next && next !== 'skip' ? (store.label && store.label !== 'skip' ? 0 : 1) : store.label && store.label !== 'skip' ? -1 : 0), stores: d.stores.map((s) => (s.id === store.id ? { ...s, label: next } : s)) } : d))
    await fetch(api(`/lab/grid?${qs()}`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scan: store.id, cp, label: next }) }).catch(() => {})
    setSaving((s) => ({ ...s, [store.id]: false }))
  }

  const suggest = async (store: Store) => {
    setAsking((a) => ({ ...a, [store.id]: true }))
    const r = await fetch(api(`/lab/grid/suggest?${qs()}`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cp, scan: store.id }) })
      .then((x) => x.json())
      .catch(() => null)
    setAsking((a) => ({ ...a, [store.id]: false }))
    if (r?.label) setData((d) => (d ? { ...d, stores: d.stores.map((s) => (s.id === store.id ? { ...s, suggestion: r } : s)) } : d))
  }

  const measured = data?.checkpoint.method === 'Measured'
  const left = data ? Math.max(0, data.min - data.labelled) : 0

  return (
    <main className="min-h-dvh bg-[var(--bg)]">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-5 px-[var(--gutter)] py-6">
        <Link href={`/lab/queue${key ? `?key=${encodeURIComponent(key)}` : ''}`} className="text-sm text-[var(--text-muted)] underline">
          ← Label by checkpoint
        </Link>
        {error && <p className="text-[var(--result-fail-fg)]">Could not load: {error}</p>}
        {!data && !error && <p className="text-[var(--text-muted)]">Loading the stores for this checkpoint…</p>}
        {data && (
          <>
            <header className="flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h1 className="font-[family-name:var(--font-display)] text-[length:var(--text-2xl)] font-bold leading-tight text-[var(--text)]">{data.checkpoint.title}</h1>
                <p className="text-sm text-[var(--text-muted)]">
                  <b className="text-[var(--text)]">{data.labelled}</b> labelled of {data.total} stores ·{' '}
                  {left > 0 ? `${left} more to reach ${data.min}` : `enough labels (${data.min}+)`}
                  {measured && ' · measured by code'}
                </p>
              </div>
              <button type="button" onClick={() => setShowDef((v) => !v)} className="self-start text-[13px] font-semibold text-[var(--text-muted)] underline">
                {showDef ? 'Hide' : 'Show'} the definition
              </button>
              {showDef && (
                <dl className="grid gap-2 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 text-sm leading-relaxed sm:grid-cols-3">
                  {[
                    ['Pass when', data.checkpoint.pass],
                    ['Fail when', data.checkpoint.fail],
                    ['Not relevant when', data.checkpoint.na],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="font-semibold text-[var(--text)]">{k}</dt>
                      <dd className="text-[var(--text-muted)]">{v || '–'}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </header>

            <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 xl:grid-cols-3">
              {data.stores.map((s) => {
                const ai = s.answer?.coveredByShopify ? 'pass' : s.answer?.answer || 'unknown'
                return (
                  <article key={s.id} className="flex min-w-0 flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
                    <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-2.5">
                      <a href={s.url} target="_blank" rel="noreferrer" className="truncate text-sm font-semibold text-[var(--text)] underline-offset-2 hover:underline">
                        {host(s.url)}
                      </a>
                      <Link href={`/lab/${s.id}?cp=${cp}${key ? `&key=${encodeURIComponent(key)}` : ''}`} className="shrink-0 text-[12px] text-[var(--text-muted)] underline">
                        Full scan
                      </Link>
                    </div>

                    <div className="h-[380px] overflow-y-auto bg-[var(--bg-subtle)]">
                      {s.images.length === 0 && <p className="p-4 text-sm text-[var(--text-muted)]">No screenshot for this part of the page.</p>}
                      {s.images.map((img) => (
                        <figure key={img.url} className="border-b border-[var(--border)] last:border-b-0">
                          <figcaption className="px-3 py-1.5 text-[11px] text-[var(--text-muted)]">{img.label}</figcaption>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={img.url} alt={img.label} loading="lazy" className="block w-full" />
                        </figure>
                      ))}
                    </div>

                    <div className="flex flex-col gap-3 p-4">
                      <div className="text-[13px] leading-relaxed">
                        <span className="mr-2 rounded-full px-2 py-0.5 text-[12px] font-semibold" style={{ background: TONE[ai]?.bg, color: TONE[ai]?.fg }}>
                          Scanner: {WORD[ai] || ai}
                        </span>
                        <span className="text-[var(--text-muted)]">{s.answer?.coveredByShopify ? 'Handled by Shopify.' : s.answer?.reason}</span>
                      </div>

                      <div className="flex flex-wrap gap-2" role="group" aria-label="Your label">
                        {LABELS.map((l) => {
                          const on = s.label === l.v
                          return (
                            <button
                              key={l.v}
                              type="button"
                              disabled={saving[s.id]}
                              onClick={() => setLabel(s, l.v)}
                              aria-pressed={on}
                              className="rounded-full border px-3 py-1.5 text-[13px] font-semibold transition-colors"
                              style={on ? { background: TONE[l.v].fg, borderColor: TONE[l.v].fg, color: 'var(--text-inverse)' } : { borderColor: 'var(--border)', color: 'var(--text)' }}
                            >
                              {l.text}
                            </button>
                          )
                        })}
                      </div>

                      {!measured && (
                        <div className="border-t border-[var(--border)] pt-3 text-[13px]">
                          {s.suggestion ? (
                            <p className="leading-relaxed text-[var(--text-muted)]">
                              <span className="mr-2 rounded-full px-2 py-0.5 text-[12px] font-semibold" style={{ background: TONE[s.suggestion.label]?.bg, color: TONE[s.suggestion.label]?.fg }}>
                                Suggestion: {WORD[s.suggestion.label]}
                              </span>
                              {s.suggestion.why}
                            </p>
                          ) : (
                            <button type="button" onClick={() => suggest(s)} disabled={asking[s.id]} className="font-semibold text-[var(--text-muted)] underline">
                              {asking[s.id] ? 'Looking…' : 'Show a suggestion'}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
            <button type="button" onClick={() => load(cp, key)} className="cxo-btn cxo-btn-ghost self-center">
              Next stores
            </button>
          </>
        )}
      </div>
    </main>
  )
}
