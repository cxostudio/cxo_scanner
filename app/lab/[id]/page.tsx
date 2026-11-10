'use client'

// Test lab, one scan. Review mode (default): the scanner's answer and reason are on screen, A agrees,
// D disagrees and opens the choice. About 1 checkpoint in 5 stays blind (a "blind check"), so the lab
// can tell whether seeing the answer pulls labels toward it. Blind mode hides every answer.
// Keys: A agree, D disagree, P pass, F fail, N not relevant, S can't tell, ← → move.
// The queue comes in page order and leaves out what the scanner settles without judgement:
// "Measured" checkpoints (code) and checkpoints outside the store's niche (rule).
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ExampleCrop } from './ExampleCrop'
import { api } from '@/lib/base'

type Label = 'pass' | 'fail' | 'na' | 'skip'
type Checkpoint = { id: string; title: string; blindCheck?: boolean; status?: string; device?: string; pass?: string; fail?: string; na?: string; nicheNotes?: string; pageTypeIds?: string[]; area?: string; method?: string; skip?: 'measured' | 'niche' }
type Answer = { id: string; answer: string; reason: string; coveredByShopify?: boolean; rule?: string; seen?: string[]; by?: string }
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
  notes?: Record<string, string>
  modes?: Record<string, LabelMode>
  /** text inside closed tabs / accordions, as the scanner read it */
  hiddenText?: string
  /** left out of the queue: answered by code / not for this niche */
  leftOut?: { measured: number; niche: number }
}
type LabelMode = 'blind' | 'review'
type Tab = 'desktop' | 'mobile' | 'gallery' | 'menu' | 'cart' | 'checkout' | 'text'
const TABS: { tab: Tab; word: string }[] = [
  { tab: 'desktop', word: 'Desktop' },
  { tab: 'mobile', word: 'Mobile' },
  { tab: 'gallery', word: 'Gallery' },
  { tab: 'menu', word: 'Menu' },
  { tab: 'cart', word: 'Cart' },
  { tab: 'checkout', word: 'Checkout' },
  { tab: 'text', word: 'Hidden text' },
]

const CART_PAGE_TYPE = 'recDYiScpsBfRbbha'
const CHECKOUT_PAGE_TYPE = 'recOkHTZH3nxsQNMb'
const BUTTONS: { label: Label; word: string; key: string; fg: string; bg: string }[] = [
  { label: 'pass', word: 'Pass', key: 'P', fg: 'var(--result-pass-fg)', bg: 'var(--result-pass-bg)' },
  { label: 'fail', word: 'Fail', key: 'F', fg: 'var(--result-fail-fg)', bg: 'var(--result-fail-bg)' },
  { label: 'na', word: 'Not relevant', key: 'N', fg: 'var(--text)', bg: 'var(--surface-muted)' },
  { label: 'skip', word: "Can't tell", key: 'S', fg: 'var(--text-muted)', bg: 'var(--surface-muted)' },
]
const WORD: Record<string, string> = { pass: 'Pass', fail: 'Fail', na: 'Not relevant', skip: "Can't tell", unknown: "Couldn't check" }
const tabOf = (label: string): Tab =>
  /CHECKOUT/.test(label) ? 'checkout' : /^gallery overview/.test(label) ? 'gallery' : /MENU opened/.test(label) ? 'menu' : /cart (view|page)|CART PAGE|cart drawer|header AFTER|EMPTY cart/i.test(label) ? 'cart' : /^mobile/i.test(label) ? 'mobile' : 'desktop'
/** Cart tab: the empty cart first, then the cart with one item, the cart page, the header last. */
const cartRank = (label: string) => (/EMPTY cart/.test(label) ? 0 : /cart view/i.test(label) ? 1 : /CART PAGE/.test(label) ? 2 : 3)

