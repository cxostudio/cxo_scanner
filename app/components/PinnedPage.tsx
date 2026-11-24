// The scanned page with its findings pinned, and the result markers. Shared by the free results
// page (app/results) and the full report (app/report), so both look the same.

import { useEffect, useMemo, useRef, useState } from 'react'

export type Device = 'desktop' | 'mobile'
export type Box = { x: number; y: number; w: number; h: number }
export type Located = { screenshot: string; width: number; height: number; pins: { findingId: string; box: Box }[] }
export type LocateState = Located | 'loading' | 'failed' | null

export function PageView({
  device,
  state,
  fallback,
  url,
  num,
  selected,
  onPin,
  scrollRef,
  pageName = 'product page',
}: {
  device: Device
  state: LocateState
  fallback: string | null
  url: string
  num: Map<string, number>
  selected: string | null
  onPin: (id: string) => void
  scrollRef: React.MutableRefObject<HTMLDivElement | null>
  pageName?: string
}) {
  const shot = state && typeof state === 'object' ? state : null
  // images that finished downloading: until then the spinner stays on
  const [loaded, setLoaded] = useState<Set<string>>(() => new Set())
  const seen = (src: string) => setLoaded((l) => (l.has(src) ? l : new Set(l).add(src)))
  const frame =
    device === 'desktop'
      ? 'rounded-[var(--radius-lg)] border border-[var(--border-strong)]'
      : 'ml-auto w-full max-w-[340px] rounded-[34px] max-[560px]:max-w-[280px] border-[8px] border-[var(--text)] max-[1023px]:mx-auto'
  return (
    <div className={`overflow-hidden bg-[var(--surface)] ${frame}`}>
      {device === 'desktop' && (
        <div className="flex items-center gap-1.5 border-b border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2">
          <span className="h-2 w-2 rounded-full bg-[var(--border-strong)]" />
          <span className="h-2 w-2 rounded-full bg-[var(--border-strong)]" />
          <span className="h-2 w-2 rounded-full bg-[var(--border-strong)]" />
          <span className="ml-2 min-w-0 truncate text-xs text-[var(--text-muted)]">{url}</span>
        </div>
      )}
      <div ref={scrollRef} className={`relative overflow-y-auto ${device === 'desktop' ? 'max-h-[calc(100vh-120px)] max-[560px]:max-h-[460px]' : 'aspect-[9/19.5] max-h-[calc(100vh-80px)]'}`}>
        {shot ? (
          <div className="relative">
            {/* keep the preview under it until the pinned screenshot has downloaded */}
            {!loaded.has(shot.screenshot) && fallback && <img src={fallback} alt="" aria-hidden className="absolute inset-x-0 top-0 block w-full opacity-60" />}
            <img src={shot.screenshot} alt={`Your ${pageName} on ${device}, with the findings pinned`} onLoad={() => seen(shot.screenshot)} className={`relative block w-full ${loaded.has(shot.screenshot) ? '' : 'opacity-0'}`} />
            {loaded.has(shot.screenshot) ? <PinOverlay shot={shot} num={num} selected={selected} onPin={onPin} /> : <LoadingPill label="Pinning the findings on your page…" />}
          </div>
        ) : (
          <div className="relative">
            {fallback ? (
              <img src={fallback} alt={`Your ${pageName} on ${device}`} onLoad={() => seen(fallback)} className={`block w-full transition-opacity ${state === 'loading' || !loaded.has(fallback) ? 'opacity-60' : ''}`} />
            ) : (
              // no picture yet: a grey page shape, so the frame never looks empty or broken
              <div className={`grid aspect-[4/3] place-items-center text-sm text-[var(--text-muted)] ${state === 'loading' ? 'animate-pulse bg-[var(--bg-subtle)]' : ''}`}>{state === 'loading' ? '' : 'Preview unavailable'}</div>
            )}
            {(state === 'loading' || (fallback && !loaded.has(fallback))) && (
              <LoadingPill label={state === 'loading' ? 'Pinning the findings on your page…' : 'Loading your page…'} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** The waiting label on the page picture: a spinner and what we're doing. */
export function LoadingPill({ label, className = 'top-24' }: { label: string; className?: string }) {
  return (
    <span role="status" className={`absolute left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-2.5 whitespace-nowrap rounded-full bg-[var(--surface)] py-2 pl-3 pr-4 text-sm font-semibold text-[var(--text)] shadow-[var(--shadow-raised)] ${className}`}>
      <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--text)]" aria-hidden />
      {label}
    </span>
  )
}

/** Findings pinned on the same element become one group: one outline, numbers side by side. */
export function groupPins(pins: Located['pins'], num: Map<string, number>) {
  const groups = new Map<string, { key: string; box: Box; items: { id: string; n: number }[] }>()
  for (const p of pins) {
    const n = num.get(p.findingId)
    if (!n) continue
    const key = `${p.box.x},${p.box.y},${p.box.w},${p.box.h}`
    if (!groups.has(key)) groups.set(key, { key, box: p.box, items: [] })
    groups.get(key)!.items.push({ id: p.findingId, n })
  }
  return [...groups.values()].map((g) => ({ ...g, items: g.items.sort((a, b) => a.n - b.n) }))
}

export function Num({ n }: { n: number }) {
  return (
    <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full text-xs font-bold" style={{ background: 'var(--result-fail-fg)', color: 'var(--text-inverse)' }} aria-label={`To fix, number ${n}`} role="img">
      {n}
    </span>
  )
}

export function Pass() {
  return (
    <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full" style={{ background: 'var(--result-pass-fg)', color: 'var(--text-inverse)' }} aria-label="Passed" role="img">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m5 12.5 4.5 4.5L19 7.5" />
      </svg>
    </span>
  )
}

export const MonitorIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="4" width="18" height="12" rx="1.5" />
    <path d="M8 20h8M12 16v4" />
  </svg>
)
export const PhoneIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="7" y="2.5" width="10" height="19" rx="2" />
    <path d="M11 18.5h2" />
  </svg>
)
/** The numbered pins and outlines over a screenshot. Boxes are in the shot's own units
 *  (pixels of a page screenshot, or 0-1 fractions with width = height = 1). */
// How pins stay readable when findings sit on the same spot (a cart drawer, a checkout summary):
// 1. Badges that would touch on screen (within one badge of each other) merge into one row of numbers.
// 2. Outlines are drawn only for the finding you picked, or the badge row you hover, never all at once.
// So the page shows a few clean number rows, and one outline at a time.
const BADGE = 30
export function PinOverlay({ shot, num, selected, onPin }: { shot: { width: number; height: number; pins: Located['pins'] }; num: Map<string, number>; selected: string | null; onPin: (id: string) => void }) {
  const ref = useRef<HTMLSpanElement | null>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  useEffect(() => {
    const el = ref.current?.parentElement
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const clusters = useMemo(() => {
    const items = shot.pins
      .map((p) => ({ id: p.findingId, n: num.get(p.findingId) || 0, box: p.box }))
      .filter((it) => it.n)
      .map((it) => {
        const right = ((it.box.x + it.box.w) / shot.width) * (size?.w || 0)
        const top = (it.box.y / shot.height) * (size?.h || 0)
        return { ...it, ax: Math.min(right + 10, (size?.w || 0) - 4), ay: Math.max(top, 16) }
      })
      .sort((a, b) => a.ay - b.ay || a.n - b.n)
    const out: { key: string; ax: number; ay: number; items: typeof items }[] = []
    for (const it of items) {
      const near = size && out.find((c) => Math.abs(c.ay - it.ay) < BADGE && Math.abs(c.ax - it.ax) < BADGE * (c.items.length + 1))
      if (near) {
        near.items.push(it)
        near.ax = Math.max(near.ax, it.ax)
      } else out.push({ key: it.id, ax: it.ax, ay: it.ay, items: [it] })
    }
    return out.map((c) => ({ ...c, items: c.items.sort((a, b) => a.n - b.n) }))
  }, [shot, num, size])

  const outlined = new Set<string>(selected ? [selected] : [])
  for (const c of clusters) if (c.key === hover) c.items.forEach((it) => outlined.add(it.id))
  const pct = (v: number, of: number) => `${(v / of) * 100}%`

  return (
    <span ref={ref} className="contents">
      {size &&
        clusters.flatMap((c) => c.items).filter((it) => outlined.has(it.id)).map((it) => {
          const on = it.id === selected
          return (
            <span
              key={`box-${it.id}`}
              aria-hidden="true"
              className="pointer-events-none absolute rounded-[6px]"
              style={{
                left: pct(it.box.x, shot.width),
                top: pct(it.box.y, shot.height),
                width: pct(it.box.w, shot.width),
                height: pct(it.box.h, shot.height),
                border: `${on ? 3 : 2}px ${on ? 'solid' : 'dashed'} var(--result-fail-fg)`,
                background: on ? 'color-mix(in srgb, var(--result-fail-fg) 10%, transparent)' : 'transparent',
                zIndex: 1,
              }}
            />
          )
        })}
      {size &&
        clusters.map((c) => {
          const on = c.items.some((it) => it.id === selected)
          return (
            <span
              key={c.key}
              className="absolute flex -translate-x-full -translate-y-1/2 gap-1"
              style={{ left: c.ax, top: c.ay, zIndex: on ? 3 : 2 }}
              onMouseEnter={() => setHover(c.key)}
              onMouseLeave={() => setHover((h) => (h === c.key ? null : h))}
            >
              {c.items.map((it) => {
                const sel = it.id === selected
                return (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => onPin(it.id)}
                    aria-label={`Finding ${it.n}`}
                    className="grid shrink-0 place-items-center rounded-full border-[3px] font-bold shadow-[var(--shadow-raised)] transition-transform hover:scale-110"
                    style={{
                      width: sel ? 34 : 28,
                      height: sel ? 34 : 28,
                      fontSize: sel ? 14 : 12,
                      background: 'var(--result-fail-fg)',
                      color: 'var(--text-inverse)',
                      borderColor: 'var(--surface)',
                    }}
                  >
                    {it.n}
                  </button>
                )
              })}
            </span>
          )
        })}
    </span>
  )
}
