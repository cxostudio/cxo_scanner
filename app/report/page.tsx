'use client'

// The paid full report: /scan/report?id=<report id>&tab=<area>&view=<desktop|mobile>.
// Built by lib/fullReport (homepage, a collection, the best seller with its cart and checkout),
// read from /api/report/[id]. A top bar (store, desktop/mobile, next page) and one tab per part of
// the store; each tab lists its findings next to the page with the findings pinned on it.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AppWindow, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import { CheckpointResultBody } from '../components/CheckpointResultBody'
import { PageView, PinOverlay, Num, Pass, MonitorIcon, PhoneIcon, type Device, type Located } from '../components/PinnedPage'
import { BuildSteps, LogoSpinner, OrderCard, type OrderInfo } from '../components/ReportBuild'
import { ThankYouUpload } from '../components/ThankYouUpload'
import { api, asset } from '@/lib/base'
import { estimate, eur } from '@/lib/estimate'
import { scoreOf, effortLabel, TONE, toneOf, SCORE_SCALE, type ScanResult } from '@/lib/report'

const CALL_URL = process.env.NEXT_PUBLIC_CALL_URL || 'https://tally.so/r/w2dP9M'

type Area = 'site' | 'homepage' | 'category' | 'product' | 'cart' | 'checkout' | 'thankyou'
type Tab = 'overview' | Area
type Row = ScanResult & { area: Area }
type Shot = { role: 'cart' | 'checkout' | 'thankyou'; device: Device; label: string; url: string; pins?: Located['pins'] }
type Page = {
  key: 'homepage' | 'category' | 'product'; how: string; url: string; status: string
  located: { desktop: Located | null; mobile: Located | null } | null
  preview: { desktop: string | null; mobile: string | null } | null
  images: Shot[]
  results: Row[]
  /** a newer scan of this page the buyer asked for: running, or failed (the results shown stay the previous ones) */
  rescan?: { status: string; url: string; error: string | null } | null
}
/** The thank-you page: screenshots the buyer uploads (the scan can't place an order). */
type ThankYou = { checks: number; at: string | null; shots: { device: Device; url: string; pins?: Located['pins'] }[]; results: Row[] }
type Report = { order?: OrderInfo | null; rescansLeft?: number; status: string; url: string; locale: string; createdAt: string; answers: { revenue?: string; aov?: string; cr?: string }; pages: Page[]; thankYou?: ThankYou | null }

// shopping order; store-wide checks last, they are seen on every page
const AREAS: { id: Area; label: string; tab: string; page: Page['key']; blurb: string }[] = [
  { id: 'homepage', label: 'Homepage', tab: 'Homepage', page: 'homepage', blurb: 'Where most visits start: does it say what you sell and why to trust you?' },
  { id: 'category', label: 'Collection page', tab: 'Collection page', page: 'category', blurb: 'Where shoppers compare: can they find and choose a product fast?' },
  { id: 'product', label: 'Product page', tab: 'Product page', page: 'product', blurb: 'Where the decision is made: does it answer every question before add to cart?' },
  { id: 'cart', label: 'Cart', tab: 'Cart', page: 'product', blurb: 'One step from paying: does it keep the momentum and the order value up?' },
  { id: 'checkout', label: 'Checkout', tab: 'Checkout', page: 'product', blurb: 'The last step: is anything there making shoppers hesitate?' },
  { id: 'site', label: 'General elements', tab: 'General', page: 'product', blurb: 'Header, menu, footer and speed: what shoppers meet on every page. Shown on your best seller.' },
]
// not scanned: judged from the buyer's own screenshots, so kept out of the store score
const THANK_YOU = { id: 'thankyou' as Area, label: 'Thank-you page', tab: 'Thank you page', page: 'product' as Page['key'], blurb: 'After the order: does it confirm clearly, reassure, and bring the shopper back?' }

const pri = (r: ScanResult) => (r.checkpoint?.priority === 'High' ? 0 : r.checkpoint?.priority === 'Medium' ? 1 : 2)
const eff = (r: ScanResult) => ({ Easy: 0, Moderate: 1, Difficult: 2 } as Record<string, number>)[r.checkpoint?.difficulty || ''] ?? 1
const byImpact = (a: ScanResult, b: ScanResult) => pri(a) - pri(b) || eff(a) - eff(b)
const isUnknown = (r: Row) => r.status === 'unknown'
const hostOf = (u: string) => { try { return new URL(/^https?:/i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, '') } catch { return u } }
const pathOf = (u: string) => { try { return new URL(u).pathname.replace(/\/$/, '') || '/' } catch { return u } }
const shortEur = (n: number) => (n >= 1000 ? `€${(Math.round(n / 100) / 10).toString().replace(/\.0$/, '')}k` : eur(n))

