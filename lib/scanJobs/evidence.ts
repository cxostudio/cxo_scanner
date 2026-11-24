// Background scans (lib/scanJobs/background): the page is captured at the URL step and judged at
// the email step, so the capture waits here in between. One private file per job, deleted once the
// scan is judged. Customer pages are never kept longer than that.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { noStoreFetch } from '@/lib/supabaseFetch'
import type { Evidence } from '@/lib/scanV2/capture'

const BUCKET = 'scan-evidence'
let client: SupabaseClient | null = null
let ready = false

async function store() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase is not configured')
  if (!client) client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: noStoreFetch } })
  if (!ready) {
    const { error } = await client.storage.createBucket(BUCKET, { public: false })
    if (error && !/already exists|duplicate/i.test(error.message)) throw error
    ready = true
  }
  return client.storage.from(BUCKET)
}

const file = (scanId: string) => `jobs/${scanId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80)}.json`

export async function saveEvidence(scanId: string, ev: Evidence): Promise<void> {
  const s = await store()
  // the product gallery is fetched from Shopify again when judging: never stored (as in the lab)
  const { galleryTiles: _skip, ...rest } = ev as Evidence & { galleryTiles?: unknown }
  const body = Buffer.from(JSON.stringify(rest))
  for (let attempt = 0; ; attempt++) {
    const { error } = await s.upload(file(scanId), body, { contentType: 'application/json', upsert: true })
    if (!error) return
    if (attempt >= 2) throw new Error(`evidence not saved: ${error.message}`)
    await new Promise((r) => setTimeout(r, 600 * (attempt + 1)))
  }
}

export async function loadEvidence(scanId: string): Promise<Evidence | null> {
  const s = await store()
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await s.download(file(scanId))
    if (data) return JSON.parse(Buffer.from(await data.arrayBuffer()).toString('utf8')) as Evidence
    if (attempt >= 2) { console.warn('[evidence] not found', scanId, error?.message); return null }
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
  }
}

export async function deleteEvidence(scanId: string): Promise<void> {
  const s = await store()
  await s.remove([file(scanId)]).catch(() => {})
}
