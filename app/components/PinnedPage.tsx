// The scanned page with its findings pinned, and the result markers. Shared by the free results
// page (app/results) and the full report (app/report), so both look the same.

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
  const frame =
    device === 'desktop'
      ? 'rounded-[var(--radius-lg)] border border-[var(--border-strong)]'
      : 'ml-auto w-full max-w-[340px] rounded-[34px] border-[8px] border-[var(--text)] max-[1023px]:mx-auto'
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
      <div ref={scrollRef} className={`relative overflow-y-auto ${device === 'desktop' ? 'max-h-[calc(100vh-120px)]' : 'h-[min(680px,calc(100vh-80px))]'} max-[560px]:max-h-[460px]`}>
        {shot ? (
          <div className="relative">
            <img src={shot.screenshot} alt={`Your ${pageName} on ${device}, with the findings pinned`} className="block w-full" />
            <PinOverlay shot={shot} num={num} selected={selected} onPin={onPin} />
          </div>
        ) : (
          <div className="relative">
            {fallback ? (
              <img src={fallback} alt={`Your ${pageName} on ${device}`} className={`block w-full ${state === 'loading' ? 'opacity-60' : ''}`} />
            ) : (
              <div className="grid aspect-[4/3] place-items-center text-sm text-[var(--text-muted)]">{state === 'loading' ? '' : 'Preview unavailable'}</div>
            )}
            {state === 'loading' && (
              <span className="absolute left-1/2 top-24 -translate-x-1/2 whitespace-nowrap rounded-full bg-[var(--surface)] px-4 py-2 text-sm font-semibold text-[var(--text)] shadow-[var(--shadow-raised)]">
                Pinning the findings on your page…
              </span>
            )}
          </div>
        )}
      </div>
    </div>
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
export function PinOverlay({ shot, num, selected, onPin }: { shot: { width: number; height: number; pins: Located['pins'] }; num: Map<string, number>; selected: string | null; onPin: (id: string) => void }) {
  return (
    <>
      {groupPins(shot.pins, num).map((g) => {
              const on = g.items.some((it) => it.id === selected)
              return (
                <span key={g.key}>
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute rounded-[6px] transition-all"
                    style={{
                      left: `${(g.box.x / shot.width) * 100}%`,
                      top: `${(g.box.y / shot.height) * 100}%`,
                      width: `${(g.box.w / shot.width) * 100}%`,
                      height: `${(g.box.h / shot.height) * 100}%`,
                      border: `${on ? 3 : 2}px solid var(--result-fail-fg)`,
                      background: on ? 'color-mix(in srgb, var(--result-fail-fg) 10%, transparent)' : 'transparent',
                    }}
                  />
                  <span
                    className="absolute flex -translate-x-full -translate-y-1/2 gap-1"
                    style={{
                      left: `min(calc(${((g.box.x + g.box.w) / shot.width) * 100}% + 10px), calc(100% - 4px))`,
                      top: `max(${(g.box.y / shot.height) * 100}%, 16px)`,
                      zIndex: on ? 3 : 2,
                    }}
                  >
                    {g.items.map((it) => {
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
                </span>
              )
            })}
    </>
  )
}
