'use client'
// The 48-hour offer for this email (decided by the server), with a countdown that ticks every 30 s.
import { useEffect, useState } from 'react'
import { api } from '@/lib/base'

export type OfferView = { active: boolean; price: string; regular: string; left: string }

const euro = (cents: number) => `€${Math.round(cents / 100)}`
const leftOf = (ms: number) => {
  const m = Math.max(0, Math.floor(ms / 60000))
  const h = Math.floor(m / 60)
  return h > 0 ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`
}

export function useOffer(email: string, enabled = true): OfferView {
  const [data, setData] = useState<{ active: boolean; cents: number; regularCents: number; endsAt: string | null } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!email || !enabled) return
    fetch(api(`/offer?email=${encodeURIComponent(email)}`))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setData(d))
      .catch(() => {})
  }, [email, enabled])
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])
  const ends = data?.endsAt ? new Date(data.endsAt).getTime() : 0
  const active = Boolean(data?.active && ends > now)
  return {
    active,
    price: euro(active ? data!.cents : data?.regularCents || 4900),
    regular: euro(data?.regularCents || 4900),
    left: active ? leftOf(ends - now) : '',
  }
}
