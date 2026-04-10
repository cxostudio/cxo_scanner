'use client';

type UxRayLoaderProps = {
  statusText?: string;
  /** Viewport screenshot (data URL) — first paint under the purple overlay */
  previewSrc?: string | null;
};

/**
 * Baymard UX-Ray–inspired capture overlay: purple tint, grid, vertical scan line, bottom toast.
 */
export function UxRayLoader({
  statusText = 'Capturing page screenshots',
  previewSrc,
}: UxRayLoaderProps) {
  return (
    <div className="mx-auto w-full max-w-md sm:max-w-lg">
      <p className="mb-3 text-center text-sm font-medium text-zinc-500">In progress…</p>
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-violet-300/40 bg-zinc-100 shadow-2xl ring-1 ring-black/5">
        {/* Real page viewport (when preview loads) */}
        {previewSrc ? (
          <img
            src={previewSrc}
            alt=""
            className="absolute inset-0 z-0 h-full w-full object-cover object-top"
          />
        ) : (
          <div
            className="absolute inset-0 z-0 bg-gradient-to-b from-zinc-50 via-zinc-100 to-zinc-200"
            aria-hidden
          />
        )}
        {/* Dot grid (like product marketing UI) */}
        <div
          className="pointer-events-none absolute inset-0 z-[1] opacity-[0.35]"
          style={{
            backgroundImage:
              'radial-gradient(circle, rgba(139, 92, 246, 0.35) 1px, transparent 1px)',
            backgroundSize: '14px 14px',
          }}
          aria-hidden
        />
        {/* Fine line grid */}
        <div
          className="pointer-events-none absolute inset-0 z-[1] opacity-25"
          style={{
            backgroundImage:
              'linear-gradient(rgba(139, 92, 246, 0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(139, 92, 246, 0.35) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
          }}
          aria-hidden
        />
        {/* Purple wash */}
        <div
          className="pointer-events-none absolute inset-0 z-[2] bg-violet-600/22"
          aria-hidden
        />
        {/* Scanning beam */}
        <div
          className="ux-ray-scan-line pointer-events-none absolute left-0 right-0 z-[3] h-[3px] rounded-full bg-violet-400 shadow-[0_0_24px_rgba(167,139,250,0.95),0_0_2px_rgba(255,255,255,0.9)]"
          aria-hidden
        />
        {/* Bottom status pill */}
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-[4] flex max-w-[min(100%-2rem,28rem)] -translate-x-1/2 items-center gap-2.5 rounded-full border border-white/10 bg-zinc-950/90 px-4 py-2.5 text-sm text-white shadow-lg backdrop-blur-sm">
          <span
            className="inline-flex h-2 w-2 shrink-0 animate-pulse rounded-full bg-violet-400 shadow-[0_0_12px_rgba(167,139,250,0.9)]"
            aria-hidden
          />
          <span className="truncate font-medium tracking-tight">{statusText}</span>
        </div>
      </div>
    </div>
  );
}
