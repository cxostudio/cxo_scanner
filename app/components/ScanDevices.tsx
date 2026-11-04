'use client'

/**
 * The page being scanned, in the same black laptop + phone frames as the results hero
 * (app/results/page.tsx `Devices`), at the same size. The loading screen turns into the
 * results: same devices, same place. Inside each screen: a light grid and a sweeping
 * scan line; a small status chip sits on the laptop screen.
 */

export type InstantPreviewHint = { host: string; faviconUrl: string }

const fade = {
  WebkitMaskImage: 'linear-gradient(180deg, #000 55%, transparent 100%)',
  maskImage: 'linear-gradient(180deg, #000 55%, transparent 100%)',
}

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
  const mobileSrc = mobile || desktop
  return (
    <div className="relative w-full max-[1023px]:h-[360px] max-[560px]:h-[260px] lg:aspect-[21/20] lg:max-h-[780px]" style={fade} aria-hidden>
      <div className="absolute inset-y-0 left-0 right-[14%] overflow-hidden rounded-t-[18px] border-[10px] border-b-0 border-[var(--text)] bg-[var(--text)]">
        <div className="relative h-full overflow-hidden rounded-t-[6px] bg-[var(--surface-muted)]">
          {desktop ? <img src={desktop} alt="" className="block w-full object-cover object-top" /> : <Placeholder hint={instant} />}
          {scanning && <ScanOverlay grid={28} />}
          {scanning && status && (
            <div className="absolute left-3 top-3 z-30 inline-flex max-w-[calc(100%-24px)] items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[12px] font-semibold text-[var(--text)] shadow-[var(--shadow-card)]">
              <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full" style={{ background: 'var(--accent)' }} />
              <span className="truncate">{status}</span>
            </div>
          )}
        </div>
      </div>
      <div className="absolute right-0 top-[18%] w-[30%] min-w-[110px] max-w-[200px]">
        <div className="overflow-hidden rounded-[26px] border-[7px] border-[var(--text)] bg-[var(--text)] shadow-[0_24px_48px_-18px_rgba(9,9,11,.35)]">
          <div className="relative aspect-[9/19] overflow-hidden rounded-[18px] bg-[var(--surface)]">
            {mobileSrc ? <img src={mobileSrc} alt="" className="block w-full object-cover object-top" /> : <Placeholder hint={instant} small />}
            {scanning && <ScanOverlay grid={18} />}
          </div>
        </div>
      </div>
    </div>
  )
}
