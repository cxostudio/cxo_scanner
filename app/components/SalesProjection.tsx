'use client'

import { motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'

/**
 * Shopify-style chart of monthly sales over the next 12 months.
 *   - blue: if nothing changes (flat at today's revenue, the honest baseline)
 *   - green: with the chosen lift, easing in as fixes go live one by one;
 *     the gap to the blue line is filled: that is the money left on the table
 *   - faint dashed: the other two options, for comparison
 * The y-axis is zoomed around today's revenue (it is an illustration), and the chart is
 * drawn at the real container width so labels stay readable on phones.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const LIFTS = [0.05, 0.1, 0.15]
// share of the lift that is live after m months: fixes roll out one by one, so most of the
// gain lands in the first months and the rest eases in (about 70% after 3 months, 99% after 12)
const live = (m: number) => 1 - Math.exp(-m / 2.5)
const H = 230
const PAD = { l: 50, r: 14, t: 14, b: 26 }

/** Monthly sales with a lift ramping in, and the extra sales over 12 months. */
export function projection(monthly: number, lift: number) {
  const months: number[] = []
  let extra = 0
  for (let m = 1; m <= 12; m++) {
    const add = monthly * lift * live(m)
    months.push(monthly + add)
    extra += add
  }
  return { months, total: extra }
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

  const lo = monthly * 0.975
  const hi = monthly * (1 + LIFTS[LIFTS.length - 1]) * 1.03
  const x = (i: number) => PAD.l + (i / 12) * (w - PAD.l - PAD.r)
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b)
  // month 0 is today (no lift yet), then months 1-12; smooth Catmull-Rom curve through the points
  const pts = (vals: number[]) => [[x(0), y(monthly)], ...vals.map((v, i) => [x(i + 1), y(v)])] as [number, number][]
  const line = (vals: number[]) => {
    const p = pts(vals)
    let d = `M${p[0][0].toFixed(1)},${p[0][1].toFixed(1)}`
    for (let i = 0; i < p.length - 1; i++) {
      const p0 = p[Math.max(0, i - 1)], p1 = p[i], p2 = p[i + 1], p3 = p[Math.min(p.length - 1, i + 2)]
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
      d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
    }
    return d
  }
  // filled band between "nothing changes" and the chosen lift
  const band = (vals: number[]) => `${line(vals)} L${x(12).toFixed(1)},${y(monthly).toFixed(1)} L${x(0).toFixed(1)},${y(monthly).toFixed(1)} Z`
  const flat = Array(12).fill(monthly) as number[]
  const chosen = projection(monthly, lift).months
  const start = new Date().getMonth() + 1
  const ticks = [monthly, monthly * (1 + LIFTS[1]), monthly * (1 + LIFTS[2])]
  const ease = [0.22, 1, 0.36, 1] as const
  const months = w < 420 ? [0, 4, 8, 12] : [0, 3, 6, 9, 12]

  return (
    <div ref={box} className="w-full">
      <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} className="block max-w-full" role="img" aria-label={`Monthly sales over the next 12 months: if nothing changes, against a ${Math.round(lift * 100)}% lift`}>
        <defs>
          <linearGradient id="sp-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--result-pass-fg)', stopOpacity: 0.22 }} />
            <stop offset="1" style={{ stopColor: 'var(--result-pass-fg)', stopOpacity: 0.04 }} />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={w - PAD.r} y1={y(t)} y2={y(t)} style={{ stroke: 'var(--border)' }} strokeWidth="1" />
            <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" style={{ fill: 'var(--text-muted)', fontSize: 11 }}>
              {shortEur(t)}
            </text>
          </g>
        ))}
        {months.map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === 12 ? 'end' : 'middle'} style={{ fill: 'var(--text-muted)', fontSize: 11 }}>
            {i === 0 ? 'Today' : MONTHS[(start - 1 + i) % 12]}
          </text>
        ))}
        {LIFTS.filter((k) => k !== lift).map((k) => (
          <path key={k} d={line(projection(monthly, k).months)} fill="none" style={{ stroke: 'var(--border-strong)' }} strokeWidth="1.5" strokeDasharray="4 5" strokeLinecap="round" />
        ))}
        <motion.path initial={false} animate={{ d: band(chosen) }} transition={{ duration: 0.6, ease }} fill="url(#sp-fill)" />
        <path d={line(flat)} fill="none" style={{ stroke: 'var(--accent)' }} strokeWidth="2.5" strokeLinecap="round" />
        <motion.path initial={false} animate={{ d: line(chosen) }} transition={{ duration: 0.6, ease }} fill="none" style={{ stroke: 'var(--result-pass-fg)' }} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <motion.circle initial={false} animate={{ cx: x(12), cy: y(chosen[11]) }} transition={{ duration: 0.6, ease }} r="4.5" style={{ fill: 'var(--result-pass-fg)', stroke: 'var(--surface)' }} strokeWidth="2" />
        <circle cx={x(12)} cy={y(monthly)} r="4.5" style={{ fill: 'var(--accent)', stroke: 'var(--surface)' }} strokeWidth="2" />
      </svg>
    </div>
  )
}
