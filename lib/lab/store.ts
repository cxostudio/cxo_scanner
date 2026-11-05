// Test lab: scans from test emails (CXO Studio, +test) are kept so Louis can label them blind
// and we can measure the scanner's accuracy per checkpoint before a checkpoint goes Live.
// Everything lives in one private Supabase Storage bucket, no database table needed:
//   scans/{id}/meta.json   url, niche, checkpoints with their definitions, the scanner's answers
//   scans/{id}/{n}.jpg     the screenshots the scanner judged from
//   labels/{id}.json       Louis's answers, per checkpoint
// Customer scans are never stored here.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Tile } from '@/lib/scanV2/capture'
import type { V2Row } from '@/lib/scanV2'
import type { ScanRule } from '@/lib/conversionCheckpoints/getCheckpointRules'

const BUCKET = 'test-scans'

export type LabAnswer = 'pass' | 'fail' | 'na' | 'unknown'
export type LabLabel = 'pass' | 'fail' | 'na' | 'skip'

export type LabCheckpoint = {
  id: string
  title: string
  status?: string
  device?: string
  pass?: string
  fail?: string
  na?: string
  nicheNotes?: string
  pageTypeIds?: string[]
}

export type LabScan = {
  id: string
  url: string
  email: string
  createdAt: string
  niche: string
  cartKind?: string
  shopify: boolean
  checkpoints: LabCheckpoint[]
  answers: { id: string; answer: LabAnswer; reason: string; coveredByShopify?: boolean }[]
  images: { label: string; file: string }[]
}

let client: SupabaseClient | null = null
let bucketReady = false

function supabase(): SupabaseClient {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase is not configured (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).')
  if (!client) client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  return client
}

async function bucket() {
  const sb = supabase()
  if (!bucketReady) {
    const { error } = await sb.storage.createBucket(BUCKET, { public: false })
    if (error && !/already exists|duplicate/i.test(error.message)) throw error
    bucketReady = true
  }
  return sb.storage.from(BUCKET)
}

const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80)

/** Keep one test scan: screenshots, checkpoints with their definitions, the scanner's answers. */
export async function saveTestScan(input: {
  id: string
  url: string
  email: string
  niche: string
  cartKind?: string
  shopify: boolean
  rules: ScanRule[]
  results: V2Row[]
  tiles: Tile[]
}) {
  const store = await bucket()
  const id = safeId(input.id) || `scan-${Date.now()}`
  const images = await Promise.all(
    input.tiles.map(async (t, i) => {
      const file = `scans/${id}/${String(i).padStart(2, '0')}.jpg`
      const bytes = Buffer.from(t.dataUrl.split(',')[1] || '', 'base64')
      const { error } = await store.upload(file, bytes, { contentType: 'image/jpeg', upsert: true })
      if (error) throw error
      return { label: t.label, file }
    }),
  )
  const meta: LabScan = {
    id,
    url: input.url,
    email: input.email,
    createdAt: new Date().toISOString(),
    niche: input.niche,
    cartKind: input.cartKind,
    shopify: input.shopify,
    checkpoints: input.rules.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      device: r.device,
      pass: r.pass,
      fail: r.fail,
      na: r.na,
      nicheNotes: r.nicheNotes,
      pageTypeIds: r.pageTypeIds,
    })),
    answers: input.results.map((r) => ({ id: r.ruleId, answer: r.status, reason: r.reason, coveredByShopify: r.coveredByShopify })),
    images,
  }
  const { error } = await store.upload(`scans/${id}/meta.json`, JSON.stringify(meta), { contentType: 'application/json', upsert: true })
  if (error) throw error
  return id
}

async function readJson<T>(path: string): Promise<T | null> {
  const store = await bucket()
  const { data, error } = await store.download(path)
  if (error || !data) return null
  try {
    return JSON.parse(await data.text()) as T
  } catch {
    return null
  }
}

export async function listTestScans(): Promise<{ id: string; createdAt: string }[]> {
  const store = await bucket()
  const { data, error } = await store.list('scans', { limit: 1000, sortBy: { column: 'created_at', order: 'desc' } })
  if (error) throw error
  return (data || []).filter((d) => d.name).map((d) => ({ id: d.name, createdAt: d.created_at || '' }))
}

export const getTestScan = (id: string) => readJson<LabScan>(`scans/${safeId(id)}/meta.json`)

export async function getLabels(id: string): Promise<Record<string, LabLabel>> {
  return (await readJson<Record<string, LabLabel>>(`labels/${safeId(id)}.json`)) || {}
}

export async function saveLabels(id: string, labels: Record<string, LabLabel>) {
  const store = await bucket()
  const { error } = await store.upload(`labels/${safeId(id)}.json`, JSON.stringify(labels), { contentType: 'application/json', upsert: true })
  if (error) throw error
}

/** Short-lived links to a scan's screenshots (the bucket is private). */
export async function imageUrls(scan: LabScan): Promise<string[]> {
  const store = await bucket()
  const { data, error } = await store.createSignedUrls(scan.images.map((i) => i.file), 60 * 60 * 6)
  if (error) throw error
  return (data || []).map((d) => d.signedUrl || '')
}

/** Lab pages and APIs: open on Vercel previews, LAB_KEY everywhere else. */
export function labAllowed(key: string | null | undefined) {
  const expected = process.env.LAB_KEY?.trim()
  if (expected) return key === expected
  return process.env.VERCEL_ENV === 'preview' || process.env.NODE_ENV === 'development'
}
