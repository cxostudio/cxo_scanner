'use client'

// Test lab, home: saved test scans and the scanner's accuracy per checkpoint against Louis's labels.
// A checkpoint is ready to go Live at 90%+ agreement on at least MIN_LABELS labelled stores.
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { api } from '@/lib/base'
import { MIN_LABELS, TARGET, VERDICT_LABEL, type Verdict } from '@/lib/lab/verdict'

type ScanRow = { id: string; url: string; createdAt: string; niche: string; checkpoints: number; labelled: number }
type NoteRow = { scan: string; url: string; id: string; title: string; note: string }
type AccRow = { id: string; title: string; status?: string; area?: string; labelled: number; agree: number; unknown: number; flips: number; runs: number; verdict: Verdict; mismatches: { scan: string; url: string; ai: string; louis: string }[] }

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return u
  }
}
const pct = (n: number) => `${Math.round(n * 100)}%`
const WORD: Record<string, string> = { pass: 'Pass', fail: 'Fail', na: 'Not relevant', unknown: "Couldn't check" }
const VERDICT_ORDER: Verdict[] = ['ready', 'demote', 'audit', 'testing', 'live']
const VERDICT_COLOR: Record<Verdict, { bg: string; fg: string }> = {
  ready: { bg: 'var(--result-pass-bg)', fg: 'var(--result-pass-fg)' },
  live: { bg: 'var(--surface-muted)', fg: 'var(--text-muted)' },
  demote: { bg: 'var(--result-fail-bg)', fg: 'var(--result-fail-fg)' },
  audit: { bg: 'var(--result-fail-bg)', fg: 'var(--result-fail-fg)' },
  testing: { bg: 'var(--surface-muted)', fg: 'var(--text-muted)' },
}

