import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Per-email daily scan limit.
 *
 * A scan makes several /api/scan requests (rule batches, retries, the per-rule
 * fallback). The browser tags them all with one `scanId`, and the Postgres
 * function `register_scan` counts distinct scanIds per email per UTC day — so a
 * scan counts exactly once and the quota resets automatically at UTC midnight.
 *
 * Env:
 *   SUPABASE_URL                 e.g. https://<project>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY    service role key (server-only; bypasses RLS)
 *   SCAN_DAILY_LIMIT             max scans per email per day (default 5)
 *
 * Fails OPEN: if Supabase is missing/unreachable we allow the scan rather than
 * block users — the OpenRouter spending cap remains the money backstop.
 */
export const SCAN_DAILY_LIMIT = Math.max(
  1,
  parseInt(process.env.SCAN_DAILY_LIMIT || '', 10) || 5,
)

let cached: SupabaseClient | null = null
function getSupabase(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  if (!cached) {
    cached = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return cached
}

export type ScanLimitResult = {
  allowed: boolean
  used: number
  limit: number
  /** false when we failed open (DB not configured / unreachable). */
  enforced: boolean
}

/** UTC calendar day (yyyy-mm-dd) — matches the DB's (now() at time zone 'utc')::date. */
function utcToday(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * READ-ONLY check: is this email under its daily limit right now? Does NOT
 * increment. Call this BEFORE a scan to decide whether to start. Counting
 * happens later, in `registerScan`, only when the scan completes.
 * Fails OPEN.
 */
export async function checkScanLimit(email: string): Promise<ScanLimitResult> {
  const supabase = getSupabase()
  const cleanEmail = (email || '').trim().toLowerCase()

  if (!supabase || !cleanEmail) {
    return { allowed: true, used: 0, limit: SCAN_DAILY_LIMIT, enforced: false }
  }

  try {
    const { data, error } = await supabase
      .from('scan_limit')
      .select('count')
      .eq('email', cleanEmail)
      .eq('scan_day', utcToday())
      .maybeSingle()
    if (error) {
      console.error('[scanLimit] check error, failing open:', error.message)
      return { allowed: true, used: 0, limit: SCAN_DAILY_LIMIT, enforced: false }
    }
    const used = (data?.count as number | undefined) ?? 0
    return {
      allowed: used < SCAN_DAILY_LIMIT,
      used,
      limit: SCAN_DAILY_LIMIT,
      enforced: true,
    }
  } catch (e) {
    console.error('[scanLimit] check threw, failing open:', e)
    return { allowed: true, used: 0, limit: SCAN_DAILY_LIMIT, enforced: false }
  }
}

/**
 * COMMIT: count this scan against the email's daily quota. Call when the scan
 * COMPLETES (produced results) — not at the start — so failed/blocked scans
 * don't burn a slot. Deduped by scanId, so a scan's batch/retry/fallback
 * requests all count once. `register_scan` won't push count past the limit.
 * Fails OPEN.
 */
export async function registerScan(
  email: string,
  scanId: string,
): Promise<ScanLimitResult> {
  const supabase = getSupabase()
  const cleanEmail = (email || '').trim().toLowerCase()
  const cleanScanId = (scanId || '').trim()

  if (!supabase || !cleanEmail || !cleanScanId) {
    return { allowed: true, used: 0, limit: SCAN_DAILY_LIMIT, enforced: false }
  }

  try {
    const { data, error } = await supabase.rpc('register_scan', {
      p_email: cleanEmail,
      p_scan_id: cleanScanId,
      p_limit: SCAN_DAILY_LIMIT,
    })
    if (error) {
      console.error('[scanLimit] register_scan error, failing open:', error.message)
      return { allowed: true, used: 0, limit: SCAN_DAILY_LIMIT, enforced: false }
    }
    const row = Array.isArray(data) ? data[0] : data
    return {
      allowed: row?.allowed ?? true,
      used: row?.used ?? 0,
      limit: row?.max_allowed ?? SCAN_DAILY_LIMIT,
      enforced: true,
    }
  } catch (e) {
    console.error('[scanLimit] register_scan threw, failing open:', e)
    return { allowed: true, used: 0, limit: SCAN_DAILY_LIMIT, enforced: false }
  }
}
