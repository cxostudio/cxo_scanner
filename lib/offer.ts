// The 48-hour offer after a free scan: the full report at €39 instead of €49, for 48 hours from the
// email's FIRST free scan. Decided on the server (the checkout uses it too), so a reload or a new scan
// never restarts the clock. €49 is the regular price, charged to everyone after the window: no fake
// reference price (EU Omnibus rule).
import { firstScanAt } from '@/lib/leads/store'

export const OFFER_HOURS = 48
export const REGULAR_CENTS = 4900
export const OFFER_CENTS = 3900

export type Offer = { active: boolean; cents: number; regularCents: number; endsAt: string | null }

export async function offerFor(email: string): Promise<Offer> {
  const none: Offer = { active: false, cents: REGULAR_CENTS, regularCents: REGULAR_CENTS, endsAt: null }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || '')) return none
  const first = await firstScanAt(email)
  if (!first) return none
  const ends = new Date(first.getTime() + OFFER_HOURS * 3600_000)
  if (ends.getTime() <= Date.now()) return { ...none, endsAt: ends.toISOString() }
  return { active: true, cents: OFFER_CENTS, regularCents: REGULAR_CENTS, endsAt: ends.toISOString() }
}