export default function LabHome() {
  const [key, setKey] = useState('')
  const [data, setData] = useState<{ scans: ScanRow[]; accuracy: AccRow[]; notes?: NoteRow[]; bias?: { blind: { labelled: number; agree: number }; review: { labelled: number; agree: number } } } | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [rejudge, setRejudge] = useState<{ busy: boolean; note: string }>({ busy: false, note: '' })
  const [filter, setFilter] = useState<Verdict | 'all'>('all')
  const [newUrl, setNewUrl] = useState('')
  const [scanning, setScanning] = useState('')

  /** Test scan of any URL from the lab: Live and Draft checkpoints, saved here for labelling (2 to 3 minutes). */
  const startScan = async (e: React.FormEvent) => {
    e.preventDefault()
    let url: URL
    try {
      url = new URL(/^https?:\/\//.test(newUrl) ? newUrl : `https://${newUrl}`)
    } catch {
      setScanning('That is not a valid URL.')
      return
    }
    const slug = `${url.hostname.replace(/^www\./, '').split('.')[0]}${url.pathname.replace(/\/+$/, '').split('/').slice(-1)[0] ? `-${url.pathname.replace(/\/+$/, '').split('/').slice(-1)[0]}` : '-home'}`
    const scanId = `test-${slug}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 60)
    setScanning(`Scanning ${url.hostname}… this takes 2 to 3 minutes. You can keep labelling in another tab.`)
    try {
      const r = await fetch(api('/scan'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.toString(), rules: [{ id: 'x', title: 'p', description: 'p' }], email: 'info+test@cxo.studio', scanId }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || !d.labId) throw new Error(d.error || `scan failed (${r.status})`)
      setScanning(`Done: ${url.hostname} is in the list below.`)
      setNewUrl('')
      await load(key)
    } catch (err) {
      setScanning(`Scan failed: ${String((err as Error).message || err)}`)
    }
  }
  const [acting, setActing] = useState<Record<string, string>>({})

  /** Change the checkpoint's status in Airtable (Live, Draft, audit only), then reload. */
  const act = async (a: AccRow, action: 'live' | 'draft' | 'audit') => {
    setActing((m) => ({ ...m, [a.id]: 'Saving…' }))
    try {
      const r = await fetch(api(`/lab/promote${key ? `?key=${encodeURIComponent(key)}` : ''}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: a.id, action, title: a.title, score: `${a.agree}/${a.labelled}, ${a.flips} unstable` }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || String(r.status))
      setActing((m) => ({ ...m, [a.id]: action === 'live' ? 'Now Live' : action === 'audit' ? 'Moved to audit only' : 'Back to Draft' }))
      await load(key)
    } catch (e) {
      setActing((m) => ({ ...m, [a.id]: `Failed: ${String((e as Error).message || e)}` }))
    }
  }

  const load = (k: string) =>
    fetch(api(`/lab/scans${k ? `?key=${encodeURIComponent(k)}` : ''}`))
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({})))?.error || String(r.status)))))
      .then(setData)
      .catch((e) => setError(String(e.message || e)))

  useEffect(() => {
    const k = new URLSearchParams(window.location.search).get('key') || ''
    setKey(k)
    load(k)
  }, [])

  /** Judge every saved scan again with today's Airtable definitions, then reload the accuracy. */
  const runRejudge = async () => {
    setRejudge({ busy: true, note: 'Judging every test scan again with the current Airtable definitions…' })
    try {
      const r = await fetch(api(`/lab/rejudge${key ? `?key=${encodeURIComponent(key)}` : ''}`), { method: 'POST' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || String(r.status))
      type Res = { ok: boolean; error?: string; before?: { agree: number; labelled: number } | null; after?: { agree: number; labelled: number } | null }
      const res = d.scans as Res[]
      const sum = (k: 'before' | 'after') => res.reduce((a, x) => ({ agree: a.agree + (x[k]?.agree || 0), labelled: a.labelled + (x[k]?.labelled || 0) }), { agree: 0, labelled: 0 })
      const b = sum('before')
      const a = sum('after')
      const failed = res.filter((x) => !x.ok)
      setRejudge({
        busy: false,
        note:
          `${res.length - failed.length} scans judged again.` +
          (a.labelled ? ` Agreement on labelled checkpoints: ${pct(b.agree / (b.labelled || 1))} → ${pct(a.agree / a.labelled)}.` : '') +
          (failed.length ? ` ${failed.length} skipped (${failed[0].error}).` : ''),
      })
      await load(key)
    } catch (e) {
      setRejudge({ busy: false, note: `Re-judge failed: ${String((e as Error).message || e)}` })
    }
  }

  const q = key ? `?key=${encodeURIComponent(key)}` : ''
  const ready = data?.accuracy.filter((a) => a.verdict === 'ready') ?? []
  const counts = VERDICT_ORDER.map((v) => [v, data?.accuracy.filter((a) => a.verdict === v).length ?? 0] as const)
  const shown = (data?.accuracy ?? []).filter((a) => filter === 'all' || a.verdict === filter).sort((a, b) => VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict) || a.agree / a.labelled - b.agree / b.labelled)

  return (
    <main className="min-h-screen bg-[var(--bg)] px-[var(--gutter)] py-10 font-[family-name:var(--font-body)] text-[var(--text)]">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-10">
        <header className="flex flex-col gap-2">
          <p className="flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
            Scanner test lab
            <span className="flex gap-4">
              <Link href={`/lab/review${key ? `?key=${encodeURIComponent(key)}` : ''}`} className="normal-case tracking-normal underline">
                Review rewrites →
              </Link>
              <Link href={`/admin/leads${key ? `?key=${encodeURIComponent(key)}` : ''}`} className="normal-case tracking-normal underline">
                Leads →
              </Link>
            </span>
          </p>
          <h1 className="font-[family-name:var(--font-display)] text-[32px] font-bold tracking-[-0.03em]">Label blind, then measure</h1>
          <p className="max-w-[680px] text-sm leading-relaxed text-[var(--text-muted)]">
            Paste a product, collection or homepage URL below to scan it: it runs Live and Draft checkpoints and lands here. Review each checkpoint against the scanner's answer (Agree or Disagree); about 1 in 5 stays blind to keep the score honest. A checkpoint is ready for Live at {pct(TARGET)} agreement on {MIN_LABELS}+ stores.
          </p>
          <div className="mt-2 flex flex-wrap gap-3">
            <button type="button" className="cxo-btn cxo-btn-ghost" disabled={rejudge.busy || !data?.scans.length} onClick={runRejudge}>
              {rejudge.busy ? 'Re-judging…' : 'Re-judge all with current definitions'}
            </button>
          </div>
          {rejudge.note && <p className="text-sm text-[var(--text-muted)]">{rejudge.note}</p>}
          <form onSubmit={startScan} className="mt-2 flex flex-wrap gap-2">
            <input
              type="url"
              inputMode="url"
              required
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://store.com/products/…  (product, collection or homepage)"
              className="min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            />
            <button type="submit" className="cxo-btn cxo-btn-primary" disabled={scanning.startsWith('Scanning')}>
              {scanning.startsWith('Scanning') ? 'Scanning…' : 'Scan this page'}
            </button>
          </form>
          {scanning && <p className="text-sm text-[var(--text-muted)]">{scanning}</p>}
        </header>

        {error && <p className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--result-fail-fg)]">Could not load the lab: {error}</p>}
        {!data && !error && <p className="text-sm text-[var(--text-muted)]">Loading…</p>}

        {data && (
          <>
            <section className="flex flex-col gap-3">
              <h2 className="font-[family-name:var(--font-display)] text-xl font-bold">Test scans ({data.scans.length})</h2>
              {data.scans.length === 0 && <p className="text-sm text-[var(--text-muted)]">No test scans yet.</p>}
              <div className="flex flex-col divide-y empty:hidden divide-[var(--border)] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
                {data.scans.map((s) => {
                  const done = s.labelled >= s.checkpoints
                  return (
                    <Link key={s.id} href={`/lab/${s.id}${q}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-[var(--bg-subtle)]">
                      <span className="min-w-0 flex-1 truncate font-semibold">{host(s.url)}</span>
                      <span className="text-sm text-[var(--text-muted)]">{s.niche}</span>
                      <span className="text-sm text-[var(--text-muted)]">{new Date(s.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="rounded-[var(--radius-pill)] px-2.5 py-0.5 text-xs font-semibold" style={{ background: done ? 'var(--result-pass-bg)' : 'var(--surface-muted)', color: done ? 'var(--result-pass-fg)' : 'var(--text-muted)' }}>
                        {done ? 'Labelled' : `${s.labelled}/${s.checkpoints} labelled`}
                      </span>
                    </Link>
                  )
                })}
              </div>
            </section>

            <section className="flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-[family-name:var(--font-display)] text-xl font-bold">Accuracy per checkpoint</h2>
                <p className="text-sm text-[var(--text-muted)]">
                  {data.accuracy.length} checkpoints labelled · <span className="font-semibold text-[var(--result-pass-fg)]">{ready.length} ready for Live</span>
                </p>
              </div>
              {data.bias && data.bias.review.labelled > 0 && (
                <p className="max-w-[760px] text-sm leading-relaxed text-[var(--text-muted)]">
                  Review mode check: agreement is <b className="text-[var(--text)]">{pct(data.bias.blind.agree / (data.bias.blind.labelled || 1))}</b> on blind labels ({data.bias.blind.labelled}) and <b className="text-[var(--text)]">{pct(data.bias.review.agree / data.bias.review.labelled)}</b> when you saw the scanner's answer ({data.bias.review.labelled}).
                  {data.bias.blind.labelled >= 30 && data.bias.review.agree / data.bias.review.labelled - data.bias.blind.agree / data.bias.blind.labelled > 0.05 ? ' The gap is over 5 points: seeing the answer is pulling labels toward it. Label more in Blind mode before promoting.' : ' Within 5 points: review mode is not inflating the score.'}
                </p>
              )}
              <p className="max-w-[760px] text-sm leading-relaxed text-[var(--text-muted)]">
                Ready for Live: {pct(TARGET)}+ agreement on {MIN_LABELS}+ labelled stores and the same answer on every recent run. Unstable means the answer changed when the same screenshots were judged again. Promoting writes the status to Airtable; the free scan uses it within minutes.
              </p>
              <div className="flex flex-wrap gap-2">
                {([['all', data.accuracy.length] as const, ...counts]).map(([v, n]) => (
                  <button key={v} type="button" onClick={() => setFilter(v)} className="rounded-[var(--radius-pill)] border border-[var(--border)] px-3 py-1 text-xs font-semibold" style={{ background: filter === v ? 'var(--text)' : 'var(--surface)', color: filter === v ? 'var(--surface)' : 'var(--text)' }}>
                    {v === 'all' ? 'All' : VERDICT_LABEL[v]} ({n})
                  </button>
                ))}
              </div>
              {data.accuracy.length === 0 && <p className="text-sm text-[var(--text-muted)]">Label a scan to see accuracy.</p>}
              <div className="flex flex-col divide-y empty:hidden divide-[var(--border)] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
                {shown.map((a) => {
                  const rate = a.agree / a.labelled
                  const enough = a.labelled >= MIN_LABELS
                  const fg = !enough ? 'var(--text-muted)' : rate >= TARGET ? 'var(--result-pass-fg)' : 'var(--result-fail-fg)'
                  return (
                    <div key={a.id}>
                      <button type="button" onClick={() => setOpen(open === a.id ? null : a.id)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left hover:bg-[var(--bg-subtle)]">
                        <span className="min-w-0 flex-1 text-sm font-semibold">{a.title}</span>
                        <span className="text-xs text-[var(--text-muted)]">{a.status}</span>
                        <span className="rounded-[var(--radius-pill)] px-2 py-0.5 text-xs font-semibold" style={{ background: VERDICT_COLOR[a.verdict].bg, color: VERDICT_COLOR[a.verdict].fg }}>
                          {VERDICT_LABEL[a.verdict]}
                        </span>
                        {a.flips > 0 && <span className="text-xs text-[var(--result-fail-fg)]">{a.flips} unstable</span>}
                        <span className="w-36 text-right text-sm text-[var(--text-muted)]" title="Stores where the scanner could not check this one are left out of the score">
                          {a.agree}/{a.labelled}
                          {a.unknown ? ` · ${a.unknown} not checked` : ''}
                        </span>
                        <span className="w-14 text-right font-[family-name:var(--font-display)] font-bold" style={{ color: fg }}>
                          {pct(rate)}
                        </span>
                      </button>
                      {open === a.id && (
                        <div className="flex flex-col gap-1 border-t border-[var(--border)] bg-[var(--bg-subtle)] px-4 py-3 text-sm">
                          <div className="mb-1 flex flex-wrap items-center gap-2">
                            {a.status !== 'Live' && (
                              <button type="button" className="cxo-btn cxo-btn-primary" disabled={!!acting[a.id] && acting[a.id] === 'Saving…'} onClick={() => act(a, 'live')}>
                                Promote to Live
                              </button>
                            )}
                            {a.status === 'Live' && (
                              <button type="button" className="cxo-btn cxo-btn-ghost" onClick={() => act(a, 'draft')}>
                                Back to Draft
                              </button>
                            )}
                            <button type="button" className="cxo-btn cxo-btn-ghost" onClick={() => act(a, 'audit')}>
                              Move to audit only
                            </button>
                            {acting[a.id] && <span className="text-xs text-[var(--text-muted)]">{acting[a.id]}</span>}
                          </div>
                          {a.mismatches.length === 0 && <span className="text-[var(--text-muted)]">No disagreement with your labels.</span>}
                          {a.mismatches.map((m, i) => (
                            <Link key={i} href={`/lab/${m.scan}${q ? `${q}&` : '?'}compare=1#${a.id}`} className="flex gap-3 hover:underline">
                              <span className="min-w-0 flex-1 truncate">{host(m.url)}</span>
                              <span className="text-[var(--text-muted)]">
                                you: {WORD[m.louis] || m.louis} · scanner: {WORD[m.ai] || m.ai}
                              </span>
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
            {!!data.notes?.length && (
              <section className="flex flex-col gap-3">
                <h2 className="font-[family-name:var(--font-display)] text-xl font-bold">Notes on definitions ({data.notes.length})</h2>
                <div className="flex flex-col divide-y divide-[var(--border)] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
                  {data.notes.map((n, i) => (
                    <Link key={i} href={`/lab/${n.scan}${q}`} className="flex flex-col gap-0.5 px-4 py-3 hover:bg-[var(--bg-subtle)]">
                      <span className="text-sm font-semibold">{n.title}</span>
                      <span className="text-sm text-[var(--text)]">{n.note}</span>
                      <span className="text-xs text-[var(--text-muted)]">{host(n.url)}</span>
                    </Link>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  )
}
