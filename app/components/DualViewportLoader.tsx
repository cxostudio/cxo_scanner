'use client';

type DualViewportLoaderProps = {
  /** null = empty pane while URL capture is in flight */
  previewDesktop: string | null;
  /** null = empty mobile pane while URL capture is in flight */
  previewMobile?: string | null;
  statusText?: string;
  scanning?: boolean;
  /** `start` = left-align mockups (analyze + progress layout); default centered */
  align?: 'center' | 'start';
};

/** Desktop-only browser mockup with optional UX-Ray scan overlay on the viewport. */
export function DualViewportLoader({
  previewDesktop,
  previewMobile = null,
  statusText = 'Capturing page screenshots',
  scanning = true,
  align = 'center',
}: DualViewportLoaderProps) {
  const desktopReady = previewDesktop != null && previewDesktop.length > 0;
  const mobileReady = previewMobile != null && previewMobile.length > 0;
  const mobileSrc = mobileReady ? previewMobile! : desktopReady ? previewDesktop! : null;
  const isStart = align === 'start';

  return (
    <div
      className={
        isStart
          ? 'w-full max-w-none px-0 sm:pr-2'
          : 'mx-auto w-full max-w-5xl px-3 sm:px-4'
      }
    >
      <div
        className={`relative mx-auto flex w-full pb-0 ${isStart ? 'mx-0 pt-0 sm:pb-0' : 'pt-2 sm:pb-8'}`}
      >
        <div
          className="pointer-events-none absolute inset-x-3 inset-y-2 -z-10 rounded-[2.2rem] bg-gradient-to-br from-zinc-200/70 via-zinc-100/45 to-white/20 blur-2xl sm:inset-x-6"
          aria-hidden
        />

        <div className="relative mx-auto w-full h-full md:h-auto min-h-[462px] mobile-set-height">
          <div className="relative z-0 w-full max-w-[min(100%,40rem)] shrink-0 lg:min-w-0 sm:pe-[60px] lg:pe-0 shadow-[0_32px_90px_-22px_rgba(0,0,0,0.22)] ring-1 ring-black/[0.04] rounded-[1.8rem] overflow-hidden">
            <div className="flex h-10 items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-4">
              <span className="h-3 w-3 rounded-full bg-[#ff5f57]" aria-hidden />
              <span className="h-3 w-3 rounded-full bg-[#febc2e]" aria-hidden />
              <span className="h-3 w-3 rounded-full bg-[#28c840]" aria-hidden />
            </div>
            <div className="relative aspect-[16/10] w-full overflow-hidden bg-zinc-100">
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

          <div className="w-full max-w-[200px] sm:max-w-[190px] md:max-w-[216px] lg:max-w-[14.2rem] self-center absolute right-0 top-0 sm:z-30 sm:mt-0 mobile-view">
            <div className="rounded-[2.25rem] border border-zinc-200 bg-white p-2.5 shadow-none ring-1 ring-black/[0.05]">
              <div className="overflow-hidden rounded-[1.8rem] bg-white ring-1 ring-zinc-200/90">
                <div className="flex justify-center border-b border-zinc-100 bg-white px-3 pb-2 pt-3">
                  <div className="h-[1.15rem] w-[4.25rem] rounded-full bg-zinc-900" aria-hidden />
                </div>
                <div className="relative mx-2 aspect-[9/17.5] overflow-hidden rounded-xl bg-zinc-100 ring-1 ring-zinc-100">
                  {mobileSrc ? (
                    <img
                      src={mobileSrc}
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
                          backgroundSize: '12px 12px',
                        }}
                      />
                      <div
                        className="absolute inset-0 opacity-[0.18]"
                        style={{
                          backgroundImage:
                            'linear-gradient(rgba(139, 92, 246, 0.32) 1px, transparent 1px), linear-gradient(90deg, rgba(139, 92, 246, 0.32) 1px, transparent 1px)',
                          backgroundSize: '20px 20px',
                        }}
                      />
                      <div className="absolute inset-0 bg-violet-600/14" />
                      <div className="ux-ray-scan-line absolute inset-x-0 z-20 h-[3px] rounded-full bg-violet-400 shadow-[0_0_24px_rgba(167,139,250,0.95),0_0_2px_rgba(255,255,255,0.9)]" />
                    </div>
                  )}
                </div>
                <div className="bg-white px-2 pb-2.5 pt-1.5 text-center">
                  <p className="text-[0.7rem] font-bold leading-tight text-violet-950 sm:text-xs">
                    Mobile view
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {scanning && (
        <div
          className={`pointer-events-none mt-8 flex sm:max-w-md ${isStart ? 'mx-0 justify-center sm:justify-start' : 'mx-auto justify-center'}`}
        >
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
