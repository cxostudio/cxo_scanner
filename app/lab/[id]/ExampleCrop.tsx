'use client'

// One screenshot in the lab. "Good example" turns on crop mode: drag a box over the part that shows the
// checkpoint done well, then save. The crop is made in the browser and attached to the checkpoint in Airtable.
import { useRef, useState } from 'react'
import { api } from '@/lib/base'

type Box = { x: number; y: number; w: number; h: number } // fractions of the image

export function ExampleCrop({ img, checkpointId, checkpointTitle, store, labKey, mobile }: { img: { url: string; label: string }; checkpointId: string; checkpointTitle: string; store: string; labKey: string; mobile: boolean }) {
  const [on, setOn] = useState(false)
  const [box, setBox] = useState<Box | null>(null)
  const [state, setState] = useState('')
  const start = useRef<{ x: number; y: number } | null>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const pic = useRef<HTMLImageElement>(null)

  const at = (e: React.PointerEvent) => {
    const r = wrap.current!.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
  }

  const save = async () => {
    const el = pic.current
    if (!el) return
    setState('Saving…')
    try {
      // a fresh copy with CORS, so the canvas can export it
      const source = await new Promise<HTMLImageElement>((ok, ko) => {
        const im = new Image()
        im.crossOrigin = 'anonymous'
        im.onload = () => ok(im)
        im.onerror = () => ko(new Error('could not load the screenshot'))
        im.src = img.url
      })
      const b = box && box.w > 0.02 && box.h > 0.02 ? box : { x: 0, y: 0, w: 1, h: 1 }
      const sx = Math.round(b.x * source.naturalWidth)
      const sy = Math.round(b.y * source.naturalHeight)
      const sw = Math.round(b.w * source.naturalWidth)
      const sh = Math.round(b.h * source.naturalHeight)
      const canvas = document.createElement('canvas')
      canvas.width = sw
      canvas.height = sh
      canvas.getContext('2d')!.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh)
      const image = canvas.toDataURL('image/jpeg', 0.85)
      const r = await fetch(api(`/lab/example${labKey ? `?key=${encodeURIComponent(labKey)}` : ''}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: checkpointId, image, store, label: checkpointTitle }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || String(r.status))
      setState(`Saved to Airtable (${d.examples} example${d.examples > 1 ? 's' : ''} on this checkpoint)`)
      setOn(false)
      setBox(null)
    } catch (e) {
      setState(`Not saved: ${String((e as Error).message || e)}`)
    }
  }

  return (
    <figure className={`overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] ${mobile ? 'max-w-[420px]' : ''}`}>
      <div
        ref={wrap}
        className="relative select-none"
        style={{ cursor: on ? 'crosshair' : undefined, touchAction: on ? 'none' : undefined }}
        onPointerDown={(e) => {
          if (!on) return
          start.current = at(e)
          setBox({ ...start.current, w: 0, h: 0 })
          ;(e.target as Element).setPointerCapture?.(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (!on || !start.current) return
          const p = at(e)
          const s = start.current
          setBox({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) })
        }}
        onPointerUp={() => {
          start.current = null
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={pic} src={img.url} alt={img.label} className="block h-auto w-full" loading="lazy" draggable={false} />
        {on && box && (
          <div
            className="pointer-events-none absolute border-2 border-[var(--cta-bg)]"
            style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%`, boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)' }}
          />
        )}
      </div>
      <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)]">
        <span className="min-w-0 flex-1">{img.label}</span>
        {on ? (
          <>
            <span>Drag a box over the good part (or save the whole image)</span>
            <button type="button" className="font-semibold text-[var(--text)] hover:underline" onClick={save}>Save example</button>
            <button type="button" className="hover:underline" onClick={() => { setOn(false); setBox(null) }}>Cancel</button>
          </>
        ) : (
          <button type="button" className="font-semibold text-[var(--text)] hover:underline" onClick={() => { setOn(true); setState('') }}>Good example</button>
        )}
        {state && <span className="w-full">{state}</span>}
      </figcaption>
    </figure>
  )
}
