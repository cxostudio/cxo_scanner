'use client'

// The paid full report: /scan/report?id=<report id>. Built by lib/fullReport (homepage, a collection,
// the best seller with its cart and checkout), read from /api/report/[id]. While it runs, the page
// shows the progress and refreshes itself.
import { useEffect, useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { CheckpointResultBody } from '../components/CheckpointResultBody'
import { api, asset } from '@/lib/base'
import { estimate, eur } from '@/lib/estimate'
import { isQualified, scoreOf, effortLabel, type ScanResult } from '@/lib/report'

const CALL_URL = process.env.NEXT_PUBLIC_CALL_URL || 'https://tally.so/r/w2dP9M'

type Area = 'site' | 'homepage' | 'category' | 'product' | 'cart' | 'checkout'
type Row = ScanResult & { area: Area }
type Page = { key: 'homepage' | 'category' | 'product'; how: string; url: string; status: string; previewDesktop: string | null; previewMobile: string | null; results: Row[] }
type Report = { status: string; url: string; locale: string; createdAt: string; answers: { revenue?: string; aov?: string; cr?: string }; pages: Page[] }

const AREAS: { id: Area; label: string; page: Page['key']; blurb: string }[] = [
  { id: 'site', label: 'General elements', page: 'product', blurb: 'Header, menu, footer and speed: what shoppers see on every page.' },
  { id: 'homepage', label: 'Homepage', page: 'homepage', blurb: 'Where most visits start: does it say what you sell and why to trust you?' },
  { id: 'category', label: 'Collection page', page: 'category', blurb: 'Where shoppers compare: can they find and choose a product fast?' },
  { id: 'product', label: 'Product page', page: 'product', blurb: 'Where the decision is made: does it answer every question before add to cart?' },
  { id: 'cart', label: 'Cart', page: 'product', blurb: 'One step from paying: does it keep the momentum and the order value up?' },
  { id: 'checkout', label: 'Checkout', page: 'product', blurb: 'The last step: is anything there making shoppers hesitate?' },
]
const PAGE_LABEL: Record<Page['key'], string> = { homepage: 'Homepage', category: 'Collection', product: 'Best seller' }

const pri = (r: ScanResult) => (r.checkpoint?.priority === 'High' ? 0 : r.checkpoint?.priority === 'Medium' ? 1 : 2)
const eff = (r: ScanResult) => ({ Easy: 0, Moderate: 1, Difficult: 2 } as Record<string, number>)[r.checkpoint?.difficulty || ''] ?? 1
const byImpact = (a: ScanResult, b: ScanResult) => pri(a) - pri(b) || eff(a) - eff(b)
const isUnknown = (r: Row) => r.status === 'unknown'
const isFail = (r: Row) => !isUnknown(r) && !r.passed
const hostOf = (u: string) => { try { return new URL(/^https?:/i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, '') } catch { return u } }
const shortEur = (n: number) => (n >= 1000 ? `€${(Math.round(n / 100) / 10).toString().replace(/\.0$/, '')}k` : eur(n))
const tone = (s: number) => (s >= 80 ? 'pass' : s >= 55 ? 'mid' : 'fail')

export default function ReportPage() {
  const [id, setId] = useState<string | null>(null)
  const [data, setData] = useState<Report | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => { setId(new URLSearchParams(window.location.search).get('id')) }, [])
  useEffect(() => {
    if (!id) return
    let stop = false
    let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      const r = await fetch(api(`/report/${id}`), { cache: 'no-store' }).catch(() => null)
      if (stop) return
      if (!r || r.status === 404) { setMissing(true); return }
      const d = (await r.json()) as Report
      setData(d)
      if (d.status !== 'done' && d.status !== 'failed') timer = setTimeout(load, 5000)
    }
    load()
    return () => { stop = true; clearTimeout(timer) }
  }, [id])

  if (missing) return <Shell><p className="text-[var(--text-muted)]">We can't find this report. Check the link in your email, or reply to it and we'll sort it out.</p></Shell>
  if (!data) return <Shell><p className="text-[var(--text-muted)]">Loading your report…</p></Shell>
  if (data.status === 'failed') return <Shell><h1 className="h1">We couldn't finish your report</h1><p className="mt-3 text-[var(--text-muted)]">Something on {hostOf(data.url)} stopped our scan. We've been notified and will get back to you by email.</p></Shell>
  if (data.status !== 'done') return <Progress data={data} />
  return <ReportView data={data} />
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="cxo-page-in min-h-screen px-[var(--gutter)] pt-[34px]">
      <a className="cxo-logo !mb-10" href="https://cxo.studio" aria-label="CXO studio"><img src={asset('/cxo-logo.png')} alt="CXO studio" /></a>
      <div className="mx-auto max-w-[680px] [&_.h1]:font-[family-name:var(--font-display)] [&_.h1]:text-[32px] [&_.h1]:font-bold [&_.h1]:leading-[1.15] [&_.h1]:tracking-[-0.03em]">{children}</div>
    </main>
  )
}

