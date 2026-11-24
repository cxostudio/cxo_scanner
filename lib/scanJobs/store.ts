// Scan jobs (public.scan_jobs, see supabase/scan_jobs.sql). Server only, service role.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { noStoreFetch } from '@/lib/supabaseFetch'

// background scans (lib/scanJobs/background) also pass through: capturing → captured → judging
export type JobStatus = 'running' | 'server' | 'done' | 'failed' | 'capturing' | 'captured' | 'judging'

/** Everything the results page reads from local storage, so it can open on any device. */
export type ScanSnapshot = {
  results: unknown[]
  scanUrl: string
  revenue?: string
  aov?: string
  cr?: string
  locale?: string
  pageChecks?: number
  resolvedFrom?: string
  resolvedHow?: string
  labId?: string | null
  previewDesktop?: string | null
  previewMobile?: string | null
}

export type ScanJob = {
  id: string
  scan_id: string
  created_at: string
  email: string
  url: string
  locale: string
  answers: {
    revenue?: string; aov?: string; cr?: string; kind?: 'report'; page?: string; how?: string; quiet?: boolean
    // background scans
    bg?: boolean; ip?: string; role?: string; judge?: boolean; scanUrl?: string; resolvedFrom?: string; resolvedHow?: string
  } | null
  origin: string | null
  status: JobStatus
  heartbeat_at: string
  snapshot: ScanSnapshot | null
  emailed_at: string | null
  error: string | null
}

let client: SupabaseClient | null = null
function db(): SupabaseClient {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase is not configured (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).')
  if (!client) client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: noStoreFetch } })
  return client
}
const T = 'scan_jobs'

export async function createJob(input: { scanId: string; email: string; url: string; locale: string; answers: ScanJob['answers']; origin: string | null }): Promise<ScanJob> {
  const row = { scan_id: input.scanId, email: input.email.trim().toLowerCase(), url: input.url, locale: input.locale, answers: input.answers, origin: input.origin }
  // one job per scan: a retry of the same scan gets the same job back
  const { data, error } = await db().from(T).upsert(row, { onConflict: 'scan_id' }).select('*').single()
  if (error) throw new Error(error.message)
  return data as ScanJob
}

export async function getJob(id: string): Promise<ScanJob | null> {
  const { data, error } = await db().from(T).select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return (data as ScanJob) || null
}

export async function heartbeat(id: string): Promise<void> {
  await db().from(T).update({ heartbeat_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id).eq('status', 'running')
}

/** The server takes the scan over only if the browser has gone quiet and nobody else has. */
export async function claimForServer(id: string, quietSeconds: number): Promise<ScanJob | null> {
  const before = new Date(Date.now() - quietSeconds * 1000).toISOString()
  const { data, error } = await db().from(T)
    .update({ status: 'server', updated_at: new Date().toISOString() })
    .eq('id', id).eq('status', 'running').lt('heartbeat_at', before)
    .select('*').maybeSingle()
  if (error) throw new Error(error.message)
  return (data as ScanJob) || null
}

/** Store the finished scan. The first one to finish wins; returns the job if this call finished it. */
export async function completeJob(id: string, snapshot: ScanSnapshot): Promise<ScanJob | null> {
  const { data, error } = await db().from(T)
    .update({ status: 'done', snapshot, updated_at: new Date().toISOString(), error: null })
    .eq('id', id).neq('status', 'done')
    .select('*').maybeSingle()
  if (error) throw new Error(error.message)
  return (data as ScanJob) || null
}

export async function failJob(id: string, message: string): Promise<void> {
  await db().from(T).update({ status: 'failed', error: message.slice(0, 500), updated_at: new Date().toISOString() }).eq('id', id).neq('status', 'done')
}

/** Mark the email as sent; false if it was already sent (so it goes out once). */
export async function markEmailed(id: string): Promise<boolean> {
  const { data, error } = await db().from(T).update({ emailed_at: new Date().toISOString() }).eq('id', id).is('emailed_at', null).select('id').maybeSingle()
  if (error) throw new Error(error.message)
  return Boolean(data)
}

/** Every job whose scan_id starts with `prefix` (the pages of a full report), oldest first. */
export async function listJobsByPrefix(prefix: string): Promise<ScanJob[]> {
  const { data, error } = await db().from(T).select('*').like('scan_id', `${prefix}%`).order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data as ScanJob[]) || []
}

/** Store a snapshot without finishing the job (a full-report page between its scan and its pins). */
export async function saveSnapshot(id: string, snapshot: ScanSnapshot): Promise<void> {
  const { error } = await db().from(T).update({ snapshot, status: 'server', updated_at: new Date().toISOString() }).eq('id', id).neq('status', 'done')
  if (error) throw new Error(error.message)
}

/** Change the snapshot of a finished job (a full report's thank-you page upload). Keeps it done. */
export async function updateDoneSnapshot(id: string, snapshot: ScanSnapshot): Promise<void> {
  const { error } = await db().from(T).update({ snapshot, updated_at: new Date().toISOString() }).eq('id', id).eq('status', 'done')
  if (error) throw new Error(error.message)
}

/** Take a job's one-time start (a full report's kickoff): true for the first caller only. */
export async function claimStart(id: string): Promise<boolean> {
  const { data, error } = await db().from(T).update({ status: 'server', updated_at: new Date().toISOString() }).eq('id', id).eq('status', 'running').select('id').maybeSingle()
  if (error) throw new Error(error.message)
  return Boolean(data)
}

/** Point a job at another URL (a full-report page that switched to another product). */
export async function setJobUrl(id: string, url: string): Promise<void> {
  const { error } = await db().from(T).update({ url, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(error.message)
}

// ── background scans (lib/scanJobs/background) ────────────────────────────────────────────────

/** Move a job from one status to the next: true only for the caller that moved it (no double judge). */
export async function moveStatus(id: string, from: JobStatus, to: JobStatus): Promise<boolean> {
  const { data, error } = await db().from(T).update({ status: to, updated_at: new Date().toISOString() }).eq('id', id).eq('status', from).select('id').maybeSingle()
  if (error) throw new Error(error.message)
  return Boolean(data)
}

/** Merge fields into a job's answers (read, merge, write: the visitor answers one question at a time). */
export async function mergeAnswers(id: string, patch: NonNullable<ScanJob['answers']>): Promise<ScanJob | null> {
  const job = await getJob(id)
  if (!job) return null
  const answers = { ...(job.answers || {}), ...patch }
  const { data, error } = await db().from(T).update({ answers, updated_at: new Date().toISOString() }).eq('id', id).select('*').maybeSingle()
  if (error) throw new Error(error.message)
  return (data as ScanJob) || null
}

/** Give a background job its email (once: the first address wins). */
export async function setJobEmail(id: string, email: string): Promise<ScanJob | null> {
  const { data, error } = await db().from(T).update({ email: email.trim().toLowerCase(), updated_at: new Date().toISOString() }).eq('id', id).eq('email', '').select('*').maybeSingle()
  if (error) throw new Error(error.message)
  return (data as ScanJob) || null
}

/** Background scans started recently by one visitor (by IP) or on one store. */
export async function countRecentBackground(input: { ip?: string; host?: string; sinceMs: number }): Promise<number> {
  let q = db().from(T).select('id', { count: 'exact', head: true }).like('scan_id', 'bg_%').gte('created_at', new Date(Date.now() - input.sinceMs).toISOString())
  if (input.ip) q = q.eq('answers->>ip', input.ip)
  if (input.host) q = q.ilike('url', `%${input.host}%`)
  const { count, error } = await q
  if (error) throw new Error(error.message)
  return count || 0
}
