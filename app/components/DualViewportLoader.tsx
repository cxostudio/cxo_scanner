'use client';

type DualViewportLoaderProps = {
  /** null = empty pane while URL capture is in flight */
  previewDesktop: string | null;
  statusText?: string;
  scanning?: boolean;
};

/** Desktop-only browser mockup with optional UX-Ray scan overlay on the viewport. */
export function DualViewportLoader({
  previewDesktop,
  statusText = 'Capturing page screenshots',
  scanning = true,
}: DualViewportLoaderProps) {
  const desktopReady = previewDesktop != null && previewDesktop.length > 0;

  return (
    <div className="mx-auto w-full max-w-5xl px-3 sm:px-4">
      {scanning ? (
        <p className="mb-5 text-center text-sm font-medium text-zinc-500">In progress…</p>
      ) : (
        <p className="mb-5 text-center text-sm font-medium text-zinc-600">Desktop preview</p>
      )}

      <div className="mx-auto flex min-h-[min(52vw,22rem)] w-full max-w-4xl justify-center pb-4 sm:min-h-[26rem]">
        <div className="relative inline-flex min-h-[min(52vw,22rem)] items-center justify-center sm:min-h-[26rem]">
          <div className="relative z-0 w-[min(100%,32rem)] shrink-0 overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-[0_20px_60px_-12px_rgba(0,0,0,0.2),0_8px_24px_-8px_rgba(0,0,0,0.12)] ring-1 ring-black/[0.05] sm:w-[36rem]">
            <div className="flex h-9 items-center gap-2 border-b border-zinc-200 bg-zinc-100/95 px-3">
              <span className="h-3 w-3 rounded-full bg-[#ff5f57]" aria-hidden />
              <span className="h-3 w-3 rounded-full bg-[#febc2e]" aria-hidden />
              <span className="h-3 w-3 rounded-full bg-[#28c840]" aria-hidden />
            </div>
            <div className="relative aspect-16/10 w-full overflow-hidden bg-zinc-100">
              {desktopReady ? (
                <img
                  src={previewDesktop!}
                  alt=""
                  className="absolute inset-0 z-0 h-full w-full object-cover object-top"
                />
              ) : (
                <div
                  className="absolute inset-0 z-0 bg-gradient-to-b from-zinc-50 via-zinc-100 to-zinc-200"
                  aria-hidden
                />
              )}
              {scanning && (
                <div
                  className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
                  aria-hidden
                >
                  <div
                    className="absolute inset-0 opacity-[0.26]"
                    style={{
                      backgroundImage:
                        'radial-gradient(circle, rgba(139, 92, 246, 0.4) 1px, transparent 1px)',
                      backgroundSize: '14px 14px',
                    }}
                  />
                  <div
                    className="absolute inset-0 opacity-[0.18]"
                    style={{
                      backgroundImage:
                        'linear-gradient(rgba(139, 92, 246, 0.32) 1px, transparent 1px), linear-gradient(90deg, rgba(139, 92, 246, 0.32) 1px, transparent 1px)',
                      backgroundSize: '28px 28px',
                    }}
                  />
                  <div className="absolute inset-0 bg-violet-600/14" />
                  <div className="ux-ray-scan-line absolute inset-x-0 z-20 h-[3px] rounded-full bg-violet-400 shadow-[0_0_24px_rgba(167,139,250,0.95),0_0_2px_rgba(255,255,255,0.9)]" />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {scanning && (
        <div className="pointer-events-none mx-auto mt-8 flex max-w-md justify-center">
          <div className="flex max-w-[min(100%-1rem,28rem)] items-center gap-2.5 rounded-full border border-white/10 bg-zinc-950/90 px-4 py-2.5 text-sm text-white shadow-lg backdrop-blur-sm">
            <span
              className="inline-flex h-2 w-2 shrink-0 animate-pulse rounded-full bg-violet-400 shadow-[0_0_12px_rgba(167,139,250,0.9)]"
              aria-hidden
            />
            <span className="truncate font-medium tracking-tight">{statusText}</span>
          </div>
        </div>
      )}
    </div>
  );
}
