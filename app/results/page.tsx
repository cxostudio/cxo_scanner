'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { z } from 'zod'
import { CheckpointResultBody } from '../components/CheckpointResultBody'
import { YourPath } from '../components/YourPath'
import { LockedFindings } from '../components/LockedFindings'
import { LockedRow, FullStoreOffer, LockedBlock } from '../components/PitchMockups'
import { api, asset } from '@/lib/base'
import { detectPageTypeFromUrl, type UrlPageType } from '@/lib/conversionCheckpoints/pageType'
import { estimate, eur, type Estimate } from '@/lib/estimate'
import { useOffer } from '../components/useOffer'
import { Segmented } from '../components/Segmented'
import { PageView, LoadingPill, Num, Pass, MonitorIcon, PhoneIcon, type Device, type Located, type LocateState } from '../components/PinnedPage'
import { isQualified, lever, scoreOf, effortLabel, LEVERS, TONE, toneOf, type ScanResult } from '@/lib/report'
import { callLink } from '@/lib/call'

// Calendly once available; until then the existing booking form (same as YourPath)
const CHECKLIST_URL = process.env.NEXT_PUBLIC_CHECKLIST_URL || 'https://cxo.studio/checklist'
// the paid full report (a payment link); until it exists, the full-scan page
const FULL_REPORT_PRICE = process.env.NEXT_PUBLIC_FULL_REPORT_PRICE || ''

const ResultSchema = z.array(
  z.object({
    ruleId: z.string(),
    ruleTitle: z.string(),
    passed: z.boolean(),
    reason: z.string(),
    status: z.enum(['pass', 'fail', 'na', 'unknown']).optional(),
    coveredByShopify: z.boolean().optional(),
    freeScan: z.boolean().optional(),
    checkpoint: z
      .object({
        requiredActions: z.string(),
        justificationsBenefits: z.string(),
        examples: z.array(z.object({ url: z.string(), filename: z.string(), thumbnailUrl: z.string() })),
        priority: z.string().optional(),
        difficulty: z.string().optional(),
        metrics: z.array(z.string()).optional(),
      })
      .optional(),
  }),
)


function hostOf(raw: string) {
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, '')
  } catch {
    return raw
  }
}

/** good / average / weak: green, orange, red (lib/report.ts, shared with the full report and the emails). */
const tone = (ratio: number) => toneOf(ratio * 100)

const PAGE_NAME: Record<UrlPageType, string> = { product: 'Product page', homepage: 'Homepage', category: 'Collection page', other: 'Page' }

const shortEur = (n: number) => (n >= 1000 ? `€${(Math.round(n / 100) / 10).toString().replace(/\.0$/, '')}k` : eur(n))

const Arrow = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m9 18 6-6-6-6" />
  </svg>
)

/** Put a stored scan (opened from the email link, on any device) where this page reads it. */
function hydrate(snap: Record<string, unknown>) {
  const ls = localStorage, ss = sessionStorage
  const put = (k: string, v: unknown) => { try { if (v === null || v === undefined || v === '') ls.removeItem(k); else ls.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)) } catch { /* full */ } }
  // pins and captures belong to whichever scan this browser ran last
  try { Object.keys(ls).filter((k) => k.startsWith('scanLocate')).forEach((k) => ls.removeItem(k)) } catch { /* ignore */ }
  put('scanResults', snap.results); put('scanUrl', snap.scanUrl)
  put('scanRevenue', snap.revenue); put('scanAov', snap.aov); put('scanCr', snap.cr); put('scanLocale', snap.locale)
  put('scanPageChecks', snap.pageChecks ? String(snap.pageChecks) : ''); put('scanResolvedFrom', snap.resolvedFrom); put('scanResolvedHow', snap.resolvedHow); put('scanLabId', snap.labId)
  for (const [k, v] of [['scanPreviewDesktop', snap.previewDesktop], ['scanPreviewMobile', snap.previewMobile], ['lastScreenshot', snap.previewDesktop]] as const) {
    try { if (typeof v === 'string' && v) ss.setItem(k, v); else ss.removeItem(k) } catch { /* ignore */ }
  }
}

/**
 * /results?id=… opens a stored scan (the link in the results email), on any device. While the scan
 * is still finishing on the server, it waits and updates by itself. Without an id, the scan this
 * browser just ran (local storage), as before.
 */
