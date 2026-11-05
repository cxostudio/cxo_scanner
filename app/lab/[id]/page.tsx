'use client'

// Test lab, one scan: label each checkpoint blind (the scanner's answer is not loaded),
// then compare. Keys: P pass, F fail, N not relevant, S can't tell, ← → move.
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/base'

type Label = 'pass' | 'fail' | 'na' | 'skip'
type Checkpoint = { id: string; title: string; status?: string; device?: string; pass?: string; fail?: string; na?: string; nicheNotes?: string; pageTypeIds?: string[] }
type Answer = { id: string; answer: string; reason: string; coveredByShopify?: boolean }
type Scan = {
  id: string
  url: string
  niche: string
  cartKind?: string
  shopify: boolean
  checkpoints: Checkpoint[]
  answers?: Answer[]
  images: { label: string; url: string }[]
  labels: Record<string, Label>
}
type Tab = 'desktop' | 'mobile' | 'cart'

const CART_PAGE_TYPE = 'recDYiScpsBfRbbha'
const BUTTONS: { label: Label; word: string; key: string; fg: string; bg: string }[] = [
  { label: 'pass', word: 'Pass', key: 'P', fg: 'var(--result-pass-fg)', bg: 'var(--result-pass-bg)' },
  { label: 'fail', word: 'Fail', key: 'F', fg: 'var(--result-fail-fg)', bg: 'var(--result-fail-bg)' },
  { label: 'na', word: 'Not relevant', key: 'N', fg: 'var(--text)', bg: 'var(--surface-muted)' },
  { label: 'skip', word: "Can't tell", key: 'S', fg: 'var(--text-muted)', bg: 'var(--surface-muted)' },
]
const WORD: Record<string, string> = { pass: 'Pass', fail: 'Fail', na: 'Not relevant', skip: "Can't tell", unknown: "Couldn't check" }
const tabOf = (label: string): Tab => (/cart (view|page)|CART PAGE|cart drawer|header AFTER/i.test(label) ? 'cart' : /^mobile/i.test(label) ? 'mobile' : 'desktop')

