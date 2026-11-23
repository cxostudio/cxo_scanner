'use client'

// The paid full report: /scan/report?id=<report id>&tab=<area>&view=<desktop|mobile>.
// Built by lib/fullReport (homepage, a collection, the best seller with its cart and checkout),
// read from /api/report/[id]. A top bar (store, desktop/mobile, next page) and one tab per part of
// the store; each tab lists its findings next to the page with the findings pinned on it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import { CheckpointResultBody } from '../components/CheckpointResultBody'
import { PageView, Num, Pass, MonitorIcon, PhoneIcon, type Device, type Located } from '../components/PinnedPage'
import { BuildSteps, OrderCard, type OrderInfo } from '../components/ReportBuild'
import { api, asset } from '@/lib/base'
import { estimate, eur } from '@/lib/estimate'
import { isQualified, scoreOf, effortLabel, type ScanResult } from '@/lib/report'

const CALL_URL = process.env.NEXT_PUBLIC_CALL_URL || 'https://tally.so/r/w2dP9M'

type Area = 'site' | 'homepage' | 'category' | 'product' | 'cart' | 'checkout'
type Tab = 'overview' | Area
type Row = ScanResult & { area: Area }
type Shot = { role: 'cart' | 'checkout'; device: Device; label: string; url: string }
type Page = {
  key: 'homepage' | 'category' | 'product'; how: string; url: string; status: string
  located: { desktop: Located | null; mobile: Located | null } | null
  preview: { desktop: string | null; mobile: string | null } | null
  images: Shot[]
  results: Row[]
}
type Report = { order?: OrderInfo | null; status: string; url: string; locale: string; createdAt: string; answers: { revenue?: string; aov?: string; cr?: string }; pages: Page[] }

// shopping order; store-wide checks last, they are seen on every page
const AREAS: { id: Area; label: string; tab: string; page: Page['key']; blurb: string }[] = [
  { id: 'homepage', label: 'Homepage', tab: 'Homepage', page: 'homepage', blurb: 'Where most visits start: does it say what you sell and why to trust you?' },
  { id: 'category', label: 'Collection page', tab: 'Collection', page: 'category', blurb: 'Where shoppers compare: can they find and choose a product fast?' },
  { id: 'product', label: 'Product page', tab: 'Product', page: 'product', blurb: 'Where the decision is made: does it answer every question before add to cart?' },
  { id: 'cart', label: 'Cart', tab: 'Cart', page: 'product', blurb: 'One step from paying: does it keep the momentum and the order value up?' },
  { id: 'checkout', label: 'Checkout', tab: 'Checkout', page: 'product', blurb: 'The last step: is anything there making shoppers hesitate?' },
  { id: 'site', label: 'Every page', tab: 'Every page', page: 'product', blurb: 'Header, menu, footer and speed: what shoppers meet on every page. Shown on your best seller.' },
]

const pri = (r: ScanResult) => (r.checkpoint?.priority === 'High' ? 0 : r.checkpoint?.priority === 'Medium' ? 1 : 2)
const eff = (r: ScanResult) => ({ Easy: 0, Moderate: 1, Difficult: 2 } as Record<string, number>)[r.checkpoint?.difficulty || ''] ?? 1
const byImpact = (a: ScanResult, b: ScanResult) => pri(a) - pri(b) || eff(a) - eff(b)
const isUnknown = (r: Row) => r.status === 'unknown'
const hostOf = (u: string) => { try { return new URL(/^https?:/i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, '') } catch { return u } }
const pathOf = (u: string) => { try { return new URL(u).pathname.replace(/\/$/, '') || '/' } catch { return u } }
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
    <main className="min-h-screen bg-[var(--surface)] px-[var(--gutter)] pt-[34px]">
      <a className="cxo-logo !mb-10" href="https://cxo.studio" aria-label="CXO studio"><img src={asset('/cxo-logo.png')} alt="CXO studio" /></a>
      <div className="mx-auto max-w-[680px] [&_.h1]:font-[family-name:var(--font-display)] [&_.h1]:text-[32px] [&_.h1]:font-bold [&_.h1]:leading-[1.15] [&_.h1]:tracking-[-0.03em]">{children}</div>
    </main>
  )
}