export default function ReportPage() {
  const [id, setId] = useState<string | null>(null)
  const [data, setData] = useState<Report | null>(null)
  const [missing, setMissing] = useState(false)
  const [tick, setTick] = useState(0)

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
      const rescanning = d.pages.some((p) => p.rescan && p.rescan.status !== 'failed')
      if ((d.status !== 'done' && d.status !== 'failed') || rescanning) timer = setTimeout(load, 5000)
    }
    load()
    return () => { stop = true; clearTimeout(timer) }
  }, [id, tick])

  if (missing) return <Shell><p className="text-[var(--text-muted)]">We can't find this report. Check the link in your email, or reply to it and we'll sort it out.</p></Shell>
  // the first load: just the logo spinner (the report itself appears in a second)
  if (!data) return <LogoSpinner label="Loading your report" />
  if (data.status === 'failed') return <Shell><h1 className="h1">We couldn't finish your report</h1><p className="mt-3 text-[var(--text-muted)]">Something on {hostOf(data.url)} stopped our scan. We've been notified and will get back to you by email.</p></Shell>
  if (data.status !== 'done') return <Progress data={data} />
  return <ReportView data={data} id={id!} reload={() => setTick((t) => t + 1)} />
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
      <div className="text-center">
        <p className="text-sm font-semibold text-[var(--text-muted)]">{hostOf(data.url)} · Full conversion report</p>
        <h1 className="h1 mt-3">Your report is being built</h1>
        <p className="mt-3 text-[17px] leading-[1.6] text-[var(--text-muted)]">We're scanning your store from the homepage to checkout, on desktop and mobile. It takes a few minutes. You can close this page: the report comes by email too.</p>
      </div>
      <div className="mt-8 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-[var(--card-padding)]">
        <BuildSteps pages={data.pages} />
      </div>
      {data.order && <div className="mt-6"><OrderCard order={data.order} /></div>}
    </Shell>
  )
}

/* ── the report ─────────────────────────────────────────────────────────── */