export default function LabScan({ params }: { params: { id: string } }) {
  const [key, setKey] = useState('')
  const [scan, setScan] = useState<Scan | null>(null)
  const [error, setError] = useState('')
  const [labels, setLabels] = useState<Record<string, Label>>({})
  const [i, setI] = useState(0)
  const [tab, setTab] = useState<Tab>('desktop')
  const [compare, setCompare] = useState(false)
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const saveTimer = useRef<number>(0)

  const load = useCallback(
    (reveal: boolean, k: string, keepLabels = false) => {
      const qs = new URLSearchParams()
      if (k) qs.set('key', k)
      if (reveal) qs.set('reveal', '1')
      return fetch(api(`/lab/scans/${params.id}?${qs}`))
        .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({})))?.error || String(r.status)))))
        .then((s: Scan) => {
          setScan(s)
          // keep what was just labelled: the debounced save may not have landed yet
          if (!keepLabels) setLabels(s.labels || {})
          return s
        })
        .catch((e) => setError(String(e.message || e)))
    },
    [params.id],
  )

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const k = q.get('key') || ''
    const c = q.get('compare') === '1'
    setKey(k)
    setCompare(c)
    load(c, k).then((s) => {
      if (!s) return
      // continue where labelling stopped
      const first = s.checkpoints.findIndex((cp) => !s.labels?.[cp.id])
      setI(first < 0 ? 0 : first)
    })
  }, [load])

  const cp = scan?.checkpoints[i]

  // open the screenshots the checkpoint is about
  useEffect(() => {
    if (!cp) return
    if (cp.pageTypeIds?.includes(CART_PAGE_TYPE)) setTab('cart')
    else if (cp.device === 'Mobile only') setTab('mobile')
    else if (cp.device === 'Desktop only') setTab('desktop')
  }, [cp])

  const persist = useCallback(
    (next: Record<string, Label>) => {
      window.clearTimeout(saveTimer.current)
      setSaved('saving')
      saveTimer.current = window.setTimeout(() => {
        fetch(api(`/lab/labels/${params.id}${key ? `?key=${encodeURIComponent(key)}` : ''}`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(next),
        })
          .then((r) => setSaved(r.ok ? 'saved' : 'error'))
          .catch(() => setSaved('error'))
      }, 500)
    },
    [params.id, key],
  )

  const setLabel = useCallback(
    (label: Label) => {
      if (!cp || !scan) return
      const next = { ...labels, [cp.id]: label }
      setLabels(next)
      persist(next)
      setI((n) => Math.min(n + 1, scan.checkpoints.length - 1))
    },
    [cp, scan, labels, persist],
  )

  useEffect(() => {
    if (compare) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement)?.tagName === 'INPUT') return
      const k = e.key.toLowerCase()
      const b = BUTTONS.find((x) => x.key.toLowerCase() === k)
      if (b) setLabel(b.label)
      else if (e.key === 'ArrowRight') setI((n) => Math.min(n + 1, (scan?.checkpoints.length || 1) - 1))
      else if (e.key === 'ArrowLeft') setI((n) => Math.max(n - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [compare, setLabel, scan])

  const images = useMemo(() => (scan?.images || []).filter((img) => tabOf(img.label) === tab), [scan, tab])
  const done = scan ? scan.checkpoints.filter((c) => labels[c.id]).length : 0
  const q = key ? `?key=${encodeURIComponent(key)}` : ''

  const openCompare = () => {
    load(true, key, true).then(() => setCompare(true))
  }

  if (error) return <Shell><p className="text-sm text-[var(--result-fail-fg)]">Could not load this scan: {error}</p></Shell>
  if (!scan || !cp) return <Shell><p className="text-sm text-[var(--text-muted)]">Loading…</p></Shell>

  const host = (() => {
    try {
      return new URL(scan.url).hostname.replace(/^www\./, '')
    } catch {
      return scan.url
    }
  })()

  return (
    <Shell>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Link href={`/lab${q}`} className="text-sm text-[var(--text-muted)] hover:underline">← Lab</Link>
        <h1 className="min-w-0 flex-1 truncate font-[family-name:var(--font-display)] text-2xl font-bold tracking-[-0.02em]">
          <a href={scan.url} target="_blank" rel="noreferrer" className="hover:underline">{host}</a>
        </h1>
        <span className="text-sm text-[var(--text-muted)]">
          {scan.niche}
          {scan.shopify ? ' · Shopify' : ''}
          {scan.cartKind ? ` · cart: ${scan.cartKind}` : ''}
        </span>
        <span className="text-sm font-semibold">{done}/{scan.checkpoints.length} labelled</span>
        <span className="w-16 text-xs text-[var(--text-muted)]">{saved === 'saving' ? 'Saving…' : saved === 'saved' ? 'Saved' : saved === 'error' ? 'Not saved' : ''}</span>
        {compare ? (
          <button type="button" className="cxo-btn cxo-btn-ghost" onClick={() => setCompare(false)}>Back to labelling</button>
        ) : (
          <button type="button" className="cxo-btn cxo-btn-primary" onClick={openCompare}>
            {done < scan.checkpoints.length ? `Compare (${scan.checkpoints.length - done} left)` : 'Compare with scanner'}
          </button>
        )}
      </header>

      {compare ? (
        <Compare scan={scan} labels={labels} />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
          {/* the checkpoint, with CXO Studio's definitions */}
          <section className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--card-padding)] lg:sticky lg:top-6">
            <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
              <span>
                {i + 1} / {scan.checkpoints.length}
              </span>
              <span className="flex gap-1.5">
                {cp.status && <Chip>{cp.status}</Chip>}
                {cp.device && <Chip>{cp.device}</Chip>}
              </span>
            </div>
            <h2 className="font-[family-name:var(--font-display)] text-lg font-bold leading-snug">{cp.title}</h2>
            <dl className="flex flex-col gap-3 text-sm leading-relaxed">
              {cp.pass && <Def term="Pass when">{cp.pass}</Def>}
              {cp.fail && <Def term="Fail when">{cp.fail}</Def>}
              {cp.na && <Def term="Not relevant when">{cp.na}</Def>}
              {cp.nicheNotes && <Def term="Niche notes">{cp.nicheNotes}</Def>}
              {!cp.pass && <p className="text-[var(--text-muted)]">No definition in Airtable yet.</p>}
            </dl>
            <div className="grid grid-cols-2 gap-2">
              {BUTTONS.map((b) => {
                const on = labels[cp.id] === b.label
                return (
                  <button
                    key={b.label}
                    type="button"
                    onClick={() => setLabel(b.label)}
                    className="flex items-center justify-between rounded-[var(--radius-md)] border px-3 py-2.5 text-sm font-semibold transition-colors"
                    style={{ borderColor: on ? b.fg : 'var(--border)', background: on ? b.bg : 'var(--surface)', color: on ? b.fg : 'var(--text)' }}
                  >
                    {b.word}
                    <kbd className="rounded-[var(--radius-sm)] border border-[var(--border)] px-1.5 text-[11px] text-[var(--text-muted)]">{b.key}</kbd>
                  </button>
                )
              })}
            </div>
            <div className="flex justify-between text-sm">
              <button type="button" disabled={i === 0} onClick={() => setI(i - 1)} className="text-[var(--text-muted)] hover:underline disabled:opacity-40">← Previous</button>
              <button
                type="button"
                onClick={() => {
                  const next = scan.checkpoints.findIndex((c, n) => n > i && !labels[c.id])
                  if (next >= 0) setI(next)
                }}
                className="text-[var(--text-muted)] hover:underline"
              >
                Next unlabelled →
              </button>
            </div>
          </section>

          {/* what the scanner saw */}
          <section className="flex min-w-0 flex-col gap-3">
            <div role="group" aria-label="Screenshots" className="inline-flex w-fit gap-0.5 rounded-[var(--radius-pill)] bg-[var(--surface-muted)] p-[3px]">
              {(['desktop', 'mobile', 'cart'] as Tab[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  aria-pressed={tab === t}
                  className={`rounded-[var(--radius-pill)] px-4 py-1.5 text-[13px] font-semibold ${tab === t ? 'bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-xs)]' : 'text-[var(--text-muted)]'}`}
                >
                  {t === 'desktop' ? 'Desktop' : t === 'mobile' ? 'Mobile' : 'Cart'}
                </button>
              ))}
            </div>
            {images.length === 0 && <p className="text-sm text-[var(--text-muted)]">No {tab} screenshots for this scan.</p>}
            <div className="flex flex-col gap-3">
              {images.map((img) => (
                <figure key={img.url} className={`overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] ${/^mobile/i.test(img.label) ? 'max-w-[420px]' : ''}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt={img.label} className="block h-auto w-full" loading="lazy" />
                  <figcaption className="border-t border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)]">{img.label}</figcaption>
                </figure>
              ))}
            </div>
          </section>
        </div>
      )}
    </Shell>
  )
}

/** Your label next to the scanner's answer and reasoning: disagreements first. */
function Compare({ scan, labels }: { scan: Scan; labels: Record<string, Label> }) {
  const answers = new Map((scan.answers || []).map((a) => [a.id, a]))
  const rows = scan.checkpoints.map((cp) => {
    const a = answers.get(cp.id)
    const you = labels[cp.id]
    const ai = a?.answer || 'unknown'
    const state = !you || you === 'skip' ? 'open' : ai === you ? 'agree' : 'disagree'
    return { cp, a, you, ai, state }
  })
  const order = { disagree: 0, open: 1, agree: 2 } as const
  rows.sort((x, y) => order[x.state as keyof typeof order] - order[y.state as keyof typeof order])
  const judged = rows.filter((r) => r.state !== 'open')
  const agree = judged.filter((r) => r.state === 'agree').length

  useEffect(() => {
    const id = window.location.hash.slice(1)
    if (id) document.getElementById(id)?.scrollIntoView({ block: 'center' })
  }, [])

  return (
    <section className="flex flex-col gap-3">
      <p className="text-sm text-[var(--text-muted)]">
        Agreement on this store: <span className="font-semibold text-[var(--text)]">{judged.length ? Math.round((agree / judged.length) * 100) : 0}%</span> ({agree}/{judged.length}), {rows.length - judged.length} not labelled or can't tell.
      </p>
      <div className="flex flex-col divide-y divide-[var(--border)] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
        {rows.map(({ cp, a, you, ai, state }) => (
          <div key={cp.id} id={cp.id} className="flex flex-col gap-1.5 px-4 py-3" style={state === 'disagree' ? { background: 'var(--result-fail-bg)' } : undefined}>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="min-w-0 flex-1 text-sm font-semibold">{cp.title}</span>
              <span className="text-xs text-[var(--text-muted)]">{cp.status}</span>
              <span className="text-sm">
                you: <b>{you ? WORD[you] : '·'}</b> · scanner: <b>{WORD[ai] || ai}</b>
                {a?.coveredByShopify ? ' (Shopify default)' : ''}
              </span>
            </div>
            {a?.reason && <p className="text-sm leading-relaxed text-[var(--text-muted)]">{a.reason}</p>}
          </div>
        ))}
      </div>
    </section>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[var(--bg)] px-[var(--gutter)] py-8 font-[family-name:var(--font-body)] text-[var(--text)]">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-6">{children}</div>
    </main>
  )
}

function Def({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">{term}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap">{children}</dd>
    </div>
  )
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-[var(--radius-pill)] bg-[var(--surface-muted)] px-2 py-0.5 font-semibold text-[var(--text-muted)]">{children}</span>
}