function Progress({ data }: { data: Report }) {
  return (
    <Shell>
      <p className="text-sm font-semibold text-[var(--text-muted)]">{hostOf(data.url)} · Full conversion report</p>
      <h1 className="h1 mt-3">Your report is being built</h1>
      <p className="mt-3 text-[17px] leading-[1.6] text-[var(--text-muted)]">We're scanning your store from the homepage to checkout, on desktop and mobile. It takes a few minutes. You can close this page: the report comes by email too.</p>
      <div className="mt-8 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--card-padding)]">
        <BuildSteps pages={data.pages} />
      </div>
      {data.order && <div className="mt-6"><OrderCard order={data.order} /></div>}
    </Shell>
  )
}

/* ── the report ─────────────────────────────────────────────────────────── */

function ReportView({ data }: { data: Report }) {
  const host = hostOf(data.url)
  const all = useMemo(() => data.pages.flatMap((p) => p.results), [data])
  const judged = all.filter((r) => !isUnknown(r))
  const fails = judged.filter((r) => r.status !== 'na' && !r.coveredByShopify && !r.passed).sort(byImpact)
  const est = estimate(data.answers.revenue || '', data.answers.aov || '', data.answers.cr || '')
  const qualified = isQualified(data.answers.revenue || '')
  const date = new Date(data.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

  const areas = useMemo(() => AREAS.map((a) => {
    const rows = all.filter((r) => r.area === a.id)
    const j = rows.filter((r) => !isUnknown(r))
    // an area where we could check less than half is not scored: a 100 there would mean nothing
    const blind = rows.length > 0 && j.length < rows.length / 2
    const f = j.filter((r) => r.status !== 'na' && !r.coveredByShopify && !r.passed).sort(byImpact)
    return { ...a, rows, blind, fails: f, passed: j.filter((r) => r.passed), unknown: rows.filter(isUnknown), score: j.length && !blind ? scoreOf(j) : null, page: data.pages.find((p) => p.key === a.page) }
  }).filter((a) => a.rows.length), [all, data.pages])

  const tabs: Tab[] = ['overview', ...areas.map((a) => a.id)]
  const [tab, setTab] = useState<Tab>('overview')
  const [device, setDevice] = useState<Device>('desktop')
  const [focus, setFocus] = useState<string | null>(null)

  // tab and device live in the URL, so a link opens on the same view
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const t = q.get('tab') as Tab | null
    if (t && tabs.includes(t)) setTab(t)
    if (q.get('view') === 'mobile') setDevice('mobile')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    q.set('tab', tab); q.set('view', device)
    window.history.replaceState(null, '', `${window.location.pathname}?${q}`)
  }, [tab, device])

  const go = (t: Tab, findingId?: string) => {
    setTab(t)
    setFocus(findingId || null)
    window.scrollTo({ top: 0 })
  }
  const next = tabs[tabs.indexOf(tab) + 1]
  const nextLabel = next ? (next === 'overview' ? 'Overview' : AREAS.find((a) => a.id === next)!.tab) : null
  const current = areas.find((a) => a.id === tab)
  const favicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`

  return (
    <main className="min-h-screen bg-[var(--surface)] pb-24">
      {/* ── top bar ── */}
      <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto flex max-w-[1440px] items-center gap-3 px-[var(--gutter)] py-3">
          <img src={favicon} alt="" width={36} height={36} className="h-9 w-9 shrink-0 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] object-contain p-1.5" />
          <div className="min-w-0">
            <p className="truncate font-[family-name:var(--font-display)] text-[16px] font-bold leading-tight text-[var(--text)]">{host}</p>
            <a href={data.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12.5px] text-[var(--text-muted)] hover:text-[var(--text)]">
              Full conversion report · {date} <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          </div>
          {tab !== 'overview' && (
            <div className="mx-auto flex rounded-full border border-[var(--border)] bg-[var(--surface-muted)] p-1 max-[810px]:ml-auto max-[810px]:mr-0" role="group" aria-label="Device">
              {(['desktop', 'mobile'] as const).map((d) => (
                <button key={d} type="button" onClick={() => setDevice(d)} aria-pressed={device === d}
                  className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors max-[560px]:px-2.5 ${device === d ? 'bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-raised)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}>
                  {d === 'desktop' ? <MonitorIcon /> : <PhoneIcon />}<span className="max-[560px]:hidden">{d === 'desktop' ? 'Desktop' : 'Mobile'}</span>
                </button>
              ))}
            </div>
          )}
          {nextLabel && (
            <button type="button" onClick={() => go(next!)} className={`cxo-btn cxo-btn-primary !h-auto !px-4 !py-2 text-[13px] max-[810px]:hidden ${tab === 'overview' ? 'ml-auto' : ''}`}>
              {tab === 'overview' ? `Start with the ${nextLabel.toLowerCase()}` : `Next: ${nextLabel}`} <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
        <nav className="mx-auto flex max-w-[1440px] gap-1 overflow-x-auto px-[var(--gutter)] pb-2.5 [scrollbar-width:none]" aria-label="Report pages">
          {tabs.map((t) => {
            const a = areas.find((x) => x.id === t)
            const on = t === tab
            return (
              <button key={t} type="button" onClick={() => go(t)} aria-current={on ? 'page' : undefined}
                className={`flex shrink-0 items-center gap-2 rounded-full px-3.5 py-1.5 text-[14px] font-medium transition-colors ${on ? 'bg-[var(--surface-muted)] text-[var(--text)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}>
                {t === 'overview' ? 'Overview' : a!.tab}
                {a && (a.blind
                  ? <span className="text-[12px] text-[var(--text-muted)]">?</span>
                  : a.fails.length > 0 && <span className="rounded-full bg-[var(--result-fail-bg)] px-1.5 text-[12px] font-bold tabular-nums text-[var(--result-fail-fg)]">{a.fails.length}</span>)}
              </button>
            )
          })}
        </nav>
      </header>

      {tab === 'overview' ? (
        <Overview host={host} total={all.length} fails={fails} est={est ? est.lift10 : null} score={scoreOf(judged)} areas={areas} go={go} />
      ) : current ? (
        <AreaView key={current.id} area={current} device={device} focus={focus} />
      ) : null}

      {/* ── next step ── */}
      <section className="mx-auto mt-20 max-w-[1440px] px-[var(--gutter)]">
        {nextLabel && (
          <button type="button" onClick={() => go(next!)} className="mb-10 flex w-full items-center justify-between rounded-[16px] border border-[var(--border)] px-5 py-4 text-left hover:border-[var(--border-strong)] hover:bg-[var(--bg-subtle)]">
            <span><span className="block text-[13px] text-[var(--text-muted)]">Next</span><span className="font-[family-name:var(--font-display)] text-[18px] font-bold text-[var(--text)]">{nextLabel}</span></span>
            <ChevronRight className="h-5 w-5 text-[var(--text)]" aria-hidden />
          </button>
        )}
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
              <p className="mt-2 max-w-[620px] text-[15px] leading-[1.6] text-[var(--text-muted)]">This link opens on any device. Each fix says what to change and why, so your developer or agency can work through it page by page.</p>
            </>
          )}
        </div>
        <p className="mt-8 text-center text-[13px] leading-[1.6] text-[var(--text-muted)]">This report is done by AI against our CRO checklist and can get one wrong. Spot a mistake? Reply to the report email and we'll check it by hand.</p>
      </section>
    </main>
  )
}