function ReportView({ data, id, reload }: { data: Report; id: string; reload: () => void }) {
  const host = hostOf(data.url)
  const all = useMemo(() => data.pages.flatMap((p) => p.results), [data])
  const judged = all.filter((r) => !isUnknown(r))
  const fails = judged.filter((r) => r.status !== 'na' && !r.coveredByShopify && !r.passed).sort(byImpact)
  const est = estimate(data.answers.revenue || '', data.answers.aov || '', data.answers.cr || '')
  const date = new Date(data.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

  const areas = useMemo(() => AREAS.map((a) => {
    const rows = all.filter((r) => r.area === a.id)
    const j = rows.filter((r) => !isUnknown(r))
    // an area where we could check less than half is not scored: a 100 there would mean nothing
    const blind = rows.length > 0 && j.length < rows.length / 2
    const f = j.filter((r) => r.status !== 'na' && !r.coveredByShopify && !r.passed).sort(byImpact)
    return { ...a, rows, blind, fails: f, passed: j.filter((r) => r.passed), unknown: rows.filter(isUnknown), score: j.length && !blind ? scoreOf(j) : null, page: data.pages.find((p) => p.key === a.page) }
  }).filter((a) => a.rows.length), [all, data.pages])
  // the thank-you tab: always there when the checkpoints exist, results once the buyer uploads
  const ty = data.thankYou
  const thank = useMemo<AreaSummary | null>(() => {
    if (!ty) return null
    const rows = ty.results
    const j = rows.filter((r) => !isUnknown(r))
    const f = j.filter((r) => r.status !== 'na' && !r.passed).sort(byImpact)
    const shots: Shot[] = ty.shots.map((x) => ({ role: 'thankyou', device: x.device, label: THANK_YOU.label, url: x.url, pins: x.pins }))
    return { ...THANK_YOU, page: undefined, rows, blind: false, fails: f, passed: j.filter((r) => r.passed), unknown: rows.filter(isUnknown), score: j.length ? scoreOf(j) : null, shots }
  }, [ty])
  const tabAreas = thank ? [...areas, thank] : areas

  const tabs: Tab[] = ['overview', ...tabAreas.map((a) => a.id)]
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
  const nextLabel = next ? (next === 'overview' ? 'Overview' : [...AREAS, THANK_YOU].find((a) => a.id === next)!.tab) : null
  const current = tabAreas.find((a) => a.id === tab)
  // one width for the bar, the tabs, every tab's content and the footer
  const favicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`

  return (
    <Feedback.Provider value={{ reportId: id, tab, device }}>
    <main className="min-h-screen bg-[var(--surface)] pb-24">
      {/* ── top bar ── */}
      <header className="border-b border-[var(--border)] bg-[var(--surface)]">
        <div className={`mx-auto flex max-w-[1280px] items-center gap-4 px-[var(--gutter)] py-3`}>
          <a href="https://cxo.studio" aria-label="CXO studio" className="shrink-0"><img src={asset('/cxo-logo.png')} alt="CXO studio" className="block h-[22px] w-auto max-[560px]:h-[18px]" /></a>
          <span className="h-8 w-px shrink-0 bg-[var(--border)]" aria-hidden />
          {/* favicon and the two lines are the same height: 40px (20 + 4 gap + 16) */}
          <img src={favicon} alt="" width={40} height={40} className="h-10 w-10 shrink-0 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] object-contain p-1.5" />
          <div className="flex h-10 min-w-0 flex-col justify-between">
            <p className="truncate font-[family-name:var(--font-display)] text-[16px] font-bold leading-[20px] text-[var(--text)]">{host}</p>
            <a href={data.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12.5px] leading-[16px] text-[var(--text-muted)] hover:text-[var(--text)]">
              Full conversion report · {date} <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          </div>
          {tab === 'overview' && nextLabel && (
            <button type="button" onClick={() => go(next!)} className="cxo-btn cxo-btn-primary ml-auto !h-11 !px-5 !py-0 text-[14px] max-[810px]:hidden">
              {`Start with the ${nextLabel.toLowerCase()}`} <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          )}
        </div>
        <nav className={`mx-auto flex max-w-[1280px] gap-1 overflow-x-auto px-[var(--gutter)] pb-2.5 [scrollbar-width:none]`} aria-label="Report pages">
          {tabs.map((t) => {
            const a = tabAreas.find((x) => x.id === t)
            const on = t === tab
            return (
              <button key={t} type="button" onClick={() => go(t)} aria-current={on ? 'page' : undefined}
                className={`flex shrink-0 items-center gap-2 rounded-full px-3.5 py-1.5 text-[14px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-strong)] ${on ? 'bg-[var(--surface-muted)] text-[var(--text)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}>
                {t === 'overview' ? 'Overview' : a!.tab}
                {a && (a.blind
                  ? <span className="text-[12px] text-[var(--text-muted)]">?</span>
                  : a.fails.length > 0 && <span className="rounded-full px-1.5 text-[12px] font-bold tabular-nums" style={{ background: TONE[toneOf(a.score ?? 0)].bg, color: TONE[toneOf(a.score ?? 0)].fg }} title={`${a.fails.length} issues`}>{a.fails.length}</span>)}
              </button>
            )
          })}
        </nav>
      </header>

      {tab === 'overview' ? (
        <Overview host={host} total={new Set(all.map((r) => r.ruleId)).size} fails={fails} est={est ? est.lift10 : null} score={scoreOf(judged)} areas={areas} go={go} />
      ) : current?.id === 'thankyou' && ty ? (
        <ThankYouView area={current} thankYou={ty} reportId={id} reload={reload} device={device} setDevice={setDevice} focus={focus} />
      ) : current ? (
        <AreaView key={current.id} area={current} device={device} setDevice={setDevice} focus={focus} reportId={id} rescansLeft={data.rescansLeft ?? 0} reload={reload} />
      ) : null}

      {/* ── next step ── */}
      <section className={`mx-auto mt-20 max-w-[1280px] px-[var(--gutter)]`}>
        {/* every buyer showed intent by paying: offer the agency to all of them */}
        <div className="rounded-[20px] bg-[var(--bg-subtle)] p-8 max-[560px]:p-6">
          <h2 className="font-[family-name:var(--font-display)] text-[clamp(22px,2.6vw,28px)] font-bold tracking-[-0.03em] text-[var(--text)]">Want us to fix it with you?</h2>
          <p className="mt-2 max-w-[640px] text-[15px] leading-[1.6] text-[var(--text-muted)]">CXO Studio turns reports like this one into more revenue: we prioritise the fixes for your numbers, design and build them, and A/B test the big ones. On a 30-minute call we go through your report and tell you honestly whether working together would pay off.</p>
          <a href={CALL_URL} className="cxo-btn cxo-btn-primary mt-5 inline-flex">Book a call</a>
        </div>
      </section>
    </main>
    </Feedback.Provider>
  )
}

/* ── overview ───────────────────────────────────────────────────────────── */

type AreaSummary = { id: Area; label: string; tab: string; blurb: string; blind: boolean; rows: Row[]; fails: Row[]; passed: Row[]; unknown: Row[]; score: number | null; page?: Page; shots?: Shot[] }

