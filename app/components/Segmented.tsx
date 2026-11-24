'use client'

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/**
 * One switch for every tab set (report pages, desktop/mobile): a muted track and a single
 * white pill that slides to the active item. The track scrolls sideways when the items don't fit
 * (report nav on phones), and the active item is kept in view.
 */
export type SegItem<T extends string> = { id: T; label: ReactNode }

export function Segmented<T extends string>({
  items, value, onChange, label, fill = false, nav = false, size = 'md',
}: {
  items: SegItem<T>[]
  value: T
  onChange: (id: T) => void
  label: string
  /** stretch the items to the full width on phones (device toggle) */
  fill?: boolean
  /** page navigation: aria-current instead of aria-pressed */
  nav?: boolean
  size?: 'sm' | 'md'
}) {
  const track = useRef<HTMLDivElement>(null)
  const refs = useRef(new Map<T, HTMLButtonElement>())
  const [pill, setPill] = useState<{ x: number; w: number; ready: boolean }>({ x: 0, w: 0, ready: false })

  useLayoutEffect(() => {
    const place = () => {
      const b = refs.current.get(value)
      if (!b) return
      setPill((p) => ({ x: b.offsetLeft, w: b.offsetWidth, ready: p.ready || p.w > 0 }))
    }
    place()
    const b = refs.current.get(value)
    const t = track.current
    if (b && t && t.scrollWidth > t.clientWidth) {
      const left = b.offsetLeft - (t.clientWidth - b.offsetWidth) / 2
      t.scrollTo({ left, behavior: pill.ready ? 'smooth' : 'auto' })
    }
    const ro = new ResizeObserver(place)
    if (t) ro.observe(t)
    refs.current.forEach((el) => ro.observe(el))
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, items.length])

  const pad = size === 'sm' ? 'px-4 py-1.5 text-[13px] font-semibold' : 'px-4 py-2 text-[14px] font-medium'

  return (
    <div
      ref={track}
      role={nav ? undefined : 'group'}
      aria-label={label}
      className={`cxo-seg relative inline-flex max-w-full gap-0.5 overflow-x-auto rounded-full bg-[var(--surface-muted)] p-[3px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${fill ? 'max-[560px]:flex max-[560px]:w-full' : ''}`}
    >
      <span
        aria-hidden
        className={`cxo-seg-pill pointer-events-none absolute top-[3px] bottom-[3px] left-0 rounded-full bg-[var(--surface)] shadow-[var(--shadow-sm)] ${pill.ready ? '' : 'opacity-0'}`}
        style={{ width: pill.w, transform: `translateX(${pill.x}px)` }}
      />
      {items.map((it) => {
        const on = it.id === value
        return (
          <button
            key={it.id}
            ref={(el) => { if (el) refs.current.set(it.id, el); else refs.current.delete(it.id) }}
            type="button"
            onClick={() => onChange(it.id)}
            aria-current={nav && on ? 'page' : undefined}
            aria-pressed={nav ? undefined : on}
            className={`relative z-[1] inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full outline-none transition-colors duration-[var(--duration-fast)] focus-visible:ring-2 focus-visible:ring-[var(--border-strong)] ${pad} ${fill ? 'max-[560px]:flex-1' : ''} ${on ? 'text-[var(--text)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}
          >
            {it.label}
          </button>
        )
      })}
    </div>
  )
}
