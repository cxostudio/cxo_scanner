'use client';

type Props = {
  previewDesktop: string;
};

/** Small desktop-only preview thumb for the quadrant row. */
export function MiniDualViewportCard({ previewDesktop }: Props) {
  return (
    <figure
      className="relative inline-flex h-28 shrink-0 items-center justify-center sm:h-32"
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
      <figcaption className="sr-only">Desktop viewport preview</figcaption>
    </figure>
  );
}
