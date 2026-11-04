'use client'

import { motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'

/**
 * Shopify-style chart of the extra sales a lift brings over the next 12 months, cumulative,
 * so it grows from €0. One line per option (+5 / +10 / +15%); the chosen one is drawn in
 * green and filled, the others stay faint for comparison. The lift ramps in over the first
 * 3 months, as fixes go live one by one. Drawn at the real container width, so labels stay
 * readable on phones.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const LIFTS = [0.05, 0.1, 0.15]
const RAMP = 3 // months until the full lift is live
const H = 220
const PAD = { l: 48, r: 14, t: 12, b: 26 }

/** Cumulative extra sales per month (12 values) for a monthly revenue and a lift. */
export function projection(monthly: number, lift: number) {
  const extra: number[] = []
  let sum = 0
  for (let m = 1; m <= 12; m++) {
    sum += monthly * lift * Math.min(1, m / RAMP)
    extra.push(sum)
  }
  return { extra, total: sum }
}

export function SalesProjection({ monthly, lift, shortEur }: { monthly: number; lift: number; shortEur: (n: number) => string }) {
  const box = useRef<HTMLDivElement | null>(null)
  const [w, setW] = useState(640)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const max = projection(monthly, LIFTS[LIFTS.length - 1]).total * 1.06
  const x = (i: number) => PAD.l + (i / 11) * (w - PAD.l - PAD.r)
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b)
  const line = (vals: number[]) => `M${x(0).toFixed(1)},${y(0).toFixed(1)} ` + vals.map((v, i) => `L${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const area = (vals: number[]) => `${line(vals)} L${x(11).toFixed(1)},${y(0).toFixed(1)} Z`
  const start = new Date().getMonth() + 1
  const ticks = [0, 0.5, 1].map((t) => t * max * 0.94)
  const ease = [0.22, 1, 0.36, 1] as const
  const chosen = projection(monthly, lift).extra
  const months = w < 420 ? [0, 4, 8, 11] : [0, 3, 6, 9, 11]

  return (
    <div ref={box} className="w-full">
      <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} className="block max-w-full" role="img" aria-label={`Extra sales over the next 12 months with a ${Math.round(lift * 100)}% lift`}>
        <defs>
          <linearGradient id="sp-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--result-pass-fg)', stopOpacity: 0.2 }} />
            <stop offset="1" style={{ stopColor: 'var(--result-pass-fg)', stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={w - PAD.r} y1={y(t)} y2={y(t)} style={{ stroke: 'var(--border)' }} strokeWidth="1" />
            <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" style={{ fill: 'var(--text-muted)', fontSize: 11 }}>
              {t === 0 ? '€0' : shortEur(t)}
            </text>
          </g>
        ))}
        {months.map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === 11 ? 'end' : 'middle'} style={{ fill: 'var(--text-muted)', fontSize: 11 }}>
            {MONTHS[(start + i) % 12]}
          </text>
        ))}
        {LIFTS.filter((k) => k !== lift).map((k) => (
          <path key={k} d={line(projection(monthly, k).extra)} fill="none" style={{ stroke: 'var(--border-strong)' }} strokeWidth="1.5" strokeDasharray="4 5" strokeLinecap="round" />
        ))}
        <motion.path initial={false} animate={{ d: area(chosen) }} transition={{ duration: 0.6, ease }} fill="url(#sp-fill)" />
        <motion.path initial={false} animate={{ d: line(chosen) }} transition={{ duration: 0.6, ease }} fill="none" style={{ stroke: 'var(--result-pass-fg)' }} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <motion.circle initial={false} animate={{ cx: x(11), cy: y(chosen[11]) }} transition={{ duration: 0.6, ease }} r="4.5" style={{ fill: 'var(--result-pass-fg)', stroke: 'var(--surface)' }} strokeWidth="2" />
      </svg>
    </div>
  )
}