function Overview({ host, total, fails, est, score, areas, go }: { host: string; total: number; fails: Row[]; est: number | null; score: number; areas: AreaSummary[]; go: (t: Tab, id?: string) => void }) {
  const quick = fails.filter((r) => r.checkpoint?.priority === 'High' && r.checkpoint?.difficulty === 'Easy').length
  const top = fails.slice(0, 10)
  return (
    <div className="mx-auto max-w-[1280px] px-[var(--gutter)] pt-12 max-[560px]:pt-8">
      <h1 className="max-w-[860px] font-[family-name:var(--font-display)] text-[clamp(28px,3.6vw,42px)] font-bold leading-[1.12] tracking-[-0.035em] text-[var(--text)]">
        {est ? <>Your store leaves about <span style={{ color: 'var(--result-fail-fg)' }}>{shortEur(est)} per month</span> on the table</> : <>{fails.length} things to fix across {host}</>}
      </h1>
      <p className="mt-4 max-w-[760px] text-[17px] leading-[1.6] text-[var(--text-muted)]">
        We ran {total} checkpoints on your homepage, a collection, your best seller, the cart and checkout, on desktop and mobile. {fails.length} need fixing{quick ? `, ${quick} of them high-impact and easy` : ''}.
      </p>

      <div className="mt-8 grid grid-cols-3 gap-3 max-[810px]:grid-cols-2">
        {areas.map((a) => {
          const t = a.score === null ? null : TONE[toneOf(a.score)]
          const thumb = thumbOf(a)
          const checked = a.rows.length - a.unknown.length
          return (
            <button key={a.id} type="button" onClick={() => go(a.id)} className="group overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--surface)] text-left transition-colors hover:border-[var(--border-strong)]">
              <div className="relative aspect-[16/10] overflow-hidden border-b border-[var(--border)] bg-[var(--surface-muted)]">
                {thumb && <img src={thumb} alt="" className="block h-full w-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.02]" />}
              </div>
              <div className="p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold text-[var(--text)]">{a.label}</span>
                  {t && a.score !== null && (
                    <span className="font-[family-name:var(--font-display)] text-[18px] font-bold tabular-nums" style={{ color: t.fg }}>{a.score}<span className="text-[13px] font-semibold text-[var(--text-muted)]">/100</span></span>
                  )}
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-muted)]">
                  {t && <div className="h-full rounded-full" style={{ width: `${a.score ?? 0}%`, background: t.fg }} />}
                </div>
                {t && <span className="mt-2.5 inline-block rounded-full px-2 py-0.5 text-[12px] font-semibold" style={{ background: t.bg, color: t.fg }}>{t.word}</span>}
                <p className="mt-2 text-[13px] leading-[1.45] text-[var(--text-muted)]">
                  {a.blind
                    ? `We couldn't open it from our scan: ${a.unknown.length} checkpoints not checked`
                    : <>{a.fails.length ? <><b className="text-[var(--text)]">{a.fails.length} {a.fails.length === 1 ? 'issue' : 'issues'}</b> found in {checked} checkpoints</> : <>All {checked} checkpoints passed</>}{a.unknown.length ? `, ${a.unknown.length} we couldn't check` : ''}</>}
                </p>
              </div>
            </button>
          )
        })}
      </div>
      <p className="mt-4 text-[13px] leading-[1.5] text-[var(--text-muted)]">
        Overall conversion score: <b style={{ color: TONE[toneOf(score)].fg }}>{score}/100, {TONE[toneOf(score)].word.toLowerCase()}</b>.
        <br />{SCORE_SCALE}
      </p>

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

/** Three bars, like a signal: how many are filled says the level (1 low, 3 high). */
function Bars({ level, label }: { level: number; label: string }) {
  return (
    <svg width="13" height="12" viewBox="0 0 13 12" role="img" aria-label={label} className="shrink-0">
      {[0, 1, 2].map((i) => (
        <rect key={i} x={i * 4.5} y={8 - i * 4} width="3.5" height={4 + i * 4} rx="1" style={{ fill: i < level ? 'currentColor' : 'var(--border-strong)' }} />
      ))}
    </svg>
  )
}

const IMPACT: Record<string, { level: number; word: string }> = { High: { level: 3, word: 'High impact' }, Medium: { level: 2, word: 'Medium impact' }, Low: { level: 1, word: 'Low impact' } }
const EFFORT: Record<string, number> = { Easy: 1, Moderate: 2, Difficult: 3 }

/** Where it is, how much it matters, how much work it takes. */
function Meta({ r, area }: { r: Row; area?: string }) {
  const impact = IMPACT[r.checkpoint?.priority || '']
  const effort = EFFORT[r.checkpoint?.difficulty || '']
  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] font-medium text-[var(--text-muted)]">
      {area && <span className="inline-flex items-center gap-1.5"><AppWindow className="h-3.5 w-3.5" aria-hidden />{area}</span>}
      {impact && <span className="inline-flex items-center gap-1.5" style={impact.level === 3 ? { color: 'var(--result-fail-fg)' } : undefined}><Bars level={impact.level} label={impact.word} />{impact.word}</span>}
      {effort && <span className="inline-flex items-center gap-1.5"><Bars level={effort} label={effortLabel(r)} />{effortLabel(r)}</span>}
    </span>
  )
}

function Unknown() {
  return (
    <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full border-2 border-dashed border-[var(--border-strong)] text-[12px] font-bold text-[var(--text-muted)]" aria-label="Not checked" role="img">?</span>
  )
}

/* ── one part of the store ──────────────────────────────────────────────── */

