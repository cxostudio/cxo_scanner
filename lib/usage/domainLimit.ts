import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { isTestEmail } from '@/lib/conversionCheckpoints/pageType'
import { noStoreFetch } from '@/lib/supabaseFetch'

/**
 * Per-store limit, on top of the per-email one: a store can be scanned at most
 * DOMAIN_DAILY_LIMIT times in any 24 hours, whatever email is used (so swapping
 * emails doesn't buy more scans of the same store). CXO studio and +test emails
 * are not limited. Counted from public.scan_jobs (one row per free scan).
 * Fails OPEN, like the email limit.
 *
 * Env: DOMAIN_DAILY_LIMIT (default 2)
 */
export const DOMAIN_DAILY_LIMIT = Math.max(1, parseInt(process.env.DOMAIN_DAILY_LIMIT || '', 10) || 2)

let cached: SupabaseClient | null = null
function db(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  if (!cached) cached = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: noStoreFetch } })
  return cached
}

/** polaroid.com from "https://www.polaroid.com/products/x" or "polaroid.com" */
export function storeHost(raw: string): string {
  try { return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase().replace(/^www\./, '') } catch { return '' }
}

export type DomainLimitResult = { allowed: boolean; used: number; limit: number; host: string }

/** How many scans this store had in the last 24 hours (other than `scanId`), and whether one more is allowed. */
export async function checkDomainLimit(email: string, url: string, scanId?: string): Promise<DomainLimitResult> {
  const host = storeHost(url)
  const open: DomainLimitResult = { allowed: true, used: 0, limit: DOMAIN_DAILY_LIMIT, host }
  const sb = db()
  if (!sb || !host || isTestEmail(email)) return open
  try {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString()
    const { data, error } = await sb.from('scan_jobs').select('scan_id,url,email,status')
      .gte('created_at', since).ilike('url', `%${host}%`).neq('status', 'failed').limit(200)
    if (error) { console.error('[domainLimit] failing open:', error.message); return open }
    // a background scan counts once it has an email (a visitor who left at the URL step used nothing)
    const used = (data || []).filter((r) => r.scan_id !== scanId && !String(r.scan_id).startsWith('report_') && storeHost(r.url) === host && !!r.email && !isTestEmail(r.email)).length
    return { allowed: used < DOMAIN_DAILY_LIMIT, used, limit: DOMAIN_DAILY_LIMIT, host }
  } catch (e) {
    console.error('[domainLimit] failing open:', e)
    return open
  }
}

export const domainLimitMessage = (host: string) =>
  `${host} has already been scanned today. The results went to the email used for that scan. You can scan it again tomorrow, or scan another store.`