function Progress({ data }: { data: Report }) {
  const order: Page['key'][] = ['homepage', 'category', 'product']
  const rows = order.map((k) => ({ k, p: data.pages.find((p) => p.key === k) }))
  return (
    <Shell>
      <p className="text-sm font-semibold text-[var(--text-muted)]">{hostOf(data.url)} · Full conversion report</p>
      <h1 className="h1 mt-3">Your report is being built</h1>
      <p className="mt-3 text-[17px] leading-[1.6] text-[var(--text-muted)]">We're scanning your store from the homepage to checkout. It takes a few minutes. You can close this page: the report comes by email too.</p>
      <ul className="mt-8 flex flex-col gap-3">
        {rows.map(({ k, p }) => {
          const st = p?.status === 'done' ? 'done' : p?.status === 'failed' ? 'failed' : 'running'
          return (
            <li key={k} className="flex items-center gap-3 rounded-[14px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5">
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-bold ${st === 'done' ? 'bg-[var(--result-pass-bg)] text-[var(--result-pass-fg)]' : st === 'failed' ? 'bg-[var(--result-fail-bg)] text-[var(--result-fail-fg)]' : 'bg-[var(--surface-muted)] text-[var(--text-muted)]'}`}>
                {st === 'done' ? '✓' : st === 'failed' ? '!' : <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />}
              </span>
              <span className="font-semibold text-[var(--text)]">{k === 'product' ? 'Best seller, cart and checkout' : PAGE_LABEL[k]}</span>
              <span className="ml-auto truncate text-sm text-[var(--text-muted)]">{p ? hostOf(p.url) + new URL(p.url).pathname.replace(/\/$/, '') : 'finding the page…'}</span>
            </li>
          )
        })}
      </ul>
    </Shell>
  )
}

function ReportView({ data }: { data: Report }) {
  const host = hostOf(data.url)
  const all = useMemo(() => data.pages.flatMap((p) => p.results), [data])
  const judged = all.filter((r) => !isUnknown(r))
  const scored = judged.filter((r) => r.status !== 'na' && !r.coveredByShopify)
  const fails = scored.filter((r) => !r.passed).sort(byImpact)
  const quickWins = fails.filter((r) => r.checkpoint?.priority === 'High' && r.checkpoint?.difficulty === 'Easy').length
  const est = estimate(data.answers.revenue || '', data.answers.aov || '', data.answers.cr || '')
  const qualified = isQualified(data.answers.revenue || '')
  const score = scoreOf(judged)
  const top = fails.slice(0, 10)
  const date = new Date(data.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

  const areas = AREAS.map((a) => {
    const rows = all.filter((r) => r.area === a.id)
    const j = rows.filter((r) => !isUnknown(r))
    const s = j.filter((r) => r.status !== 'na' && !r.coveredByShopify)
    // an area where we could check less than half is not scored: a 100 there would mean nothing
    const blind = rows.length > 0 && j.length < rows.length / 2
    return { ...a, rows, blind, fails: s.filter((r) => !r.passed).sort(byImpact), passed: j.filter((r) => r.passed), unknown: rows.filter(isUnknown), score: j.length && !blind ? scoreOf(j) : null, page: data.pages.find((p) => p.key === a.page) }
  }).filter((a) => a.rows.length)

  return (
    <main className="cxo-page-in min-h-screen pb-24">
      <div className="px-[var(--gutter)] pt-[34px]">
        <a className="cxo-logo !mb-10" href="https://cxo.studio" aria-label="CXO studio"><img src={asset('/cxo-logo.png')} alt="CXO studio" /></a>

        {/* ── verdict ── */}
        <section className="mx-auto w-full max-w-[1080px]">
          <p className="text-sm font-semibold text-[var(--text-muted)]">{host} · Full conversion report · {date}</p>
          <h1 className="mt-4 max-w-[860px] font-[family-name:var(--font-display)] text-[clamp(30px,4.2vw,48px)] font-bold leading-[1.1] tracking-[-0.035em] text-[var(--text)]">
            {est ? <>Your store leaves about <span style={{ color: 'var(--result-fail-fg)' }}>{shortEur(est.lift10)} per month</span> on the table</> : <>{fails.length} things to fix across your store</>}
          </h1>
          <p className="mt-5 max-w-[760px] text-[17px] leading-[1.6] text-[var(--text-muted)]">
            We ran {all.length} checkpoints on your homepage, a collection, your best seller, the cart and checkout. {fails.length} need fixing{quickWins ? `, ${quickWins} of them high-impact and easy` : ''}. Start with the ten below, then go area by area.
          </p>

          <div className="mt-8 grid grid-cols-3 gap-3 max-[810px]:grid-cols-2">
            {areas.map((a) => {
              const t = a.score === null ? 'mid' : tone(a.score)
              return (
                <a key={a.id} href={`#area-${a.id}`} className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-subtle)]">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-semibold text-[var(--text)]">{a.label}</span>
                    {a.score !== null && <span className="font-[family-name:var(--font-display)] text-[18px] font-bold tabular-nums" style={{ color: `var(--result-${t === 'mid' ? 'fail' : t}-fg)`, opacity: t === 'mid' ? 0.75 : 1 }}>{a.score}</span>}
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-muted)]">
                    <div className="h-full rounded-full" style={{ width: `${a.score ?? 0}%`, background: `var(--result-${t === 'pass' ? 'pass' : 'fail'}-fg)`, opacity: t === 'mid' ? 0.6 : 1 }} />
                  </div>
                  <p className="mt-2 text-[13px] text-[var(--text-muted)]">
                    {a.blind ? `Couldn't open it from our scan · ${a.unknown.length} not checked` : <>{a.fails.length ? `${a.fails.length} to fix` : 'Nothing to fix'}{a.unknown.length ? ` · ${a.unknown.length} not checked` : ''}</>}
                  </p>
                </a>
              )
            })}
          </div>
          <p className="mt-4 text-[13px] text-[var(--text-muted)]">Overall conversion score: <b className="text-[var(--text)]">{score}/100</b>. High-impact checkpoints count double.</p>
        </section>
      </div>

      {/* ── fix these first ── */}
      <section className="mx-auto mt-16 max-w-[1080px] box-content px-[var(--gutter)]" aria-labelledby="first">
        <h2 id="first" className="font-[family-name:var(--font-display)] text-[clamp(24px,3vw,32px)] font-bold tracking-[-0.03em] text-[var(--text)]">Fix these first</h2>
        <p className="mt-2 text-[15px] text-[var(--text-muted)]">The ten issues with the most impact for the least work, across the whole store.</p>
        <div className="mt-6 flex flex-col gap-3">
          {top.map((r, i) => <Finding key={`top-${r.area}-${r.ruleId}`} r={r} n={i + 1} areaLabel={AREAS.find((a) => a.id === r.area)?.label} />)}
        </div>
      </section>

      {/* ── area by area ── */}
      {areas.map((a) => (
        <section key={a.id} id={`area-${a.id}`} className="mx-auto mt-16 max-w-[1080px] box-content scroll-mt-6 px-[var(--gutter)]">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-[var(--border)] pb-4">
            <div className="min-w-0">
              <h2 className="font-[family-name:var(--font-display)] text-[clamp(22px,2.6vw,28px)] font-bold tracking-[-0.03em] text-[var(--text)]">{a.label}</h2>
              <p className="mt-1 text-[15px] text-[var(--text-muted)]">{a.blurb}</p>
            </div>
            {a.page && (a.id === 'homepage' || a.id === 'category' || a.id === 'product') && (
              <a href={a.page.url} target="_blank" rel="noreferrer" className="truncate text-[13px] font-medium text-[var(--text-muted)] underline">Page scanned: {new URL(a.page.url).pathname.replace(/\/$/, '') || '/'}</a>
            )}
          </div>

          <div className={`mt-6 grid gap-8 ${a.page?.previewDesktop && (a.id === 'homepage' || a.id === 'category' || a.id === 'product') ? 'lg:grid-cols-[minmax(0,1fr)_300px]' : ''}`}>
            <div className="flex min-w-0 flex-col gap-3">
              {a.fails.length === 0 && !a.blind && <p className="rounded-[14px] bg-[var(--result-pass-bg)] px-4 py-3.5 text-[15px] font-semibold text-[var(--result-pass-fg)]">Nothing to fix here. Well done.</p>}
              {a.fails.map((r, i) => <Finding key={r.ruleId} r={r} n={i + 1} />)}
              {a.passed.length > 0 && <Group title={`${a.passed.length} ${a.passed.length === 1 ? 'checkpoint' : 'checkpoints'} passed`} rows={a.passed} kind="pass" />}
              {a.blind && <p className="rounded-[14px] border border-dashed border-[var(--border-strong)] px-4 py-3.5 text-[15px] text-[var(--text-muted)]">{unknownNote(a.id, a.unknown)}</p>}
              {a.unknown.length > 0 && <Group title={`${a.unknown.length} we couldn't check`} note={unknownNote(a.id, a.unknown)} rows={a.unknown} kind="unknown" />}
            </div>
            {a.page?.previewDesktop && (a.id === 'homepage' || a.id === 'category' || a.id === 'product') && (
              <div className="max-[1023px]:hidden">
                <div className="sticky top-6 overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface-muted)]" style={{ maxHeight: 640 }}>
                  <img src={a.page.previewDesktop} alt={`Your ${a.label.toLowerCase()} on desktop`} className="block w-full" />
                </div>
              </div>
            )}
          </div>
        </section>
      ))}

      {/* ── next ── */}
      <section className="mx-auto mt-20 max-w-[1080px] box-content px-[var(--gutter)]">
        <div className="rounded-[20px] bg-[var(--bg-subtle)] p-8 max-[560px]:p-6">
          {qualified ? (
            <>
              <h2 className="font-[family-name:var(--font-display)] text-[clamp(22px,2.6vw,28px)] font-bold tracking-[-0.03em] text-[var(--text)]">Want us to fix it with you?</h2>
              <p className="mt-2 max-w-[620px] text-[15px] leading-[1.6] text-[var(--text-muted)]">On a 30-minute call we go through this report, tell you what to fix first for your numbers, and whether working together would pay off.</p>
              <a href={CALL_URL} className="cxo-btn cxo-btn-primary mt-5 inline-flex">Book a call</a>
            </>
          ) : (
            <>
              <h2 className="font-[family-name:var(--font-display)] text-[clamp(22px,2.6vw,28px)] font-bold tracking-[-0.03em] text-[var(--text)]">Share it with whoever builds your store</h2>
              <p className="mt-2 max-w-[620px] text-[15px] leading-[1.6] text-[var(--text-muted)]">This link opens on any device. Each fix says what to change and why, so your developer or agency can work through it in order.</p>
            </>
          )}
        </div>
        <p className="mt-8 text-center text-[13px] leading-[1.6] text-[var(--text-muted)]">
          This report is done by AI against our CRO checklist and can get one wrong. Spot a mistake? Reply to the report email and we'll check it by hand.
        </p>
      </section>
    </main>
  )
}