export default function ResultsPage() {
  const [state, setState] = useState<'checking' | 'ready' | 'waiting' | 'missing' | 'failed'>('checking')
  // background scans (URL-first /start): where the scan is, shown while the visitor waits
  const [stage, setStage] = useState('')
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id')
    if (!id) { setState('ready'); return }
    let stop = false
    let tries = 0
    const load = async () => {
      const r = await fetch(api(`/scan/job/${id}`), { cache: 'no-store' }).catch(() => null)
      if (stop) return
      if (!r || r.status === 404) return setState('missing')
      const d = (await r.json().catch(() => ({}))) as { status?: string; snapshot?: Record<string, unknown> | null }
      if (d.status === 'done' && d.snapshot) { hydrate(d.snapshot); return setState('ready') }
      if (d.status === 'failed') return setState('failed')
      setStage(d.status || '')
      setState('waiting')
      if (tries++ < 72) window.setTimeout(load, 5000) // up to 6 minutes
    }
    void load()
    return () => { stop = true }
  }, [])
  if (state === 'ready') return <ResultsView />
  if (state === 'checking') return <main className="min-h-screen bg-[var(--bg-subtle)]" />
  const msg = {
    waiting: {
      h: 'Your results are almost ready',
      p: stage === 'capturing'
        ? 'We are taking screenshots of your page on desktop and mobile. This page updates by itself.'
        : stage === 'captured' || stage === 'judging'
          ? 'We are checking your page against our conversion checkpoints. This page updates by itself, it usually takes under a minute.'
          : 'We are finishing the scan of your page. This page updates by itself, it usually takes about a minute.',
    },
    missing: { h: 'This link has expired', p: 'Scan results are kept for 12 months. Run a new free scan to see where your page leaks revenue today.' },
    failed: { h: 'We couldn’t finish this scan', p: 'Some pages block automated visits or take too long to load. Run a new scan, or try another product page.' },
  }[state]
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg-subtle)] px-4">
      <div className="w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-8 text-center shadow-[var(--shadow-raised)]">
        {state === 'waiting' && <div className="mx-auto mb-5 h-8 w-8 animate-spin rounded-full border-[3px] border-[var(--border)] border-t-[var(--text)]" aria-hidden="true" />}
        <h1 className="font-[var(--font-display)] text-xl font-bold text-[var(--text)]">{msg.h}</h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">{msg.p}</p>
        {state !== 'waiting' && <a href="https://cxo.studio/start" className="cxo-btn cxo-btn-primary mt-6 inline-flex">Run a free scan</a>}
      </div>
    </main>
  )
}