export default function LabScan({ params }: { params: { id: string } }) {
  const [key, setKey] = useState('')
  const [scan, setScan] = useState<Scan | null>(null)
  const [error, setError] = useState('')
  const [labels, setLabels] = useState<Record<string, Label>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [i, setI] = useState(0)
  const [tab, setTab] = useState<Tab>('desktop')
  const [compare, setCompare] = useState(false)
  const [mode, setMode] = useState<LabelMode>('review')
  const [modes, setModes] = useState<Record<string, LabelMode>>({})
  const [disagree, setDisagree] = useState(false)
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const saveTimer = useRef<number>(0)

  const load = useCallback(
    (reveal: boolean, k: string, keepLabels = false) => {
      const qs = new URLSearchParams()
      if (k) qs.set('key', k)
      if (reveal) qs.set('reveal', '1')
      return fetch(api(`/lab/scans/${params.id}?${qs}`))
        .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({})))?.error || String(r.status)))))
        .then((raw: Scan) => {
          const s: Scan = {
            ...raw,
            // ?only=checkout (or cart): label one part of the funnel without the rest of the page
            checkpoints: raw.checkpoints.filter((c) => {
              if (c.skip) return false
              const only = new URLSearchParams(window.location.search).get('only')
              if (only === 'checkout') return Boolean(c.pageTypeIds?.includes(CHECKOUT_PAGE_TYPE))
              if (only === 'cart') return Boolean(c.pageTypeIds?.includes(CART_PAGE_TYPE) || c.area === 'Cart drawer')
              return true
            }),
            leftOut: { measured: raw.checkpoints.filter((c) => c.skip === 'measured').length, niche: raw.checkpoints.filter((c) => c.skip === 'niche').length },
          }
          setScan(s)
          // keep what was just labelled: the debounced save may not have landed yet
          if (!keepLabels) {
            setLabels(s.labels || {})
            setNotes(s.notes || {})
            setModes(s.modes || {})
          }
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
    let m: LabelMode = q.get('mode') === 'blind' ? 'blind' : 'review'
    if (!q.get('mode')) {
      try {
        if (localStorage.getItem('lab-mode') === 'blind') m = 'blind'
      } catch {}
    }
    setKey(k)
    setCompare(c)
    setMode(m)
    load(c || m === 'review', k).then((s) => {
      if (!s) return
      // continue where labelling stopped
      const first = s.checkpoints.findIndex((cp) => !s.labels?.[cp.id])
      setI(first < 0 ? 0 : first)
    })
  }, [load])

  const cp = scan?.checkpoints[i]
  const answerOf = useMemo(() => new Map((scan?.answers || []).map((a) => [a.id, a])), [scan])
  const ai = cp ? answerOf.get(cp.id) : undefined
  // the scanner's answer is on screen for this checkpoint
  const shown = mode === 'review' && !!cp && !cp.blindCheck && !!ai && ai.answer !== 'unknown'
  useEffect(() => setDisagree(false), [cp?.id])

  // open the screenshots the checkpoint is about
  useEffect(() => {
    if (!cp) return
    if (cp.pageTypeIds?.includes(CHECKOUT_PAGE_TYPE)) setTab('checkout')
    else if (cp.pageTypeIds?.includes(CART_PAGE_TYPE) || cp.area === 'Cart drawer') setTab('cart')
    else if (cp.area === 'Gallery' && scan?.images.some((i) => tabOf(i.label) === 'gallery')) setTab('gallery')
    else if (/menu|navigation/i.test(cp.title) && /mobile/i.test(`${cp.title} ${cp.device}`)) setTab('menu')
    else if (cp.device === 'Mobile only') setTab('mobile')
    else if (cp.device === 'Desktop only') setTab('desktop')
  }, [cp])

  const persist = useCallback(
    (next: Record<string, Label>, nextNotes: Record<string, string>, nextModes: Record<string, LabelMode>) => {
      window.clearTimeout(saveTimer.current)
      setSaved('saving')
      saveTimer.current = window.setTimeout(() => {
        fetch(api(`/lab/labels/${params.id}${key ? `?key=${encodeURIComponent(key)}` : ''}`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ labels: next, notes: nextNotes, modes: nextModes }),
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
      const nextModes = { ...modes, [cp.id]: shown ? ('review' as const) : ('blind' as const) }
      setLabels(next)
      setModes(nextModes)
      persist(next, notes, nextModes)
      setDisagree(false)
      setI((n) => Math.min(n + 1, scan.checkpoints.length - 1))
    },
    [cp, scan, labels, notes, modes, shown, persist],
  )

  const setNote = (text: string) => {
    if (!cp) return
    const next = { ...notes, [cp.id]: text }
    setNotes(next)
    persist(labels, next, modes)
  }

  useEffect(() => {
    if (compare) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return
      const k = e.key.toLowerCase()
      const b = BUTTONS.find((x) => x.key.toLowerCase() === k)
      if (k === 'a' && shown && ai) setLabel(ai.answer as Label)
      else if (k === 'd' && shown) setDisagree(true)
      else if (b) setLabel(b.label)
      else if (e.key === 'ArrowRight') setI((n) => Math.min(n + 1, (scan?.checkpoints.length || 1) - 1))
      else if (e.key === 'ArrowLeft') setI((n) => Math.max(n - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [compare, setLabel, scan, shown, ai])

  const images = useMemo(() => {
    const list = (scan?.images || []).filter((img) => tabOf(img.label) === tab)
    return tab === 'cart' ? [...list].sort((a, b) => cartRank(a.label) - cartRank(b.label)) : list
  }, [scan, tab])
  const done = scan ? scan.checkpoints.filter((c) => labels[c.id]).length : 0
  const q = key ? `?key=${encodeURIComponent(key)}` : ''

  const switchMode = (m: LabelMode) => {
    try {
      localStorage.setItem('lab-mode', m)
    } catch {}
    setMode(m)
    if (m === 'review' && !scan?.answers) load(true, key, true)
  }

  // screenshot links are signed for a few hours: when one stops loading, fetch fresh links (labels kept)
  const refreshing = useRef(0)
  const refreshImages = useCallback(() => {
    if (Date.now() - refreshing.current < 30_000) return
    refreshing.current = Date.now()
    load(compare || mode === 'review', key, true)
  }, [load, compare, mode, key])
  useEffect(() => {
    const t = window.setInterval(refreshImages, 4 * 60 * 60 * 1000)
    return () => window.clearInterval(t)
  }, [refreshImages])

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
        <button
          type="button"
          className="text-sm text-[var(--text-muted)] hover:underline"
          onClick={async () => {
            if (!window.confirm(`Delete this test scan of ${host} and its labels?`)) return
            const r = await fetch(api(`/lab/scans/${params.id}${q}`), { method: 'DELETE' })
            if (r.ok) window.location.href = `${window.location.pathname.replace(/\/lab\/[^/]+$/, '/lab')}${q}`
          }}
        >
          Delete
        </button>
        {!compare && (
          <div role="group" aria-label="Labelling mode" className="inline-flex gap-0.5 rounded-[var(--radius-pill)] bg-[var(--surface-muted)] p-[3px]">
            {(['review', 'blind'] as const).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => switchMode(m)} className={`rounded-[var(--radius-pill)] px-3 py-1 text-[13px] font-semibold ${mode === m ? 'bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-xs)]' : 'text-[var(--text-muted)]'}`}>
                {m === 'review' ? 'Review' : 'Blind'}
              </button>
            ))}
          </div>
        )}
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
        <Compare scan={scan} labels={labels} notes={notes} />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
          {/* the checkpoint, with CXO Studio's definitions */}
          <section className="flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--card-padding)] lg:sticky lg:top-6">
            <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
              <span>
                {i + 1} / {scan.checkpoints.length}
                {cp.area ? ` · ${cp.area}` : ''}
              </span>
              <span className="flex gap-1.5">
                {mode === 'review' && cp.blindCheck && <Chip>Blind check</Chip>}
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
            {shown && ai && (
              <div className="flex flex-col gap-1.5 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-muted)] p-3">
                <p className="text-sm">
                  Scanner: <b style={{ color: BUTTONS.find((b) => b.label === ai.answer)?.fg }}>{WORD[ai.answer] || ai.answer}</b>
                  {ai.coveredByShopify ? <span className="text-[var(--text-muted)]"> (Shopify default)</span> : null}
                </p>
                {ai.reason && <p className="text-sm leading-relaxed text-[var(--text-muted)]">{ai.reason}</p>}
                <Trace a={ai} />
              </div>
            )}
            {mode === 'review' && !shown && (
              <p className="text-xs text-[var(--text-muted)]">
                {cp.blindCheck ? "Blind check: label it first, the scanner's answer stays hidden. These keep the agreement score honest." : "The scanner couldn't check this one: label it yourself."}
              </p>
            )}
            {shown && ai && !disagree && (
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setLabel(ai.answer as Label)} className="flex items-center justify-between rounded-[var(--radius-md)] border px-3 py-2.5 text-sm font-semibold" style={{ borderColor: labels[cp.id] === ai.answer ? 'var(--result-pass-fg)' : 'var(--border)', background: labels[cp.id] === ai.answer ? 'var(--result-pass-bg)' : 'var(--surface)', color: labels[cp.id] === ai.answer ? 'var(--result-pass-fg)' : 'var(--text)' }}>
                  Agree
                  <kbd className="rounded-[var(--radius-sm)] border border-[var(--border)] px-1.5 text-[11px] text-[var(--text-muted)]">A</kbd>
                </button>
                <button type="button" onClick={() => setDisagree(true)} className="flex items-center justify-between rounded-[var(--radius-md)] border px-3 py-2.5 text-sm font-semibold" style={{ borderColor: labels[cp.id] && labels[cp.id] !== ai.answer ? 'var(--result-fail-fg)' : 'var(--border)', background: labels[cp.id] && labels[cp.id] !== ai.answer ? 'var(--result-fail-bg)' : 'var(--surface)', color: labels[cp.id] && labels[cp.id] !== ai.answer ? 'var(--result-fail-fg)' : 'var(--text)' }}>
                  {labels[cp.id] && labels[cp.id] !== ai.answer ? `Disagree: ${WORD[labels[cp.id]]}` : 'Disagree'}
                  <kbd className="rounded-[var(--radius-sm)] border border-[var(--border)] px-1.5 text-[11px] text-[var(--text-muted)]">D</kbd>
                </button>
              </div>
            )}
            {shown && disagree && <p className="text-xs text-[var(--text-muted)]">What should it be? Add a note below if the definition is the problem.</p>}
            {(!shown || disagree) && (
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
            )}
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
            <label className="flex flex-col gap-1.5 text-xs text-[var(--text-muted)]">
              Note on the definition (optional)
              <textarea
                value={notes[cp.id] || ''}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                maxLength={1000}
                placeholder="e.g. the definition asks for two benefits, one is enough here because…"
                className="resize-y rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--border-strong)]"
              />
            </label>
            {scan.leftOut && scan.leftOut.measured + scan.leftOut.niche > 0 && (
              <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                Not in this list: {scan.leftOut.measured} checked in the page code (validated with technical tools)
                {scan.leftOut.niche ? `, ${scan.leftOut.niche} not for ${scan.niche.toLowerCase()} stores` : ''}.
              </p>
            )}
          </section>

          {/* what the scanner saw */}
          <section className="flex min-w-0 flex-col gap-3">
            <div role="group" aria-label="Screenshots" className="inline-flex w-fit max-w-full overflow-x-auto gap-0.5 rounded-[var(--radius-pill)] bg-[var(--surface-muted)] p-[3px]">
              {TABS.map(({ tab: t, word }) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  aria-pressed={tab === t}
                  className={`rounded-[var(--radius-pill)] px-4 py-1.5 text-[13px] font-semibold ${tab === t ? 'bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-xs)]' : 'text-[var(--text-muted)]'}`}
                >
                  {word}
                </button>
              ))}
            </div>
            {tab === 'text' ? (
              <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4">
                <p className="text-xs text-[var(--text-muted)]">Text inside closed tabs and accordions (Details, Dimensions, Care…), as the scanner read it. Not visible in the screenshots.</p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{scan.hiddenText || 'None found on this page.'}</p>
              </div>
            ) : (
              images.length === 0 && <p className="text-sm text-[var(--text-muted)]">No {tab === 'menu' ? 'menu' : tab} screenshots for this scan.</p>
            )}
            <div className="flex flex-col gap-3">
              {images.map((img) => (
                <ExampleCrop key={img.url} img={img} checkpointId={cp.id} checkpointTitle={cp.title} store={host} labKey={key} mobile={/^mobile/i.test(img.label)} onBroken={refreshImages} />
              ))}
            </div>
          </section>
        </div>
      )}
    </Shell>
  )
}

