// "What's next": the shopper's own page on a laptop, seen from the front like a product shot.
// Screen (16:10) in a dark bezel with a camera, an aluminium base with the opening notch, a soft
// shadow on the floor. Tokens only, no image of a laptop.

export function LaptopMockup({ src, alt = '' }: { src: string | null; alt?: string }) {
  return (
    <div className="relative mx-auto w-full max-w-[360px] px-[7%] pb-4" aria-hidden={!alt}>
      {/* lid */}
      <div className="relative rounded-t-[14px] bg-[var(--text)] p-[2.6%] pb-[3.6%] shadow-[0_1px_0_0_var(--border-strong)]">
        <span className="absolute left-1/2 top-[1.1%] h-[4px] w-[4px] -translate-x-1/2 rounded-full bg-[var(--text-muted)] opacity-60" />
        <div className="relative aspect-[16/10] overflow-hidden rounded-[3px] bg-[var(--surface)]">
          {src ? (
            <img src={src} alt={alt} className="block h-full w-full object-cover object-top" />
          ) : (
            <div className="h-full w-full animate-pulse bg-[var(--bg-subtle)]" />
          )}
        </div>
      </div>
      {/* base: wider than the lid, with the notch to open it */}
      <div className="relative -mx-[8%] h-[11px] rounded-b-[10px] rounded-t-[2px] bg-[linear-gradient(180deg,var(--surface-muted),var(--border-strong))] shadow-[0_1px_2px_rgba(9,9,11,.12)]">
        <span className="absolute left-1/2 top-0 h-[4px] w-[15%] -translate-x-1/2 rounded-b-[4px] bg-[var(--border-strong)]" />
      </div>
      {/* floor shadow */}
      <div className="mx-auto mt-1 h-3 w-[90%] rounded-[50%] bg-[var(--text)] opacity-[0.07] blur-md" />
    </div>
  )
}
