// Lead dashboard data: the /start answers (public.leads) joined with a short summary of each
// free scan (public.lead_scans). Server only, service role. Schema: supabase/lead_scans.sql.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { noStoreFetch } from '@/lib/supabaseFetch'
import { scoreOf, type ScanResult } from '@/lib/report'
import { detectPageTypeFromUrl, isTestEmail } from '@/lib/conversionCheckpoints/filterByUrlPageType'
import type { CheckpointPresentation } from '@/lib/conversionCheckpoints/checkpointPresentation'
import type { V2Row } from '@/lib/scanV2'

export const LEAD_STATUSES = ['new', 'contacted', 'call', 'won', 'lost'] as const
export type LeadStatus = (typeof LEAD_STATUSES)[number]

export type LeadScanResult = { id: string; title: string; answer: V2Row['status']; reason: string; priority?: string; difficulty?: string }

export type LeadScan = {
  id: string
  created_at: string
  scan_id: string | null
  email: string
  url: string
  page_type: string | null
  niche: string | null
  score: number | null
  passed: number | null
  failed: number | null
  na: number | null
  unknown: number | null
  test: boolean
  results: LeadScanResult[] | null
}

export type Lead = {
  id: string
  created_at: string
  email: string
  name: string | null
  site_type: string
  platform: string | null
  url: string | null
  revenue_band: string | null
  traffic_band: string | null
  conversion_band: string | null
  aov_band: string | null
  goal: string | null
  role: string | null
  route: string
  locale: string | null
  source: Record<string, string> | null
  status?: LeadStatus | null
  notes?: string | null
  status_at?: string | null
}

let client: SupabaseClient | null = null
function supabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase is not configured (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).')
  if (!client) client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: noStoreFetch } })
  return client
}

/**
 * Keep a short summary of a finished free scan: score, counts and every checkpoint's answer with
 * its one-line reason. No screenshots, no page text. Never throws: a scan is never failed because
 * of the dashboard.
 */
export async function saveLeadScan(input: {
  scanId?: string
  email: string
  url: string
  niche?: string
  results: V2Row[]
  checkpoints: Map<string, CheckpointPresentation>
}) {
  try {
    const rows: ScanResult[] = input.results.map((r) => ({ ...r, checkpoint: input.checkpoints.get(r.ruleId) as ScanResult['checkpoint'] }))
    const scored = rows.filter((r) => r.status !== 'unknown')
    const count = (s: V2Row['status']) => input.results.filter((r) => r.status === s).length
    const { error } = await supabase()
      .from('lead_scans')
      .insert({
        scan_id: input.scanId || null,
        email: input.email.trim().toLowerCase(),
        url: input.url,
        page_type: detectPageTypeFromUrl(input.url),
        niche: input.niche || null,
        score: scoreOf(scored),
        passed: count('pass'),
        failed: count('fail'),
        na: count('na'),
        unknown: count('unknown'),
        test: isTestEmail(input.email),
        results: rows.map((r) => ({
          id: r.ruleId,
          title: r.ruleTitle,
          answer: r.status,
          reason: (r.reason || '').slice(0, 400),
          priority: r.checkpoint?.priority,
          difficulty: r.checkpoint?.difficulty,
        })),
      })
    if (error) console.warn('[leads] scan summary not stored:', error.message)
  } catch (e) {
    console.warn('[leads] scan summary not stored:', e)
  }
}

/** Leads and scans of the last `days` days (default 12 months, the retention period). */
export async function listLeads(days = 365) {
  const since = new Date(Date.now() - days * 864e5).toISOString()
  const sb = supabase()
  const [leads, scans] = await Promise.all([
    sb.from('leads').select('*').gte('created_at', since).order('created_at', { ascending: false }).limit(2000),
    sb.from('lead_scans').select('*').gte('created_at', since).order('created_at', { ascending: false }).limit(2000),
  ])
  if (leads.error) throw new Error(`leads: ${leads.error.message}`)
  return {
    leads: (leads.data || []) as Lead[],
    scans: (scans.data || []) as LeadScan[],
    // the scan table is optional until supabase/lead_scans.sql has been run
    scansError: scans.error?.message || null,
  }
}

export async function updateLead(id: string, patch: { status?: LeadStatus; notes?: string }) {
  const row: Record<string, unknown> = {}
  if (patch.status) {
    if (!LEAD_STATUSES.includes(patch.status)) throw new Error('Unknown status')
    row.status = patch.status
    row.status_at = new Date().toISOString()
  }
  if (typeof patch.notes === 'string') row.notes = patch.notes.slice(0, 4000)
  const { error } = await supabase().from('leads').update(row).eq('id', id)
  if (error) throw new Error(error.message)
}