function AreaView({ area, device, setDevice, focus, reportId, rescansLeft, reload }: { area: AreaSummary; device: Device; setDevice: (d: Device) => void; focus: string | null; reportId: string; rescansLeft: number; reload: () => void }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(focus ? [focus] : []))
  const [selected, setSelected] = useState<string | null>(focus)
  const shotRef = useRef<HTMLDivElement | null>(null)
  const num = useMemo(() => new Map(area.fails.map((r, i) => [r.ruleId, i + 1])), [area.fails])
  const flow = area.id === 'cart' || area.id === 'checkout' || area.id === 'thankyou'
  const located = !flow ? area.page?.located?.[device] || null : null
  const fallback = !flow ? area.page?.preview?.[device] || null : null

  const scrollToPin = useCallback((id: string) => {
    const el0 = shotRef.current
    const flowShot = el0?.querySelector<HTMLElement>(`[data-pins~="${id}"]`)
    if (flowShot && el0) {
      const box = JSON.parse(flowShot.dataset.box || '{}')[id] as { y: number } | undefined
      el0.scrollTo({ top: Math.max(0, flowShot.offsetTop + (box?.y || 0) * flowShot.offsetHeight - 16), behavior: 'smooth' })
      return
    }
    const box = located?.pins.find((p) => p.findingId === id)?.box
    const el = shotRef.current
    const img = el?.querySelector('img')
    if (!located || !box || !el || !img) return
    el.scrollTo({ top: Math.max(0, (box.y / located.height) * img.offsetHeight - 16), behavior: 'smooth' })
  }, [located])

  useEffect(() => {
    if (!focus) return
    const t = setTimeout(() => { alignTop(focus); scrollToPin(focus) }, 250)
    return () => clearTimeout(t)
  }, [focus, scrollToPin])

  // checkpoints stack: each opens and closes on its own and the page never jumps. Clicking one in the list
  // only moves the screenshot to its pin; clicking a pin opens its checkpoint and brings it into view.
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const pick = (id: string, from: 'pin' | 'list') => {
    setSelected(id)
    if (from === 'pin') setOpen((s) => new Set(s).add(id))
    requestAnimationFrame(() => requestAnimationFrame(() => { if (from === 'pin') alignTop(id); scrollToPin(id) }))
  }
  const shots = area.shots || (flow ? (area.page?.images || []).filter((i) => i.role === area.id) : [])
  const shotsHere = shots.filter((i) => i.device === device)
  const shown = shotsHere.length ? shotsHere : shots
  const shownDevice: Device = shotsHere.length ? device : shots[0]?.device || device

  return (
    <div className="mx-auto max-w-[1280px] px-[var(--gutter)] pt-8">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h1 className="font-[family-name:var(--font-display)] text-[clamp(24px,3vw,32px)] font-bold tracking-[-0.03em] text-[var(--text)]">{area.label}</h1>
            {area.page && !flow && (
              <a href={area.page.url} target="_blank" rel="noreferrer" title={`Open the page we scanned: ${pathOf(area.page.url)}`} aria-label="Open the page we scanned"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border border-[var(--border)] text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)]">
                <ExternalLink className="h-4 w-4" aria-hidden />
              </a>
            )}
          </div>
          <p className="mt-1 max-w-[720px] text-[15px] text-[var(--text-muted)]">{area.blurb}</p>
          {area.score !== null && (
            <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-[var(--text-muted)]" title={SCORE_SCALE}>
              <span className="rounded-full px-2.5 py-0.5 text-[13px] font-bold" style={{ background: TONE[toneOf(area.score)].bg, color: TONE[toneOf(area.score)].fg }}>{area.score}/100 · {TONE[toneOf(area.score)].word}</span>
              <span>{area.fails.length ? `${area.fails.length} ${area.fails.length === 1 ? 'issue' : 'issues'} found in ${area.rows.length - area.unknown.length} checkpoints` : `All ${area.rows.length - area.unknown.length} checkpoints passed`}</span>
            </p>
          )}
        </div>
      </div>

      {(area.id === 'category' || area.id === 'product') && area.page && (
        <Rescan reportId={reportId} page={area.id} current={area.page} left={rescansLeft} reload={reload} />
      )}

      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* the page, pinned */}
        <div className="min-w-0 lg:sticky lg:top-6 lg:order-2 lg:self-start">
          {/* the switch changes the screenshot only, so it sits on it (as in the free scan) */}
          <div className="mb-3 flex justify-end">
            <div role="group" aria-label="Device" className="inline-flex gap-0.5 rounded-full bg-[var(--surface-muted)] p-[3px] max-[560px]:flex max-[560px]:w-full">
              {(['desktop', 'mobile'] as Device[]).map((d) => (
                <button key={d} type="button" onClick={() => setDevice(d)} aria-pressed={device === d}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors max-[560px]:flex-1 max-[560px]:py-2 ${device === d ? 'bg-[var(--surface)] text-[var(--text)] shadow-[0_1px_2px_rgba(9,9,11,.12)]' : 'text-[var(--text-muted)]'}`}>
                  {d === 'desktop' ? <MonitorIcon /> : <PhoneIcon />}{d === 'desktop' ? 'Desktop' : 'Mobile'}
                </button>
              ))}
            </div>
          </div>
          {flow ? (
            <FlowShots shots={shown} device={shownDevice} wanted={device} label={area.label} num={num} selected={selected} onPin={(id) => pick(id, 'pin')} scrollRef={shotRef} />
          ) : (
            <PageView device={device} state={located} fallback={fallback} url={area.page?.url || ''} num={num} selected={selected} onPin={(id) => pick(id, 'pin')} scrollRef={shotRef} pageName={area.label.toLowerCase()} />
          )}
        </div>

        {/* the findings */}
        <div className="flex min-w-0 flex-col gap-3 lg:order-1">
          {area.blind && <p className="rounded-[14px] border border-dashed border-[var(--border-strong)] px-4 py-3.5 text-[15px] text-[var(--text-muted)]">{unknownNote(area.id)}</p>}
          {area.fails.length === 0 && !area.blind && <p className="rounded-[14px] bg-[var(--result-pass-bg)] px-4 py-3.5 text-[15px] font-semibold text-[var(--result-pass-fg)]">Nothing to fix here. Well done.</p>}
          {/* every checkpoint, as in the free scan: issues first (by impact), then what passed, then what we couldn't check */}
          {area.fails.map((r) => (
            <Finding key={r.ruleId} r={r} kind="fail" n={num.get(r.ruleId)!} open={open.has(r.ruleId)} active={selected === r.ruleId}
              onToggle={() => { toggle(r.ruleId); pick(r.ruleId, 'list') }} />
          ))}
          {area.passed.map((r) => (
            <Finding key={r.ruleId} r={r} kind="pass" open={open.has(r.ruleId)} active={selected === r.ruleId} onToggle={() => { toggle(r.ruleId); pick(r.ruleId, 'list') }} />
          ))}
          {area.unknown.length > 0 && !area.blind && <p className="pt-2 text-[13px] text-[var(--text-muted)]">We couldn't check these: our scan could not see enough to judge them, so they are left out of your score.</p>}
          {area.unknown.map((r) => (
            <Finding key={r.ruleId} r={r} kind="unknown" open={open.has(r.ruleId)} active={selected === r.ruleId} onToggle={() => { toggle(r.ruleId); pick(r.ruleId, 'list') }} />
          ))}
        </div>
      </div>
    </div>
  )
}

/** The thank-you tab: the upload panel until there are results, then the results like any other part. */
function ThankYouView({ area, thankYou, reportId, reload, device, setDevice, focus }: { area: AreaSummary; thankYou: ThankYou; reportId: string; reload: () => void; device: Device; setDevice: (d: Device) => void; focus: string | null }) {
  const [replacing, setReplacing] = useState(false)
  const has = thankYou.results.length > 0
  if (!has || replacing) {
    return (
      <div className="mx-auto max-w-[1280px] px-[var(--gutter)] pt-8">
        <h1 className="font-[family-name:var(--font-display)] text-[clamp(24px,3vw,32px)] font-bold tracking-[-0.03em] text-[var(--text)]">{area.label}</h1>
        <p className="mt-1 max-w-[720px] text-[15px] text-[var(--text-muted)]">{area.blurb}</p>
        <div className="mt-6 max-w-[860px]">
          <ThankYouUpload reportId={reportId} checks={thankYou.checks} onDone={() => { setReplacing(false); reload() }} onCancel={has ? () => setReplacing(false) : undefined} />
        </div>
      </div>
    )
  }
  return (
    <div>
      <AreaView key={`thankyou-${thankYou.at}`} area={area} device={device} setDevice={setDevice} focus={focus} reportId={reportId} rescansLeft={0} reload={reload} />
      <div className="mx-auto max-w-[1280px] px-[var(--gutter)] pt-4">
        <button type="button" onClick={() => setReplacing(true)} className="text-[14px] text-[var(--text-muted)] underline underline-offset-2 hover:text-[var(--text)]">Upload new screenshots</button>
      </div>
    </div>
  )
}

function unknownNote(area: Area): string {
  if (area === 'checkout') return "We couldn't open your checkout from our scan (often a bot check). These checkpoints stay open: check them by hand, or reply to the report email and we'll look."
  if (area === 'cart') return "We couldn't add your best seller to the cart from our scan. These checkpoints stay open: check them by hand, or reply to the report email and we'll look."
  return 'Our scan could not see enough of this part to judge it.'
}

function FlowShots({ shots, device, wanted, label, num, selected, onPin, scrollRef }: { shots: Shot[]; device: Device; wanted: Device; label: string; num: Map<string, number>; selected: string | null; onPin: (id: string) => void; scrollRef: React.MutableRefObject<HTMLDivElement | null> }) {
  if (!shots.length) return <div className="grid aspect-[4/3] place-items-center rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] text-sm text-[var(--text-muted)]">No screenshot of the {label.toLowerCase()}</div>
  const frame = device === 'desktop'
    ? 'rounded-[var(--radius-lg)] border border-[var(--border-strong)]'
    : 'ml-auto w-full max-w-[340px] rounded-[34px] border-[8px] border-[var(--text)] max-[1023px]:mx-auto'
  return (
    <div>
      {device !== wanted && <p className="mb-2 text-[13px] text-[var(--text-muted)]">Only captured on {device}.</p>}
      <div className={`overflow-hidden bg-[var(--surface)] ${frame}`}>
        <div ref={scrollRef} className={`relative overflow-y-auto ${device === 'desktop' ? 'max-h-[calc(100vh-80px)]' : 'h-[min(680px,calc(100vh-80px))]'} max-[560px]:max-h-[460px]`}>
          {shots.map((s, i) => (
            <div key={i} className="relative border-b border-[var(--border)] last:border-0"
              data-pins={(s.pins || []).map((p) => p.findingId).join(' ')} data-box={JSON.stringify(Object.fromEntries((s.pins || []).map((p) => [p.findingId, p.box])))}>
              <img src={s.url} alt={`Your ${label.toLowerCase()} on ${device}`} className="block w-full" />
              {/* boxes are fractions of the image: a 1 x 1 shot */}
              <PinOverlay shot={{ width: 1, height: 1, pins: s.pins || [] }} num={num} selected={selected} onPin={onPin} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function Finding({ r, n, kind, open, active, onToggle }: { r: Row; n?: number; kind: 'fail' | 'pass' | 'unknown'; open: boolean; active: boolean; onToggle: () => void }) {
  const t = kind === 'pass' ? 'pass' : 'fail'
  return (
    <div id={`f-${r.ruleId}`} className={`scroll-mt-6 rounded-[16px] border px-4 transition-colors ${active || open ? 'border-[var(--border-strong)] bg-[var(--bg-subtle)]' : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-subtle)]'}`}
      style={{ ['--result-fg' as string]: `var(--result-${t}-fg)`, ['--result-bg' as string]: kind === 'unknown' ? 'var(--surface-muted)' : `var(--result-${t}-bg)` }}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 py-4 text-left">
        {kind === 'fail' ? <Num n={n!} /> : kind === 'pass' ? <Pass /> : <Unknown />}
        <span className="min-w-0 flex-1">
          <span className="block font-[family-name:var(--font-display)] text-[16px] font-bold leading-[1.35] tracking-[-0.01em] text-[var(--text)]">{r.ruleTitle}</span>
          {kind === 'fail' && <Meta r={r} />}
        </span>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-[var(--border)]"><ChevronDown className={`h-[18px] w-[18px] text-[var(--text)] transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden /></span>
      </button>
      {open && (
        <div className="border-t border-[var(--border)] pb-4 pt-4">
          <div className="flex flex-col gap-4 rounded-[12px] bg-[var(--result-bg)] p-5">
            <div className="flex flex-col gap-1.5">
              <p className="font-[family-name:var(--font-display)] text-[17px] font-bold" style={{ color: kind === 'unknown' ? 'var(--text-muted)' : 'var(--result-fg)' }}>{kind === 'unknown' ? 'Why we could not check it:' : 'What we saw:'}</p>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text)]">{r.reason}</p>
            </div>
            {r.checkpoint && kind !== 'unknown' && <CheckpointResultBody checkpoint={r.checkpoint} passed={kind === 'pass'} />}
          </div>
          <FlagWrong r={r} verdict={kind} />
        </div>
      )}
    </div>
  )
}

