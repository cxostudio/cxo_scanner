'use client'

/**
 * The page being scanned, in the same black laptop + phone frames as the results hero
 * (app/results/page.tsx `Devices`). The laptop screen keeps a real 16:10 ratio so the
 * whole group fits one screen with the checklist next to it. Inside each screen: a light grid and a sweeping
 * scan line; a small status chip sits on the laptop screen.
 */

export type InstantPreviewHint = { host: string; faviconUrl: string }


function ScanOverlay({ grid }: { grid: number }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden" aria-hidden>
      <div
        className="absolute inset-0 opacity-[0.22]"
        style={{
          backgroundImage:
            'linear-gradient(color-mix(in srgb, var(--accent) 45%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--accent) 45%, transparent) 1px, transparent 1px)',
          backgroundSize: `${grid}px ${grid}px`,
        }}
      />
      <div className="absolute inset-0" style={{ background: 'color-mix(in srgb, var(--accent) 7%, transparent)' }} />
      <div
        className="ux-ray-scan-line absolute inset-x-0 z-20 h-[3px] rounded-full"
        style={{ background: 'var(--accent)', boxShadow: '0 0 22px color-mix(in srgb, var(--accent) 85%, transparent)' }}
      />
    </div>
  )
}

function Placeholder({ hint, small }: { hint: InstantPreviewHint | null; small?: boolean }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[var(--surface-muted)] px-3">
      {hint && (
        <>
          <img
            src={hint.faviconUrl}
            alt=""
            className={`${small ? 'h-8 w-8' : 'h-12 w-12'} rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] object-contain p-1`}
          />
          {!small && <p className="max-w-[90%] truncate text-center text-xs font-semibold text-[var(--text-muted)]">{hint.host}</p>}
        </>
      )}
    </div>
  )
}

export function ScanDevices({
  desktop,
  mobile,
  instant = null,
  scanning = true,
  status,
}: {
  desktop: string | null
  mobile: string | null
  instant?: InstantPreviewHint | null
  scanning?: boolean
  status?: string
}) {
  const mobileSrc = mobile
  // a laptop screen at a real 16:10 ratio and a phone overlapping its right edge;
  // the box is 5:3, so both devices are fully visible and nothing runs on forever
  return (
    <div className="max-[1023px]:px-2">
      <div className="relative aspect-[5/3] w-full" aria-hidden>
        {/* isolate: the scan line and grid stay inside the laptop, under the phone */}
        <div className="absolute left-0 top-0 isolate z-0 w-[86%]">
          <div className="overflow-hidden rounded-[16px] border-[9px] border-[var(--text)] bg-[var(--text)] max-[560px]:rounded-[10px] max-[560px]:border-[5px]">
            <div className="relative aspect-[16/10] overflow-hidden rounded-[6px] bg-[var(--surface-muted)] max-[560px]:rounded-[4px]">
              {desktop ? <img src={desktop} alt="" className="block w-full object-cover object-top" /> : <Placeholder hint={instant} />}
              {scanning && <ScanOverlay grid={28} />}
              {scanning && status && (
                <div className="absolute left-3 top-3 z-30 inline-flex max-w-[calc(100%-24px)] items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[12px] font-semibold text-[var(--text)] shadow-[var(--shadow-card)] max-[560px]:left-2 max-[560px]:top-2 max-[560px]:px-2.5 max-[560px]:py-1 max-[560px]:text-[11px]">
                  <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full" style={{ background: 'var(--accent)' }} />
                  <span className="truncate">{status}</span>
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="absolute bottom-0 right-0 z-[1] w-[26%]">
          <div className="overflow-hidden rounded-[22px] border-[6px] border-[var(--text)] bg-[var(--text)] shadow-[0_24px_48px_-18px_rgba(9,9,11,.35)] max-[560px]:rounded-[14px] max-[560px]:border-[4px]">
            <div className="relative aspect-[9/19] overflow-hidden rounded-[16px] bg-[var(--surface)] max-[560px]:rounded-[10px]">
              {mobileSrc ? <img src={mobileSrc} alt="" className="block w-full object-cover object-top" /> : <Placeholder hint={instant} small />}
              {scanning && <ScanOverlay grid={18} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