function unknownNote(area: Area, rows: Row[]): string {
  if (area === 'checkout' && rows.some((r) => /checkout/i.test(r.reason))) return "We couldn't open your checkout from our scan (often a bot check). These stay open: check them by hand or ask us."
  if (area === 'cart' && rows.some((r) => /cart/i.test(r.reason))) return "We couldn't add your best seller to the cart from our scan. These stay open: check them by hand or ask us."
  return 'Our scan could not see enough to judge these. They are left out of your score.'
}

function Finding({ r, n, areaLabel }: { r: Row; n: number; areaLabel?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`rounded-[16px] border px-4 transition-colors ${open ? 'border-[var(--border-strong)] bg-[var(--bg-subtle)]' : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-subtle)]'}`} style={{ ['--result-fg' as string]: 'var(--result-fail-fg)', ['--result-bg' as string]: 'var(--result-fail-bg)' }}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 py-4 text-left">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[var(--result-fail-fg)] text-[12px] font-bold text-[var(--text-inverse)]">{n}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-[family-name:var(--font-display)] text-[16px] font-bold leading-[1.35] tracking-[-0.01em] text-[var(--text)]">{r.ruleTitle}</span>
          <span className="mt-1 flex flex-wrap gap-x-2 text-[12.5px] font-medium text-[var(--text-muted)]">
            {areaLabel && <span>{areaLabel}</span>}
            {r.checkpoint?.priority === 'High' && <span style={{ color: 'var(--result-fail-fg)' }}>High impact</span>}
            <span>{effortLabel(r)}</span>
          </span>
        </span>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-[var(--border)]"><ChevronDown className={`h-[18px] w-[18px] text-[var(--text)] transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden /></span>
      </button>
      {open && (
        <div className="border-t border-[var(--border)] pb-4 pt-4">
          <div className="flex flex-col gap-4 rounded-[12px] bg-[var(--result-bg)] p-5">
            <div className="flex flex-col gap-1.5">
              <p className="font-[family-name:var(--font-display)] text-[17px] font-bold text-[var(--result-fg)]">What we saw:</p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text)]">{r.reason}</p>
            </div>
            {r.checkpoint && <CheckpointResultBody checkpoint={r.checkpoint} passed={false} />}
          </div>
        </div>
      )}
    </div>
  )
}

function Group({ title, note, rows, kind }: { title: string; note?: string; rows: Row[]; kind: 'pass' | 'unknown' }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-[16px] border border-[var(--border)] bg-[var(--surface)] px-4">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 py-3.5 text-left">
        <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-bold ${kind === 'pass' ? 'bg-[var(--result-pass-bg)] text-[var(--result-pass-fg)]' : 'border border-dashed border-[var(--border-strong)] text-[var(--text-muted)]'}`}>{kind === 'pass' ? '✓' : '?'}</span>
        <span className="flex-1 text-[15px] font-semibold text-[var(--text)]">{title}</span>
        <ChevronDown className={`h-[18px] w-[18px] text-[var(--text-muted)] transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div className="border-t border-[var(--border)] pb-3 pt-2">
          {note && <p className="pb-2 text-[13px] text-[var(--text-muted)]">{note}</p>}
          <ul className="flex flex-col">
            {rows.map((r) => (
              <li key={r.ruleId} className="border-b border-[var(--border)] py-2.5 last:border-0">
                <p className="text-[14px] font-medium text-[var(--text)]">{r.ruleTitle}</p>
                {kind === 'pass' && r.reason && <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">{r.reason}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
