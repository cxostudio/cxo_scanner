'use client'
// The 1-hour offer for this email (decided by the server), with a countdown that ticks every second.
import { useEffect, useState } from 'react'
import { api } from '@/lib/base'

export type OfferView = { active: boolean; price: string; regular: string; left: string }

const euro = (cents: number) => `€${Math.round(cents / 100)}`
const leftOf = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}:${String(s % 60).padStart(2, '0')}`
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
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const ends = data?.endsAt ? new Date(data.endsAt).getTime() : 0
  const active = Boolean(data?.active && ends > now)
  return {
    active,
    price: euro(active ? data!.cents : data?.regularCents || 8900),
    regular: euro(data?.regularCents || 8900),
    left: active ? leftOf(ends - now) : '',
  }
}
