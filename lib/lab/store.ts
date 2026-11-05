// Test lab: scans from test emails (CXO Studio, +test) are kept so Louis can label them blind
// and we can measure the scanner's accuracy per checkpoint before a checkpoint goes Live.
// Everything lives in one private Supabase Storage bucket, no database table needed:
//   scans/{id}/meta.json   url, niche, checkpoints with their definitions, the scanner's answers
//   scans/{id}/{n}.jpg     the screenshots the scanner judged from
//   scans/{id}/evidence.json  page text, measured facts, cart test: with the screenshots, all the
//                          judge needs to answer again (re-judge after a definition or prompt change)
//   labels/{id}.json       Louis's answers, per checkpoint
// Customer scans are never stored here.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Evidence, Tile } from '@/lib/scanV2/capture'
import type { V2Row } from '@/lib/scanV2'
import type { ScanRule } from '@/lib/conversionCheckpoints/getCheckpointRules'

/** Which part of the evidence each saved image is, so it can be rebuilt for a re-judge. */
type ImageRole = 'desktop' | 'mobile' | 'cartHeader' | 'emptyCart' | 'cartView' | 'cartPage' | 'mobileCartView' | 'mobileCartPage'
type StoredEvidence = Omit<Evidence, 'desktopTiles' | 'mobileTiles' | 'cartHeader' | 'emptyCart' | 'cartView' | 'cartPage' | 'mobileCartView' | 'mobileCartPage'>

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
  images: { label: string; file: string; role?: ImageRole }[]
  /** The checkpoints as judged (full definitions), for re-judging when Airtable is unreachable. */
  rules?: ScanRule[]
  /** When the answers were last produced, and by which model. */
  judgedAt?: string
  model?: string
  /** Earlier runs on the same evidence, newest last. */
  history?: { judgedAt: string; model?: string; answers: LabScan['answers'] }[]
}

const IMAGE_KEYS = ['desktopTiles', 'mobileTiles', 'cartHeader', 'emptyCart', 'cartView', 'cartPage', 'mobileCartView', 'mobileCartPage'] as const