/* ── overview ───────────────────────────────────────────────────────────── */

type AreaSummary = { id: Area; label: string; tab: string; blurb: string; blind: boolean; fails: Row[]; passed: Row[]; unknown: Row[]; score: number | null; page?: Page }

function Overview({ host, total, fails, est, score, areas, go }: { host: string; total: number; fails: Row[]; est: number | null; score: number; areas: AreaSummary[]; go: (t: Tab, id?: string) => void }) {
  const quick = fails.filter((r) => r.checkpoint?.priority === 'High' && r.checkpoint?.difficulty === 'Easy').length
  const top = fails.slice(0, 10)
  return (
    <div className="mx-auto max-w-[1080px] px-[var(--gutter)] pt-12 max-[560px]:pt-8">
      <h1 className="max-w-[860px] font-[family-name:var(--font-display)] text-[clamp(28px,3.6vw,42px)] font-bold leading-[1.12] tracking-[-0.035em] text-[var(--text)]">
        {est ? <>Your store leaves about <span style={{ color: 'var(--result-fail-fg)' }}>{shortEur(est)} per month</span> on the table</> : <>{fails.length} things to fix across {host}</>}
      </h1>
      <p className="mt-4 max-w-[760px] text-[17px] leading-[1.6] text-[var(--text-muted)]">
        We ran {total} checkpoints on your homepage, a collection, your best seller, the cart and checkout, on desktop and mobile. {fails.length} need fixing{quick ? `, ${quick} of them high-impact and easy` : ''}.
      </p>

      <div className="mt-8 grid grid-cols-3 gap-3 max-[810px]:grid-cols-2">
        {areas.map((a) => {
          const t = a.score === null ? null : tone(a.score)
          const thumb = thumbOf(a)
          return (
            <button key={a.id} type="button" onClick={() => go(a.id)} className="group overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--surface)] text-left transition-colors hover:border-[var(--border-strong)]">
              <div className="relative h-[120px] overflow-hidden border-b border-[var(--border)] bg-[var(--surface-muted)] max-[560px]:h-[90px]">
                {thumb && <img src={thumb} alt="" className="block w-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.02]" />}
              </div>
              <div className="p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-[var(--text)]">{a.label}</span>
                  {a.score !== null && <span className="font-[family-name:var(--font-display)] text-[18px] font-bold tabular-nums" style={{ color: `var(--result-${t === 'pass' ? 'pass' : 'fail'}-fg)` }}>{a.score}</span>}
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-muted)]">
                  <div className="h-full rounded-full" style={{ width: `${a.score ?? 0}%`, background: `var(--result-${t === 'pass' ? 'pass' : 'fail'}-fg)` }} />
                </div>
                <p className="mt-2 text-[13px] text-[var(--text-muted)]">
                  {a.blind ? `Couldn't open it from our scan` : `${a.fails.length ? `${a.fails.length} to fix` : 'Nothing to fix'}${a.unknown.length ? ` · ${a.unknown.length} not checked` : ''}`}
                </p>
              </div>
            </button>
          )
        })}
      </div>
      <p className="mt-4 text-[13px] text-[var(--text-muted)]">Overall conversion score: <b className="text-[var(--text)]">{score}/100</b>. High-impact checkpoints count double.</p>

      <h2 className="mt-14 font-[family-name:var(--font-display)] text-[clamp(22px,2.6vw,28px)] font-bold tracking-[-0.03em] text-[var(--text)]">Fix these first</h2>
      <p className="mt-2 text-[15px] text-[var(--text-muted)]">The ten issues with the most impact for the least work, across the whole store. Open one to see it pinned on the page.</p>
      <div className="mt-6 flex flex-col gap-2">
        {top.map((r, i) => (
          <button key={`${r.area}-${r.ruleId}`} type="button" onClick={() => go(r.area, r.ruleId)} className="flex items-center gap-3 rounded-[16px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3.5 text-left transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--bg-subtle)]">
            <Num n={i + 1} />
            <span className="min-w-0 flex-1">
              <span className="block font-[family-name:var(--font-display)] text-[16px] font-bold leading-[1.35] tracking-[-0.01em] text-[var(--text)]">{r.ruleTitle}</span>
              <Meta r={r} area={AREAS.find((a) => a.id === r.area)?.label} />
            </span>
            <ChevronRight className="h-[18px] w-[18px] shrink-0 text-[var(--text-muted)]" aria-hidden />
          </button>
        ))}
      </div>
    </div>
  )
}