/** Your label next to the scanner's answer and reasoning: disagreements first. */
function Compare({ scan, labels, notes }: { scan: Scan; labels: Record<string, Label>; notes: Record<string, string> }) {
  const answers = new Map((scan.answers || []).map((a) => [a.id, a]))
  const rows = scan.checkpoints.map((cp) => {
    const a = answers.get(cp.id)
    const you = labels[cp.id]
    const ai = a?.answer || 'unknown'
    const state = !you || you === 'skip' || ai === 'unknown' ? 'open' : ai === you ? 'agree' : 'disagree'
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
        Agreement on this store: <span className="font-semibold text-[var(--text)]">{judged.length ? Math.round((agree / judged.length) * 100) : 0}%</span> ({agree}/{judged.length}), {rows.length - judged.length} not labelled, can't tell or not checked by the scanner.
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
            <Trace a={a} />
            {notes[cp.id] && <p className="text-sm leading-relaxed text-[var(--text)]">Your note: {notes[cp.id]}</p>}
          </div>
        ))}
      </div>
    </section>
  )
}

/** How the scanner got there: the rule line the AI used, where it looked, what overruled it. */
function Trace({ a }: { a?: Answer }) {
  if (!a || (!a.rule && !a.seen?.length && !a.by)) return null
  const BY: Record<string, string> = { 'Seen in': 'changed to fail by "Seen in"', 'Code check': 'changed to fail by a code check', Measured: 'measured in the page code' }
  return (
    <p className="text-xs leading-relaxed text-[var(--text-muted)]">
      {a.rule ? <>Rule: <span className="text-[var(--text)]">{a.rule}</span></> : null}
      {a.seen?.length ? <>{a.rule ? ' · ' : ''}Seen in: <span className="text-[var(--text)]">{a.seen.join(', ')}</span></> : null}
      {a.by ? <>{a.rule || a.seen?.length ? ' · ' : ''}<span className="font-semibold">{BY[a.by] || a.by}</span></> : null}
    </p>
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
