'use client'

// "What's next" illustration: a laptop turned towards the offer, showing the shopper's own page being
// scanned, with dotted guidelines from the spots we pinned to checkpoint cards (fails in red, the
// rest in green). Built from tokens only: no image of a laptop, no gradients. The scan band stops
// with reduced motion.
import type { CSSProperties } from 'react'

type Box = { x: number; y: number; w: number; h: number }
export type LaptopShot = { screenshot: string; width: number; height: number; pins: { box: Box; n?: number }[] }

// the part of the page the laptop shows: the first screen, at a 16:10 window
const RATIO = 10 / 16

export function ScanLaptop({ shot, fallback, passed }: { shot: LaptopShot | null; fallback: string; passed: number }) {
  const img = shot?.screenshot || fallback
  const viewH = shot ? shot.width * RATIO : 0
  // up to two real findings from the first screen, plus one passed checkpoint
  const pins = (shot?.pins || [])
    .filter((p) => p.box.y + p.box.h / 2 < viewH * 0.92)
    .slice(0, 2)
    .map((p) => ({ x: ((p.box.x + p.box.w / 2) / shot!.width) * 100, y: ((p.box.y + p.box.h / 2) / viewH) * 100, n: p.n, fail: true }))
  const cards = [...pins, ...(passed > 0 ? [{ x: 30, y: 78, n: undefined, fail: false }] : [])].slice(0, 3)
  // cards sit in a side panel, one per row
  const rows = cards.map((c, i) => ({ ...c, cy: 20 + i * 30 }))

  return (
    <div className="cxo-laptop" aria-hidden="true">
      <div className="cxo-laptop-lid">
        <div className="cxo-laptop-screen">
          <div className="cxo-laptop-bar">
            <i /> <i /> <i />
          </div>
          <div className="cxo-laptop-view">
            <div className="cxo-laptop-page" style={{ backgroundImage: img ? `url(${img})` : undefined } as CSSProperties}>
              <span className="cxo-laptop-band" />
              {rows.map((c, i) => (
                <span key={i} className="cxo-laptop-dot" style={{ left: `${c.x}%`, top: `${c.y}%`, background: c.fail ? 'var(--result-fail-fg)' : 'var(--result-pass-fg)' }} />
              ))}
            </div>
            <div className="cxo-laptop-panel">
              {rows.map((c, i) => (
                <div key={i} className="cxo-laptop-card" style={{ top: `${c.cy}%`, borderTopColor: c.fail ? 'var(--result-fail-fg)' : 'var(--result-pass-fg)' }}>
                  <b>
                    {c.fail ? `Checkpoint ${c.n ?? i + 1}` : 'Checkpoint'}
                    <span style={{ color: c.fail ? 'var(--result-fail-fg)' : 'var(--result-pass-fg)' }}>{c.fail ? '✕' : '✓'}</span>
                  </b>
                  <em />
                  <em style={{ width: '60%' }} />
                </div>
              ))}
            </div>
            {/* the dotted guidelines, page spot → card (page is the left 64% of the view) */}
            <svg className="cxo-laptop-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
              {rows.map((c, i) => (
                <path
                  key={i}
                  d={`M ${c.x * 0.64} ${c.y} C ${c.x * 0.64 + 10} ${c.y}, 58 ${c.cy + 6}, 67 ${c.cy + 6}`}
                  style={{ stroke: c.fail ? 'var(--result-fail-fg)' : 'var(--result-pass-fg)' }}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
          </div>
        </div>
      </div>
      <div className="cxo-laptop-base" />
      <div className="cxo-laptop-floor" />
    </div>
  )
}