function ResultsView() {
  const [results, setResults] = useState<ScanResult[] | null>(null)
  const [url, setUrl] = useState('')
  const [email, setEmail] = useState('')
  const [pageTotal, setPageTotal] = useState(0)
  const [numbers, setNumbers] = useState<Estimate | null>(null)
  const [revenueBand, setRevenueBand] = useState('')
  const [preview, setPreview] = useState<{ desktop: string | null; mobile: string | null }>({ desktop: null, mobile: null })
  const [located, setLocated] = useState<Record<Device, LocateState>>({ desktop: null, mobile: null })
  const [device, setDevice] = useState<Device>('desktop')
  const [selected, setSelected] = useState<string | null>(null)
  // phones: the check of the pin just tapped moves to the top of the list (keeps its number)
  const [lead, setLead] = useState<string | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [visible, setVisible] = useState(10)
  // pitch mockups for the free scan: '' (current), 'b' (locked rows in the list), 'cd' (findings free, fixes and the rest of the store paid)
  const [gate, setGate] = useState<'' | 'b' | 'cd'>('cd')
  const [labId, setLabId] = useState<string | null>(null)
  // the 1-hour offer after the first free scan (server-side; lab scans see the regular price)
  const offer = useOffer(email, !labId)
  // can the full report check this store's cart and checkout? (lib/fullReport/eligible): if not, we don't sell it
  const [reportOk, setReportOk] = useState<boolean | null>(null)
  useEffect(() => {
    if (!url) return
    fetch(api(`/report/eligible?url=${encodeURIComponent(url)}`)).then((r) => r.json()).then((d) => setReportOk(d.ok !== false)).catch(() => setReportOk(true))
  }, [url])
  const shotRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    try {
      const rev = localStorage.getItem('scanRevenue') || ''
      setRevenueBand(rev)
      setNumbers(estimate(rev, localStorage.getItem('scanAov') || '', localStorage.getItem('scanCr') || ''))
      setUrl(localStorage.getItem('scanUrl') || '')
      setEmail(localStorage.getItem('scanEmail') || '')
      setPageTotal(Number(localStorage.getItem('scanPageChecks') || 0))
      // the free scan is counted against every Live check on the store (the full report), never per page
      fetch(api('/report-coverage?lite=1')).then((r) => r.json()).then((c: { total?: number }) => c?.total && setPageTotal(c.total)).catch(() => {})
      setLabId(localStorage.getItem('scanLabId'))
      const g = new URLSearchParams(window.location.search).get('gate')
      if (g === 'b' || g === 'cd') setGate(g)
      else if (g === 'a') setGate('')
      const raw = localStorage.getItem('scanResults')
      if (raw) {
        const parsed = ResultSchema.parse(JSON.parse(raw))
        // findings first, high priority then easiest first; passed checks after
        const eff = (r: ScanResult) => ({ Easy: 0, Moderate: 1, Difficult: 2 })[r.checkpoint?.difficulty || ''] ?? 1
        const rank = (r: ScanResult) => (r.passed ? 100 : 0) + (r.checkpoint?.priority === 'High' ? 0 : 10) + eff(r)
        setResults([...parsed].sort((a, b) => rank(a) - rank(b)))
      }
      const s = (k: string) => sessionStorage.getItem(k) ?? localStorage.getItem(k)
      setPreview({ desktop: s('scanPreviewDesktop') || sessionStorage.getItem('lastScreenshot'), mobile: s('scanPreviewMobile') })
      if (window.matchMedia('(max-width: 810px)').matches) setDevice('mobile')
    } catch (e) {
      console.error('Error loading scan results:', e)
      setResults(null)
    }
  }, [])

  // place the findings on the page (app/api/locate), desktop and phone in parallel, cached per URL
  useEffect(() => {
    if (!results || !url) return
    const failed = results.filter((r) => !r.passed && r.status !== 'unknown')
    if (!failed.length) return
    const ctrls: AbortController[] = []
    ;(['desktop', 'mobile'] as Device[]).forEach((d) => {
      // v3: drops copies saved before the full-page capture fix. Each new scan clears these too
      // (app/run), so a saved copy only serves reloads of the same results.
      const key = `scanLocate:v3:${d}`
      try {
        const cached = JSON.parse(localStorage.getItem(key) || 'null') as { url: string; data: Located } | null
        if (cached?.url === url && cached.data?.screenshot && cached.data.pins?.length) {
          setLocated((p) => ({ ...p, [d]: cached.data }))
          return
        }
      } catch {}
      setLocated((p) => ({ ...p, [d]: 'loading' }))
      const ctrl = new AbortController()
      ctrls.push(ctrl)
      fetch(api('/locate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, device: d, findings: failed.map((r) => ({ id: r.ruleId, title: r.ruleTitle, reason: r.reason })) }),
        signal: ctrl.signal,
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((data: Located) => {
          setLocated((p) => ({ ...p, [d]: data }))
          try {
            localStorage.setItem(key, JSON.stringify({ url, data }))
          } catch {}
        })
        .catch((e) => {
          if ((e as Error).name !== 'AbortError') setLocated((p) => ({ ...p, [d]: 'failed' }))
        })
    })
    return () => ctrls.forEach((c) => c.abort())
  }, [results, url])

  const report = useMemo(() => {
    if (!results) return null
    // free scan: only the checkpoints ticked "Free scan" are shown; the other findings are counted and locked
    // (test scans from the lab show everything)
    const free = !labId && results.some((r) => r.freeScan)
    const shown = free ? results.filter((r) => r.freeScan) : results
    // a free scan judges only the free checks: the page's other Live checks were not run. Their issues
    // are counted (never named, never guessed as issues) and shown as one locked block.
    const freeOnly = free && results.every((r) => r.freeScan) && pageTotal > results.length
    const remaining = freeOnly ? pageTotal - results.length : 0
    // one locked block, right after the free findings (before the passed checks)
    const teaser: ScanResult[] = remaining > 0 ? [{ ruleId: 'teaser-block', ruleTitle: '', passed: false, reason: '', status: 'fail' } as unknown as ScanResult] : []
    const locked = free ? (freeOnly ? teaser : results.filter((r) => !r.freeScan && r.status === 'fail')) : []
    const lockedIssues = locked.length
    // "couldn't check" answers are never shown as failures or counted in the score
    const unknown = shown.filter((r) => r.status === 'unknown').length
    const scored = shown.filter((r) => r.status !== 'unknown')
    const failed = scored.filter((r) => !r.passed)
    // shown apart from real passes: "not relevant for your store" and "covered by Shopify"
    const notRelevant = scored.filter((r) => r.status === 'na').length
    const byShopify = scored.filter((r) => r.coveredByShopify).length
    const base = scored.filter((r) => r.status !== 'na' && !r.coveredByShopify)
    const lockedIds = new Set(locked.map((r) => r.ruleId))
    const rank = (r: ScanResult) => (r.checkpoint?.priority === 'High' ? 0 : r.checkpoint?.priority === 'Medium' ? 1 : 2)
    const fails = base.filter((r) => !r.passed).sort((a, b) => rank(a) - rank(b))
    // free-only scan: the blurred rows sit after the first three findings, where they are seen
    const listed =
      free && gate
        ? freeOnly
          ? [...fails, ...locked, ...base.filter((r) => r.passed)]
          : [...[...fails, ...locked].sort((a, b) => rank(a) - rank(b)), ...base.filter((r) => r.passed)]
        : base
    const areas = LEVERS.map((l) => {
      const items = scored.filter((r) => lever(r) === l.id)
      return { ...l, total: items.length, passed: items.filter((r) => r.passed).length }
    }).filter((l) => l.total > 0)
    // one number per finding, in the order the list shows them
    const num = new Map(listed.filter((r) => !r.passed && !r.ruleId.startsWith('teaser-') && !locked.includes(r)).map((r, i) => [r.ruleId, i + 1]))
    const easyHigh = failed.filter((r) => r.checkpoint?.priority === 'High' && r.checkpoint?.difficulty === 'Easy').length
    const extra = free && gate ? (freeOnly ? 0 : locked.length) : 0
    // one set of numbers everywhere: every check run on this page, the free ones explained,
    // the locked findings counted, and the rest (passed or not relevant) waiting in the full report
    const pageChecks = free && gate ? (freeOnly ? pageTotal : results.length) : scored.length + unknown
    const hidden = free && gate ? (freeOnly ? remaining : results.length - shown.length - locked.length) : 0
    return { free: free && Boolean(gate), freeOnly, remaining, freeRun: results.length, pageChecks, hidden, toFix: failed.length + extra, checked: pageChecks, lockedIds, rows: listed, failed, passed: base.length - failed.length, total: scored.length + unknown, unknown, notRelevant, byShopify, score: scoreOf(scored), areas, num, easyHigh, lockedIssues, locked }
  }, [results, labId, gate, pageTotal])

  const host = hostOf(url)
  const ls = (k: string) => { try { return typeof window !== 'undefined' ? localStorage.getItem(k) || '' : '' } catch { return '' } }
  const buyUrl = reportOk === false ? '' : api(`/checkout?${new URLSearchParams({ url, email, lab: labId || '', back: typeof window !== 'undefined' ? window.location.origin : '', revenue: revenueBand, aov: ls('scanAov'), cr: ls('scanCr'), locale: ls('scanLocale') || 'en' })}`)
  const pageName = PAGE_NAME[detectPageTypeFromUrl(/^https?:\/\//i.test(url) ? url : `https://${url}`)]
  const qualified = isQualified(revenueBand)
  const view = located[device]
  const shot = view && typeof view === 'object' ? view : null

  // checks stack: each opens and closes on its own, the page doesn't jump
  const toggle = (id: string) => setOpen((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  // a pin opens its check, a check shows its pin: both end up side by side at the top
  // (the check at the sticky offset, the pin's element at the top of the page view)
  const STICKY_TOP = 24
  const pick = (id: string, from: 'pin' | 'list') => {
    setSelected(id)
    if (!results) return
    if (from === 'pin') {
      setLead(window.matchMedia('(min-width: 1024px)').matches ? null : id)
      const idx = results.findIndex((r) => r.ruleId === id)
      if (idx >= visible) setVisible(idx + 1)
      setOpen((prev) => new Set(prev).add(id))
    }
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const row = document.getElementById(`f-${id}`)
        // only a pin click moves the page (to its check); a list click leaves the page where it is
        if (row && from === 'pin') {
          if (window.matchMedia('(min-width: 1024px)').matches) window.scrollTo({ top: window.scrollY + row.getBoundingClientRect().top - STICKY_TOP, behavior: 'smooth' })
          else row.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
        const el = shotRef.current
        const pin = shot?.pins.find((p) => p.findingId === id)
        const img = el?.querySelector('img')
        if (el && pin && shot && img) {
          const y = (pin.box.y / shot.height) * img.offsetHeight - 16
          el.scrollTo({ top: Math.max(0, y), behavior: 'smooth' })
        }
      }),
    )
  }

  if (!results || !report) {
    return (
      <main className="cxo-page">
        <a className="cxo-logo" href="https://cxo.studio" aria-label="CXO studio">
          <img src={asset('/cxo-logo.png')} alt="CXO studio" />
        </a>
        <div className="cxo-head">
          <h1 className="cxo-reveal">No scan yet</h1>
          <p className="cxo-reveal cxo-reveal-1">Start from the questions and we’ll scan your product page.</p>
        </div>
        <div className="mx-auto max-w-[420px]">
          <a className="cxo-btn cxo-btn-primary cxo-btn-block" href="https://cxo.studio/start">
            Find my revenue leaks
          </a>
        </div>
      </main>
    )
  }

  const scoreTone = TONE[tone(report.score / 100)]
  const deskImg = (located.desktop && typeof located.desktop === 'object' ? located.desktop.screenshot : null) || preview.desktop
  const phoneImg = (located.mobile && typeof located.mobile === 'object' ? located.mobile.screenshot : null) || preview.mobile

  // score + the four areas, compact
  const scoreBlock = (
    <div className="flex flex-wrap items-center gap-6 border-y border-[var(--border)] py-5">
      <div className="flex items-center gap-4">
        <Ring score={report.score} color={scoreTone.fg} />
        <div>
          <p className="text-[13px] font-semibold text-[var(--text-muted)]">Conversion score</p>
          <p className="font-[family-name:var(--font-display)] text-[20px] font-bold" style={{ color: scoreTone.fg }}>
            {scoreTone.word}
          </p>
        </div>
      </div>
      <div className="grid min-w-[240px] flex-1 grid-cols-2 gap-x-5 gap-y-3">
        {report.areas.map((a) => {
          const t = TONE[tone(a.passed / a.total)]
          return (
            <div key={a.id} className="min-w-0">
              <div className="flex items-baseline justify-between gap-2 text-[13px]">
                <span className="truncate font-semibold text-[var(--text)]" title={a.label}>{a.short}</span>
                <span className="tabular-nums font-semibold" style={{ color: t.fg }}>
                  {a.passed}/{a.total}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--surface-muted)]">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: t.fg }}
                  initial={{ width: 0 }}
                  animate={{ width: `${(a.passed / a.total) * 100}%` }}
                  transition={{ duration: 1.2, ease: [0.4, 0, 0.2, 1] }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )

  return (
    <main className="cxo-page-in cxo-results min-h-screen">
      {/* test scans only (CXO studio and +test emails): label this scan blind in the lab */}
      {labId && (
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-[var(--surface-muted)] px-[var(--gutter)] py-2.5 text-sm text-[var(--text)]">
          <span>Test scan: Live and Draft checkpoints, saved to the lab.</span>
          <Link href={`/lab/${labId}`} className="font-semibold underline">
            Label it blind
          </Link>
        </div>
      )}
      {/* ── top: on the brand wash ───────────────────────────────────────── */}
      <div className="flex flex-col px-[var(--gutter)] pt-[34px] max-[560px]:pt-[26px] lg:min-h-[min(90vh,860px)]">
        <a className="cxo-logo !mb-10" href="https://cxo.studio" aria-label="CXO studio">
          <img src={asset('/cxo-logo.png')} alt="CXO studio" />
        </a>

        <section className="mx-auto grid w-full max-w-[1280px] items-stretch gap-10 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-16 lg:pb-6" aria-label="Verdict">
          <div className="cxo-reveal flex min-w-0 flex-col justify-center gap-6">
            <p className="text-sm font-semibold text-[var(--text-muted)]">
              {host}
              {/* phone: the domain only, to save room */}
              <span className="max-[560px]:hidden"> · {pageName} · {report.freeOnly ? `${report.freeRun} of ${report.pageChecks} store checkpoints run` : `${report.pageChecks} checkpoints`}</span>
            </p>
            <h1 className="font-[family-name:var(--font-display)] text-[clamp(30px,4.2vw,48px)] font-bold leading-[1.1] tracking-[-0.035em] text-[var(--text)]">
              {numbers ? (
                <>
                  Your {pageName.toLowerCase()} leaves about <span style={{ color: 'var(--result-fail-fg)' }}>{shortEur(numbers.lift10)} per month</span> on the table
                </>
              ) : (
                <>Your {pageName.toLowerCase()} has {report.toFix} things to fix</>
              )}
            </h1>
            <p className="text-[17px] leading-[1.6] text-[var(--text-muted)]">
              {report.freeOnly
                ? <>
                    <span className="max-[560px]:hidden">{`We ran ${report.freeRun} checkpoints on your ${pageName.toLowerCase()} and found ${report.failed.length} ${report.failed.length === 1 ? 'issue' : 'issues'}, with the fix for each below. Start with these. For the full picture, the full report runs all ${report.pageChecks} checkpoints on your store, from the homepage to the checkout.`}</span>
                    {/* phone: three lines at most */}
                    <span className="hidden max-[560px]:inline">{`We ran ${report.freeRun} checkpoints on your ${pageName.toLowerCase()} and found ${report.failed.length} ${report.failed.length === 1 ? 'issue' : 'issues'}, with the fix for each below.`}</span>
                  </>
                : `${report.toFix} of ${report.checked} checkpoints failed`}
              {report.freeOnly ? '' : report.free
                ? `. The fix for ${report.failed.length} of them is below${report.easyHigh > 0 ? `, ${report.easyHigh} high-impact and easy: start there` : ''}.`
                : report.easyHigh > 0 ? `, ${report.easyHigh} of them high-impact and easy. Start there.` : '.'}
              
            </p>

            {scoreBlock}

          </div>

          <Devices desktop={deskImg} mobile={phoneImg} pinning={located.desktop === 'loading' || located.mobile === 'loading'} />
        </section>
      </div>

      {/* ── the rest: plain white, like the website ─────────────────────── */}
      <div className="relative mt-6 bg-[var(--surface)]">
        <div aria-hidden="true" className="absolute inset-x-0 -top-24 h-24 bg-gradient-to-b from-transparent to-[var(--surface)]" />
        <div className="relative mx-auto flex max-w-[calc(1280px+2*var(--gutter))] flex-col gap-[var(--space-20)] px-[var(--gutter)] pb-[var(--section-y)] pt-8 max-[560px]:gap-14">
          {/* every check, next to the page it was checked on */}
          <section id="checks" className="scroll-mt-6" aria-label="Your page, check by check">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="font-[family-name:var(--font-display)] text-[28px] font-bold tracking-[-0.03em] text-[var(--text)]">Your page, check by check</h2>
                <p className="mt-1 text-sm text-[var(--text-muted)]">
                  <span className="font-semibold" style={{ color: 'var(--result-fail-fg)' }}>
                    {report.freeOnly ? report.failed.length : report.toFix} to fix
                  </span>{' '}
                  ·{' '}
                  <span className="font-semibold" style={{ color: 'var(--result-pass-fg)' }}>
                    {report.passed} passed
                  </span>
                  {report.byShopify > 0 && ` · ${report.byShopify} covered by Shopify`}
                  {report.notRelevant > 0 && ` · ${report.notRelevant} not relevant for your store`}
                  {report.unknown > 0 && ` · ${report.unknown} we couldn’t check`}
                  {/* phone: what was found only */}
                  <span className="max-[560px]:hidden">
                    {report.freeOnly ? ` · ${report.remaining} more checkpoints in the full report` : report.hidden > 0 && ` · ${report.hidden} more in the full report`}
                    {shot && shot.pins.length > 0 && ` · ${shot.pins.length} pinned on your page`}
                  </span>
                </p>
              </div>
              <Segmented label="Device" size="sm" fill value={device} onChange={setDevice}
              items={[{ id: 'desktop', label: <><MonitorIcon />Desktop</> }, { id: 'mobile', label: <><PhoneIcon />Mobile</> }]} />
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              {/* the page with pins: first on phones, sticky on desktop */}
              <div className="min-w-0 lg:sticky lg:top-6 lg:order-2 lg:self-start">
                <PageView
                  device={device}
                  state={view}
                  fallback={device === 'desktop' ? preview.desktop : preview.mobile}
                  url={url}
                  num={report.num}
                  selected={selected}
                  onPin={(id) => pick(id, 'pin')}
                  scrollRef={shotRef}
                />
              </div>

              <div className="min-w-0 lg:order-1">
                <div className="relative">
                <div className="flex flex-col gap-3">
                  {report.rows.slice(0, visible).map((r) => {
                    if (r.ruleId === 'teaser-block' && gate) return <LockedBlock key={r.ruleId} count={report.remaining} pageName={pageName} buyUrl={buyUrl} price={offer.price} offer={offer} />
                    if (report.lockedIds.has(r.ruleId) && gate)
                      return <LockedRow key={r.ruleId} r={r} variant={gate} open={open.has(r.ruleId)} onToggle={() => toggle(r.ruleId)} buyUrl={buyUrl} price={offer.price} />
                    const isOpen = open.has(r.ruleId)
                    const t = r.passed ? 'pass' : 'fail'
                    const n = report.num.get(r.ruleId)
                    const active = selected === r.ruleId
                    return (
                      <div
                        key={r.ruleId}
                        id={`f-${r.ruleId}`}
                        className={`scroll-mt-6 rounded-[16px] border px-4 transition-colors ${lead === r.ruleId ? 'max-[1023px]:order-first' : ''} ${active || isOpen ? 'border-[var(--border-strong)] bg-[var(--bg-subtle)]' : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-subtle)]'}`}
                        style={{ ['--result-fg' as string]: `var(--result-${t}-fg)`, ['--result-bg' as string]: `var(--result-${t}-bg)` }}
                      >
                        <button
                          type="button"
                          className="flex w-full items-center gap-3 py-4 text-left"
                          onClick={() => {
                            toggle(r.ruleId)
                            if (!r.passed) pick(r.ruleId, 'list')
                          }}
                          aria-expanded={isOpen}
                        >
                          {r.passed ? <Pass /> : <Num n={n!} />}
                          <span className="min-w-0 flex-1 font-[family-name:var(--font-display)] text-[16px] font-bold leading-[1.35] tracking-[-0.01em] text-[var(--text)]">{r.ruleTitle}</span>
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-[var(--border)]">
                            <ChevronDown className={`h-[18px] w-[18px] text-[var(--text)] transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden />
                          </span>
                        </button>
                        {isOpen && (
                          <div className="border-t border-[var(--border)] pb-4 pt-4">
                            <div className="flex flex-col gap-4 rounded-[12px] bg-[var(--result-bg)] p-5">
                              <div className="flex flex-col gap-1.5">
                                <p className="font-[family-name:var(--font-display)] text-[17px] font-bold text-[var(--result-fg)]">What we saw:</p>
                                <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text)]">{r.reason}</p>
                              </div>
                              {r.checkpoint && <CheckpointResultBody checkpoint={r.checkpoint} passed={r.passed} />}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
                {visible < report.rows.length && (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-36 items-end justify-center bg-gradient-to-b from-transparent to-[var(--surface)]">
                    <button type="button" onClick={() => setVisible((v) => v + 12)} className="cxo-btn cxo-btn-primary pointer-events-auto !px-7">
                      Load more results
                    </button>
                  </div>
                )}
                </div>
                {/* free scan: the other findings exist but stay in the full report */}
                {/* free scan: this section only gives the findings; the report is pitched in "What's next" */}
                {gate && report.freeOnly ? null : gate ? (
                  <FullStoreOffer variant={gate} pageKey={detectPageTypeFromUrl(/^https?:\/\//i.test(url) ? url : `https://${url}`)} toFix={report.toFix} fixesShown={report.failed.length} lockedCount={report.freeOnly ? report.remaining : report.locked.length} estimated={report.freeOnly} freeRun={report.freeRun} ran={results.map((r) => ({ id: r.ruleId, failed: r.status === 'fail' }))} qualified={qualified} buyUrl={buyUrl} callUrl={callLink({ source: 'free-scan', email, store: url })} price={offer.price} offer={offer} />
                ) : (
                <LockedFindings
                  locked={report.locked}
                  qualified={qualified}
                  monthlyAtStake={numbers ? numbers.lift10 : null}
                  shortEur={shortEur}
                  buyUrl={buyUrl}
                  callUrl={callLink({ source: 'free-scan', email, store: url })}
                  price={FULL_REPORT_PRICE}
                />
                )}
              </div>
            </div>
          </section>

          {/* what fixing it is worth, and the path from today's scan */}
          <YourPath
            money={numbers}
            qualified={qualified}
            checked={report ? (report.freeOnly ? report.freeRun : report.checked) : 0}
            total={report?.freeOnly ? report.pageChecks : 0}
            toFix={report ? (report.freeOnly ? report.failed.length : report.toFix) : 0}
            eur={eur}
            shortEur={shortEur}
            callUrl={callLink({ source: 'free-scan', email, store: url })}
            fullScanUrl={buyUrl}
            price={offer.price}
            host={host}
            offerSlot={
              gate && report?.freeOnly ? (
                <FullStoreOffer embedded variant="cd" pageKey={detectPageTypeFromUrl(/^https?:\/\//i.test(url) ? url : `https://${url}`)} toFix={report.toFix} lockedCount={report.remaining} estimated freeRun={report.freeRun} ran={results.map((r) => ({ id: r.ruleId, failed: r.status === 'fail' }))} qualified={qualified} buyUrl={buyUrl} callUrl={callLink({ source: 'free-scan', email, store: url })} price={offer.price} offer={offer} />
              ) : undefined
            }
            laptop={
              report?.freeOnly
                ? {
                    shot: located.desktop && typeof located.desktop === 'object' ? { ...located.desktop, pins: located.desktop.pins.map((p) => ({ box: p.box, n: report.num.get(p.findingId) })) } : null,
                    fallback: deskImg || '',
                    passed: results.filter((r) => r.status === 'pass').length,
                  }
                : undefined
            }
          />
        </div>
      </div>
    </main>
  )
}

/* ── pieces ──────────────────────────────────────────────────────────── */

function Ring({ score, color }: { score: number; color: string }) {
  const r = 30
  const c = 2 * Math.PI * r
  return (
    <div className="relative h-[76px] w-[76px] shrink-0">
      <svg width="76" height="76" viewBox="0 0 76 76" role="img" aria-label={`Conversion score ${score} out of 100`}>
        <circle cx="38" cy="38" r={r} fill="none" strokeWidth="7" style={{ stroke: 'var(--surface-muted)' }} />
        <motion.circle
          cx="38"
          cy="38"
          r={r}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          transform="rotate(-90 38 38)"
          style={{ stroke: color }}
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - score / 100) }}
          transition={{ duration: 1.4, ease: [0.4, 0, 0.2, 1] }}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center font-[family-name:var(--font-display)] text-[24px] font-extrabold tracking-[-0.03em] text-[var(--text)]">{score}</span>
    </div>
  )
}

/**
 * The scanned page in a laptop and a phone. As tall as the verdict next to it, and the
 * whole group fades out at the bottom together, so the phone never turns see-through
 * over the laptop.
 */
function Devices({ desktop, mobile, pinning }: { desktop: string | null; mobile: string | null; pinning: boolean }) {
  // the first screen arrives first, the full page a few seconds later: say it is still coming
  const [loaded, setLoaded] = useState<Set<string>>(() => new Set())
  const seen = (src: string) => setLoaded((l) => (l.has(src) ? l : new Set(l).add(src)))
  const waiting = pinning || !desktop || !loaded.has(desktop) || (!!mobile && !loaded.has(mobile))
  const fade = { WebkitMaskImage: 'linear-gradient(180deg, #000 55%, transparent 100%)', maskImage: 'linear-gradient(180deg, #000 55%, transparent 100%)' }
  return (
    <div className="cxo-reveal cxo-reveal-1 relative w-full max-[1023px]:h-[360px] max-[560px]:h-[260px] lg:aspect-[21/20] lg:max-h-[780px]" style={fade} aria-hidden={!desktop && !mobile}>
      <div className="absolute inset-y-0 left-0 right-[14%] overflow-hidden rounded-t-[18px] border-[10px] border-b-0 border-[var(--text)] bg-[var(--text)]">
        <div className="h-full overflow-hidden rounded-t-[6px] bg-[var(--surface-muted)]">
          {desktop ? <img src={desktop} alt="Your product page on desktop" onLoad={() => seen(desktop)} className="block w-full object-cover object-top" /> : <div className="h-full w-full animate-pulse bg-[var(--bg-subtle)]" />}
        </div>
        {waiting && <LoadingPill label={pinning ? 'Loading your full page…' : 'Loading your page…'} className="top-[46%] max-[560px]:top-[40%]" />}
      </div>
      {mobile && (
        <div className="absolute right-0 top-[18%] w-[30%] min-w-[110px] max-w-[200px]">
          <div className="overflow-hidden rounded-[26px] border-[7px] border-[var(--text)] bg-[var(--text)] shadow-[0_24px_48px_-18px_rgba(9,9,11,.35)]">
            <div className="aspect-[9/19] overflow-hidden rounded-[18px] bg-[var(--surface)]">
              <img src={mobile} alt="Your product page on a phone" onLoad={() => seen(mobile)} className="block w-full object-cover object-top" />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