/* ── feedback ───────────────────────────────────────────────────────────── */

const Feedback = createContext<{ reportId: string; tab: string; device: string }>({ reportId: '', tab: '', device: '' })

async function sendFeedback(body: Record<string, string>): Promise<boolean> {
  const r = await fetch(api('/report/feedback'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
  return !!r && r.ok
}

/** Under a checkpoint: the buyer thinks our verdict is wrong. One click, a comment if they want. */
function FlagWrong({ r, verdict }: { r: Row; verdict: string }) {
  const ctx = useContext(Feedback)
  const [state, setState] = useState<'idle' | 'open' | 'sending' | 'sent' | 'error'>('idle')
  const [msg, setMsg] = useState('')
  if (state === 'sent') return <p className="mt-3 text-[13px] text-[var(--text-muted)]">Thanks. We'll check this one by hand and reply by email.</p>
  if (state === 'idle') return (
    <button type="button" onClick={() => setState('open')} className="mt-3 text-[13px] font-medium text-[var(--text-muted)] underline hover:text-[var(--text)]">Is this wrong? Tell us</button>
  )
  const send = async () => {
    setState('sending')
    const ok = await sendFeedback({ reportId: ctx.reportId, kind: 'wrong', message: msg, ruleId: r.ruleId, ruleTitle: r.ruleTitle, area: r.area, verdict, tab: ctx.tab, device: ctx.device })
    setState(ok ? 'sent' : 'error')
  }
  return (
    <div className="mt-3 flex flex-col gap-2">
      <textarea value={msg} onChange={(e) => setMsg(e.target.value)} rows={2} maxLength={2000} placeholder="What did we get wrong? (optional)"
        className="w-full rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[14px] text-[var(--text)] outline-none focus:border-[var(--border-strong)]" />
      <div className="flex items-center gap-3">
        <button type="button" onClick={send} disabled={state === 'sending'} className="cxo-btn cxo-btn-primary !h-auto !px-4 !py-2 text-[13px]">{state === 'sending' ? 'Sending…' : 'Send'}</button>
        <button type="button" onClick={() => setState('idle')} className="text-[13px] text-[var(--text-muted)] underline">Cancel</button>
        {state === 'error' && <span className="text-[13px]" style={{ color: 'var(--result-fail-fg)' }}>Not sent. Try again, or reply to the report email.</span>}
      </div>
    </div>
  )
}


/* ── scan another page ──────────────────────────────────────────────────── */

/** Swap the collection or product page the report scanned for one the buyer picks (3 per report). */
function Rescan({ reportId, page, current, left, reload }: { reportId: string; page: 'category' | 'product'; current: Page; left: number; reload: () => void }) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'error'>('idle')
  const [error, setError] = useState('')
  const what = page === 'category' ? 'collection' : 'product'
  const r = current.rescan
  const running = r && r.status !== 'failed'
  const submit = async () => {
    setState('sending'); setError('')
    const res = await fetch(api(`/report/${reportId}/rescan`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page, url }) }).catch(() => null)
    const d = res ? await res.json().catch(() => ({})) : {}
    if (!res || !res.ok) { setState('error'); setError((d as { error?: string }).error || 'Something went wrong. Try again.'); return }
    setState('idle'); setOpen(false); setUrl(''); reload()
  }
  if (running) return (
    <div className="mt-5 flex items-center gap-3 rounded-[14px] border border-[var(--border)] bg-[var(--bg-subtle)] px-4 py-3 text-[14px] text-[var(--text)]">
      <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[var(--text-muted)] border-t-transparent" aria-hidden />
      <span>Scanning <b>{pathOf(r!.url)}</b>{page === 'product' ? ', with its cart and checkout' : ''}. About 3 minutes: this tab updates by itself. Until then you see the previous page.</span>
    </div>
  )
  return (
    <div className="mt-5 flex flex-col gap-3">
      {r?.status === 'failed' && (
        <p className="rounded-[14px] px-4 py-3 text-[14px]" style={{ background: 'var(--result-fail-bg)', color: 'var(--result-fail-fg)' }}>We couldn't scan {pathOf(r.url)}{r.error ? `: ${r.error}` : '.'} Your previous results stay.</p>
      )}
      {!open ? (
        <p className="text-[14px] text-[var(--text-muted)]">
          {howPicked(current.how)} <b className="text-[var(--text)]">{pathOf(current.url)}</b>.{' '}
          {left > 0 ? <button type="button" onClick={() => setOpen(true)} className="font-semibold text-[var(--text)] underline">Scan another {what}</button> : <span>You have used your 3 page changes.</span>}
        </p>
      ) : (
        <div className="flex max-w-[720px] flex-col gap-2 rounded-[14px] border border-[var(--border)] p-4">
          <label className="text-[14px] font-semibold text-[var(--text)]" htmlFor={`rescan-${page}`}>Which {what} should we scan instead?</label>
          <div className="flex flex-wrap gap-2">
            <input id={`rescan-${page}`} value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && url.trim()) submit() }} placeholder={`Paste the link of a ${what} page from your store`}
              className="min-w-[240px] flex-1 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[15px] text-[var(--text)] outline-none focus:border-[var(--border-strong)]" />
            <button type="button" onClick={submit} disabled={!url.trim() || state === 'sending'} className="cxo-btn cxo-btn-primary !h-auto !py-2.5 disabled:opacity-50">{state === 'sending' ? 'Starting…' : 'Scan this page'}</button>
            <button type="button" onClick={() => { setOpen(false); setError('') }} className="px-2 text-[14px] text-[var(--text-muted)] underline">Cancel</button>
          </div>
          <p className="text-[13px] text-[var(--text-muted)]">About 3 minutes{page === 'product' ? '. The cart, checkout and general elements are rescanned with it' : ''}. {left} of 3 page changes left.</p>
          {state === 'error' && <p className="text-[13px]" style={{ color: 'var(--result-fail-fg)' }}>{error}</p>}
        </div>
      )}
    </div>
  )
}

/** How the scanned page was chosen, in words a buyer understands. */
function howPicked(how: string): string {
  if (how === 'chosen by you') return 'You chose'
  if (how === 'best-selling' || how === 'best seller') return 'We scanned your best seller,'
  if (how === 'catalog' || how === 'page') return 'We scanned the first product of your catalogue,'
  if (how === 'the page you gave us') return 'We scanned the page you gave us,'
  if (how === 'all products') return 'We scanned your all-products page,'
  if (how) return `We scanned the ${how},`
  return 'We scanned'
}

/** Put a checkpoint 24px from the top of the window (desktop: level with the sticky screenshot). */
function alignTop(id: string) {
  const row = document.getElementById(`f-${id}`)
  if (!row) return
  window.scrollTo({ top: window.scrollY + row.getBoundingClientRect().top - 24, behavior: 'smooth' })
}
