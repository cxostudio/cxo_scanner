'use client';

type Props = {
  previewDesktop: string;
  previewMobile?: string | null;
};

/** Small desktop + optional mobile preview thumbs for the quadrant row. */
export function MiniDualViewportCard({ previewDesktop, previewMobile = null }: Props) {
  return (
    <figure
      className="relative inline-flex h-28 shrink-0 items-end justify-center gap-2 sm:h-32"
      title="Desktop preview"
    >
      <div className="relative z-0 w-[7.25rem] shrink-0 overflow-hidden rounded-lg border border-zinc-200/90 bg-white shadow-md ring-1 ring-black/5 sm:w-[8.5rem]">
        <div className="flex h-1.5 items-center gap-0.5 border-b border-zinc-200 bg-zinc-100 px-1 sm:h-2 sm:gap-1 sm:px-1.5">
          <span className="h-1 w-1 rounded-full bg-[#ff5f57] sm:h-1.5 sm:w-1.5" aria-hidden />
          <span className="h-1 w-1 rounded-full bg-[#febc2e] sm:h-1.5 sm:w-1.5" aria-hidden />
          <span className="h-1 w-1 rounded-full bg-[#28c840] sm:h-1.5 sm:w-1.5" aria-hidden />
        </div>
        <div className="relative aspect-16/10 w-full bg-zinc-100">
          <img
            src={previewDesktop}
            alt=""
            className="absolute inset-0 h-full w-full object-cover object-top"
          />
        </div>
      </div>
      {previewMobile && (
        <div className="relative z-0 h-[4.75rem] w-[2.5rem] shrink-0 overflow-hidden rounded-md border border-zinc-200/90 bg-white shadow-md ring-1 ring-black/5 sm:h-[5.5rem] sm:w-[2.9rem]">
          <div className="flex h-1.5 items-center justify-center border-b border-zinc-200 bg-zinc-100 px-1 sm:h-2">
            <div className="h-1 w-2.5 rounded-full bg-zinc-900 sm:h-1.5 sm:w-3.5" aria-hidden />
          </div>
          <div className="relative h-[calc(100%-0.375rem)] w-full bg-zinc-100 sm:h-[calc(100%-0.5rem)]">
            <img
              src={previewMobile}
              alt=""
              className="absolute inset-0 h-full w-full object-cover object-top"
            />
          </div>
        </div>
      )}
      <figcaption className="sr-only">Desktop viewport preview</figcaption>
    </figure>
  );
}