function roleTiles(ev: Evidence): { role: ImageRole; tile: Tile }[] {
  const out: { role: ImageRole; tile: Tile }[] = []
  const add = (role: ImageRole, t?: Tile | Tile[]) => (Array.isArray(t) ? t : t ? [t] : []).forEach((tile) => out.push({ role, tile }))
  add('desktop', ev.desktopTiles)
  add('mobile', ev.mobileTiles)
  add('cartHeader', ev.cartHeader)
  add('emptyCart', ev.emptyCart)
  add('cartView', ev.cartView)
  add('cartPage', ev.cartPage)
  add('mobileCartView', ev.mobileCartView)
  add('mobileCartPage', ev.mobileCartPage)
  return out
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

/** Keep one test scan: screenshots, the rest of the evidence, checkpoints with their definitions, the answers. */
export async function saveTestScan(input: { id: string; url: string; email: string; niche: string; model?: string; rules: ScanRule[]; results: V2Row[]; evidence: Evidence }) {
  const store = await bucket()
  const id = safeId(input.id) || `scan-${Date.now()}`
  const ev = input.evidence
  const images = await Promise.all(
    roleTiles(ev).map(async ({ role, tile }, i) => {
      const file = `scans/${id}/${String(i).padStart(2, '0')}.jpg`
      const bytes = Buffer.from(tile.dataUrl.split(',')[1] || '', 'base64')
      const { error } = await store.upload(file, bytes, { contentType: 'image/jpeg', upsert: true })
      if (error) throw error
      return { label: tile.label, file, role }
    }),
  )
  // everything but the images (saved above as files)
  const stored: Record<string, unknown> = { ...ev }
  for (const k of IMAGE_KEYS) delete stored[k]
  await upload(store, `scans/${id}/evidence.json`, stored as StoredEvidence)
  const meta: LabScan = {
    id,
    url: input.url,
    email: input.email,
    createdAt: new Date().toISOString(),
    niche: input.niche,
    cartKind: ev.cartKind,
    shopify: !!ev.isShopify,
    checkpoints: input.rules.map(toCheckpoint),
    answers: toAnswers(input.results),
    images,
    rules: input.rules,
    judgedAt: new Date().toISOString(),
    model: input.model,
  }
  await upload(store, `scans/${id}/meta.json`, meta)
  await addToIndex(store, id, meta.createdAt)
  return id
}

const toCheckpoint = (r: ScanRule): LabCheckpoint => ({
  id: r.id,
  title: r.title,
  status: r.status,
  device: r.device,
  pass: r.pass,
  fail: r.fail,
  na: r.na,
  nicheNotes: r.nicheNotes,
  pageTypeIds: r.pageTypeIds,
})
const toAnswers = (results: V2Row[]): LabScan['answers'] => results.map((r) => ({ id: r.ruleId, answer: r.status, reason: r.reason, coveredByShopify: r.coveredByShopify }))

// cacheControl 0: answers and labels change, and a cached copy would read back stale (default is 1 hour)
async function upload(store: Awaited<ReturnType<typeof bucket>>, path: string, data: unknown) {
  const { error } = await store.upload(path, JSON.stringify(data), { contentType: 'application/json', upsert: true, cacheControl: '0' })
  if (error) throw error
}

/** index.json: every saved test scan, newest first (folder listings proved unreliable). */
async function addToIndex(store: Awaited<ReturnType<typeof bucket>>, id: string, createdAt: string) {
  const index = (await readJson<{ id: string; createdAt: string }[]>('index.json')) || []
  const next = [{ id, createdAt }, ...index.filter((s) => s.id !== id)]
  await upload(store, 'index.json', next)
}

/** Rebuild the judge's evidence from a saved test scan. Null for scans saved before evidence was kept. */
export async function loadEvidence(scan: LabScan): Promise<Evidence | null> {
  const stored = await readJson<StoredEvidence>(`scans/${scan.id}/evidence.json`)
  if (!stored || scan.images.some((i) => !i.role)) return null
  const store = await bucket()
  const tiles = await Promise.all(
    scan.images.map(async (img) => {
      const { data, error } = await store.download(img.file)
      if (error || !data) throw error || new Error(`missing ${img.file}`)
      const b64 = Buffer.from(await data.arrayBuffer()).toString('base64')
      return { role: img.role as ImageRole, tile: { label: img.label, dataUrl: `data:image/jpeg;base64,${b64}` } }
    }),
  )
  const of = (role: ImageRole) => tiles.filter((t) => t.role === role).map((t) => t.tile)
  return {
    ...stored,
    desktopTiles: of('desktop'),
    mobileTiles: of('mobile'),
    cartHeader: of('cartHeader')[0],
    emptyCart: of('emptyCart')[0],
    cartView: of('cartView')[0],
    cartPage: of('cartPage'),
    mobileCartView: of('mobileCartView')[0],
    mobileCartPage: of('mobileCartPage'),
  }
}

/** Replace a scan's answers after a re-judge; the previous answers move to history. */
export async function saveRejudge(scan: LabScan, input: { rules: ScanRule[]; results: V2Row[]; niche: string; model?: string }) {
  const store = await bucket()
  const next: LabScan = {
    ...scan,
    niche: input.niche,
    checkpoints: input.rules.map(toCheckpoint),
    answers: toAnswers(input.results),
    rules: input.rules,
    history: [...(scan.history || []), { judgedAt: scan.judgedAt || scan.createdAt, model: scan.model, answers: scan.answers }].slice(-10),
    judgedAt: new Date().toISOString(),
    model: input.model,
  }
  await upload(store, `scans/${scan.id}/meta.json`, next)
  return next
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
  const index = (await readJson<{ id: string; createdAt: string }[]>('index.json')) || []
  // scans saved before the index existed: pick them up from the folder listing
  const store = await bucket()
  const { data } = await store.list('scans', { limit: 1000 })
  const known = new Set(index.map((s) => s.id))
  const extra = (data || []).filter((d) => d.name && !known.has(d.name)).map((d) => ({ id: d.name, createdAt: d.created_at || '' }))
  return [...index, ...extra]
}

export const getTestScan = (id: string) => readJson<LabScan>(`scans/${safeId(id)}/meta.json`)

export async function getLabels(id: string): Promise<Record<string, LabLabel>> {
  return (await readJson<Record<string, LabLabel>>(`labels/${safeId(id)}.json`)) || {}
}

export async function saveLabels(id: string, labels: Record<string, LabLabel>) {
  await upload(await bucket(), `labels/${safeId(id)}.json`, labels)
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