function thumbOf(a: AreaSummary): string | null {
  if (a.id === 'cart' || a.id === 'checkout') return a.page?.images.find((i) => i.role === a.id && i.device === 'desktop')?.url || a.page?.images.find((i) => i.role === a.id)?.url || null
  return a.page?.located?.desktop?.screenshot || a.page?.preview?.desktop || null
}

function Meta({ r, area }: { r: Row; area?: string }) {
  return (
    <span className="mt-1 flex flex-wrap gap-x-2 text-[12.5px] font-medium text-[var(--text-muted)]">
      {area && <span>{area}</span>}
      {r.checkpoint?.priority === 'High' && <span style={{ color: 'var(--result-fail-fg)' }}>High impact</span>}
      <span>{effortLabel(r)}</span>
    </span>
  )
}

function Unknown() {
  return (
    <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full border-2 border-dashed border-[var(--border-strong)] text-[12px] font-bold text-[var(--text-muted)]" aria-label="Not checked" role="img">?</span>
  )
}

/* ── one part of the store ──────────────────────────────────────────────── */

function AreaView({ area, device, focus }: { area: AreaSummary; device: Device; focus: string | null }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(focus ? [focus] : []))
  const [selected, setSelected] = useState<string | null>(focus)
  const shotRef = useRef<HTMLDivElement | null>(null)
  const num = useMemo(() => new Map(area.fails.map((r, i) => [r.ruleId, i + 1])), [area.fails])
  const flow = area.id === 'cart' || area.id === 'checkout'
  const located = !flow ? area.page?.located?.[device] || null : null
  const fallback = !flow ? area.page?.preview?.[device] || null : null

  const scrollToPin = useCallback((id: string) => {
    const box = located?.pins.find((p) => p.findingId === id)?.box
    const el = shotRef.current
    const img = el?.querySelector('img')
    if (!located || !box || !el || !img) return
    el.scrollTo({ top: Math.max(0, (box.y / located.height) * img.offsetHeight - 16), behavior: 'smooth' })
  }, [located])

  useEffect(() => {
    if (!focus) return
    const t = setTimeout(() => { document.getElementById(`f-${focus}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); scrollToPin(focus) }, 250)
    return () => clearTimeout(t)
  }, [focus, scrollToPin])

  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const pick = (id: string, from: 'pin' | 'list') => {
    setSelected(id)
    if (from === 'pin') {
      setOpen((s) => new Set(s).add(id))
      setTimeout(() => document.getElementById(`f-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60)
    } else scrollToPin(id)
  }
  const shots = flow ? (area.page?.images || []).filter((i) => i.role === area.id) : []
  const shotsHere = shots.filter((i) => i.device === device)
  const shown = shotsHere.length ? shotsHere : shots
  const shownDevice: Device = shotsHere.length ? device : shots[0]?.device || device

  return (
    <div className="mx-auto max-w-[1440px] px-[var(--gutter)] pt-8">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h1 className="font-[family-name:var(--font-display)] text-[clamp(24px,3vw,32px)] font-bold tracking-[-0.03em] text-[var(--text)]">{area.label}</h1>
          <p className="mt-1 max-w-[720px] text-[15px] text-[var(--text-muted)]">{area.blurb}</p>
        </div>
        {area.page && !flow && <a href={area.page.url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 truncate text-[13px] font-medium text-[var(--text-muted)] underline">Page scanned: {pathOf(area.page.url)} <ExternalLink className="h-3 w-3 shrink-0" aria-hidden /></a>}
      </div>

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* the page, pinned */}
        <div className="min-w-0 lg:sticky lg:top-[132px] lg:order-2 lg:self-start">
          {flow ? (
            <FlowShots shots={shown} device={shownDevice} wanted={device} label={area.label} />
          ) : (
            <PageView device={device} state={located} fallback={fallback} url={area.page?.url || ''} num={num} selected={selected} onPin={(id) => pick(id, 'pin')} scrollRef={shotRef} pageName={area.label.toLowerCase()} />
          )}
        </div>

        {/* the findings */}
        <div className="flex min-w-0 flex-col gap-3 lg:order-1">
          {area.blind && <p className="rounded-[14px] border border-dashed border-[var(--border-strong)] px-4 py-3.5 text-[15px] text-[var(--text-muted)]">{unknownNote(area.id)}</p>}
          {area.fails.length === 0 && !area.blind && <p className="rounded-[14px] bg-[var(--result-pass-bg)] px-4 py-3.5 text-[15px] font-semibold text-[var(--result-pass-fg)]">Nothing to fix here. Well done.</p>}
          {area.fails.map((r) => (
            <Finding key={r.ruleId} r={r} n={num.get(r.ruleId)!} open={open.has(r.ruleId)} active={selected === r.ruleId}
              onToggle={() => { toggle(r.ruleId); pick(r.ruleId, 'list') }} />
          ))}
          {area.passed.length > 0 && <Group title={`${area.passed.length} ${area.passed.length === 1 ? 'checkpoint' : 'checkpoints'} passed`} rows={area.passed} kind="pass" />}
          {area.unknown.length > 0 && <Group title={`${area.unknown.length} we couldn't check`} note={area.blind ? undefined : 'Our scan could not see enough to judge these. They are left out of your score.'} rows={area.unknown} kind="unknown" />}
        </div>
      </div>
    </div>
  )
}

function unknownNote(area: Area): string {
  if (area === 'checkout') return "We couldn't open your checkout from our scan (often a bot check). These checkpoints stay open: check them by hand, or reply to the report email and we'll look."
  if (area === 'cart') return "We couldn't add your best seller to the cart from our scan. These checkpoints stay open: check them by hand, or reply to the report email and we'll look."
  return 'Our scan could not see enough of this part to judge it.'
}

function FlowShots({ shots, device, wanted, label }: { shots: Shot[]; device: Device; wanted: Device; label: string }) {
  if (!shots.length) return <div className="grid aspect-[4/3] place-items-center rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] text-sm text-[var(--text-muted)]">No screenshot of the {label.toLowerCase()}</div>
  const frame = device === 'desktop'
    ? 'rounded-[var(--radius-lg)] border border-[var(--border-strong)]'
    : 'ml-auto w-full max-w-[340px] rounded-[34px] border-[8px] border-[var(--text)] max-[1023px]:mx-auto'
  return (
    <div>
      {device !== wanted && <p className="mb-2 text-[13px] text-[var(--text-muted)]">Only captured on {device}.</p>}
      <div className={`overflow-hidden bg-[var(--surface)] ${frame}`}>
        <div className={`overflow-y-auto ${device === 'desktop' ? 'max-h-[calc(100vh-160px)]' : 'h-[min(680px,calc(100vh-160px))]'} max-[560px]:max-h-[460px]`}>
          {shots.map((s, i) => <img key={i} src={s.url} alt={`Your ${label.toLowerCase()} on ${device}`} className="block w-full border-b border-[var(--border)] last:border-0" />)}
        </div>
      </div>
    </div>
  )
}

function Finding({ r, n, open, active, onToggle }: { r: Row; n: number; open: boolean; active: boolean; onToggle: () => void }) {
  return (
    <div id={`f-${r.ruleId}`} className={`scroll-mt-[150px] rounded-[16px] border px-4 transition-colors ${active || open ? 'border-[var(--border-strong)] bg-[var(--bg-subtle)]' : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-subtle)]'}`}
      style={{ ['--result-fg' as string]: 'var(--result-fail-fg)', ['--result-bg' as string]: 'var(--result-fail-bg)' }}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 py-4 text-left">
        <Num n={n} />
        <span className="min-w-0 flex-1">
          <span className="block font-[family-name:var(--font-display)] text-[16px] font-bold leading-[1.35] tracking-[-0.01em] text-[var(--text)]">{r.ruleTitle}</span>
          <Meta r={r} />
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
        {kind === 'pass' ? <Pass /> : <Unknown />}
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
                {r.reason && <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">{r.reason}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
