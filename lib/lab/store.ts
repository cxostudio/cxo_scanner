// Test lab: scans from test emails (CXO Studio, +test) are kept so Louis can label them blind
// and we can measure the scanner's accuracy per checkpoint before a checkpoint goes Live.
// Everything lives in one private Supabase Storage bucket, no database table needed:
//   scans/{id}/meta/{t}.json  url, niche, checkpoints with their definitions, the scanner's answers
//   scans/{id}/{n}.jpg     the screenshots the scanner judged from
//   scans/{id}/evidence.json  page text, measured facts, cart test: with the screenshots, all the
//                          judge needs to answer again (re-judge after a definition or prompt change)
//   labels/{id}/{t}.json   Louis's answers, per checkpoint
// Files that change are never overwritten: each save is a new timestamped file and reads take the
// newest from the folder listing. Supabase's CDN served stale copies of overwritten files for minutes.
// Customer scans are never stored here.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { noStoreFetch } from '@/lib/supabaseFetch'
import type { Evidence, Tile } from '@/lib/scanV2/capture'
import type { V2Row } from '@/lib/scanV2'
import type { ScanRule } from '@/lib/conversionCheckpoints/getCheckpointRules'

/** Which part of the evidence each saved image is, so it can be rebuilt for a re-judge. */
type ImageRole = 'desktop' | 'mobile' | 'mobileMenu' | 'cartHeader' | 'emptyCart' | 'cartView' | 'cartPage' | 'mobileCartView' | 'mobileCartPage'
type StoredEvidence = Omit<Evidence, 'desktopTiles' | 'mobileTiles' | 'mobileMenu' | 'cartHeader' | 'emptyCart' | 'cartView' | 'cartPage' | 'mobileCartView' | 'mobileCartPage'>

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
  area?: string
  method?: string
  /** Why the checkpoint is left out of the labelling queue: answered by code, or not for this niche. */
  skip?: 'measured' | 'niche'
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

const IMAGE_KEYS = ['desktopTiles', 'mobileTiles', 'mobileMenu', 'cartHeader', 'emptyCart', 'cartView', 'cartPage', 'mobileCartView', 'mobileCartPage'] as const

function roleTiles(ev: Evidence): { role: ImageRole; tile: Tile }[] {
  const out: { role: ImageRole; tile: Tile }[] = []
  const add = (role: ImageRole, t?: Tile | Tile[]) => (Array.isArray(t) ? t : t ? [t] : []).forEach((tile) => out.push({ role, tile }))
  add('desktop', ev.desktopTiles)
  add('mobile', ev.mobileTiles)
  add('mobileMenu', ev.mobileMenu)
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
  if (!client) client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: noStoreFetch } })
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
  // six at a time, with retries: storage refuses uploads when several scans save at once
  const tiles = roleTiles(ev)
  // unique names per save: a re-scan never overwrites a screenshot (overwritten files read back stale)
  const stamp = Date.now().toString(36)
  const images: { label: string; file: string; role: ImageRole }[] = []
  for (let start = 0; start < tiles.length; start += 6) {
    const chunk = await Promise.all(
      tiles.slice(start, start + 6).map(async ({ role, tile }, j) => {
        const file = `scans/${id}/${stamp}-${String(start + j).padStart(2, '0')}.jpg`
        const bytes = Buffer.from(tile.dataUrl.split(',')[1] || '', 'base64')
        for (let attempt = 0; ; attempt++) {
          const { error } = await store.upload(file, bytes, { contentType: 'image/jpeg', upsert: true })
          if (!error) break
          if (attempt >= 2) throw new Error(`could not save ${file}: ${error.message}`)
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
        }
        return { label: tile.label, file, role }
      }),
    )
    images.push(...chunk)
  }
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
  await writeVersion(store, `scans/${id}/meta`, meta)
  // a re-scan of the same scan id: remove the previous screenshots (labels are kept)
  const { data: files } = await store.list(`scans/${id}`, { limit: 1000 })
  const keep = new Set(images.map((i) => i.file))
  const old = (files || []).filter((f) => f.id && f.name.endsWith('.jpg') && !keep.has(`scans/${id}/${f.name}`)).map((f) => `scans/${id}/${f.name}`)
  if (old.length) await store.remove(old).catch(() => {})
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
  area: r.area,
  method: r.method,
})
const toAnswers = (results: V2Row[]): LabScan['answers'] => results.map((r) => ({ id: r.ruleId, answer: r.status, reason: r.reason, coveredByShopify: r.coveredByShopify }))

async function upload(store: Awaited<ReturnType<typeof bucket>>, path: string, data: unknown) {
  const { error } = await store.upload(path, JSON.stringify(data), { contentType: 'application/json', upsert: true, cacheControl: '0' })
  if (error) throw error
}

const KEEP_VERSIONS = 5

/** Save a new version under `folder` (never overwrite), keep the last few. */
async function writeVersion(store: Awaited<ReturnType<typeof bucket>>, folder: string, data: unknown) {
  await upload(store, `${folder}/${String(Date.now()).padStart(15, '0')}.json`, data)
  const { data: files } = await store.list(folder, { limit: 100 })
  const old = (files || []).map((f) => f.name).filter((n) => n.endsWith('.json')).sort().reverse().slice(KEEP_VERSIONS)
  if (old.length) await store.remove(old.map((n) => `${folder}/${n}`)).catch(() => {})
}

/** The newest version under `folder`, or the legacy single file. */
async function readLatest<T>(folder: string, legacy?: string): Promise<T | null> {
  const store = await bucket()
  const { data: files, error } = await store.list(folder, { limit: 100 })
  if (error) lastReadError = `${folder}: list failed ${error.message}`
  const newest = (files || []).map((f) => f.name).filter((n) => n.endsWith('.json')).sort().pop()
  if (newest) return readJson<T>(`${folder}/${newest}`)
  return legacy ? readJson<T>(legacy) : null
}

/** Rebuild the judge's evidence from a saved test scan. Null for scans saved before evidence was kept. */
export async function loadEvidence(scan: LabScan): Promise<Evidence | null> {
  const stored = await readJson<StoredEvidence>(`scans/${scan.id}/evidence.json`)
  if (!stored || scan.images.some((i) => !i.role)) return null
  const store = await bucket()
  // a few at a time, with one retry: storage drops downloads when many run at once
  const download = async (file: string) => {
    for (let attempt = 0; ; attempt++) {
      const { data, error } = await store.download(file)
      if (data) return Buffer.from(await data.arrayBuffer()).toString('base64')
      if (attempt >= 2) throw new Error(`could not download ${file}: ${error?.message || JSON.stringify(error)}`)
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
    }
  }
  const tiles: { role: ImageRole; tile: Tile }[] = []
  for (let i = 0; i < scan.images.length; i += 6) {
    const chunk = await Promise.all(
      scan.images.slice(i, i + 6).map(async (img) => ({ role: img.role as ImageRole, tile: { label: img.label, dataUrl: `data:image/jpeg;base64,${await download(img.file)}` } })),
    )
    tiles.push(...chunk)
  }
  const of = (role: ImageRole) => tiles.filter((t) => t.role === role).map((t) => t.tile)
  return {
    ...stored,
    desktopTiles: of('desktop'),
    mobileTiles: of('mobile'),
    mobileMenu: of('mobileMenu')[0],
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
  await writeVersion(store, `scans/${scan.id}/meta`, next)
  return next
}

/** Last read problem, reported by the lab APIs (storage errors are otherwise silent). */
export let lastReadError = ''

async function readJson<T>(path: string): Promise<T | null> {
  const store = await bucket()
  const { data, error } = await store.download(path)
  if (error || !data) {
    lastReadError = `${path}: ${error?.message || 'no data'}`
    return null
  }
  try {
    return JSON.parse(await data.text()) as T
  } catch (e) {
    lastReadError = `${path}: parse ${String(e).slice(0, 120)}`
    return null
  }
}

export async function listTestScans(): Promise<{ id: string; createdAt: string }[]> {
  const store = await bucket()
  const { data, error } = await store.list('scans', { limit: 1000 })
  if (error) throw error
  return (data || []).filter((d) => d.name).map((d) => ({ id: d.name, createdAt: d.created_at || '' }))
}

export const getTestScan = (id: string) => readLatest<LabScan>(`scans/${safeId(id)}/meta`, `scans/${safeId(id)}/meta.json`)

export async function getLabels(id: string): Promise<Record<string, LabLabel>> {
  return (await readLatest<Record<string, LabLabel>>(`labels/${safeId(id)}`, `labels/${safeId(id)}.json`)) || {}
}

export async function saveLabels(id: string, labels: Record<string, LabLabel>) {
  await writeVersion(await bucket(), `labels/${safeId(id)}`, labels)
}

/** Short-lived links to a scan's screenshots (the bucket is private). */
export async function imageUrls(scan: LabScan): Promise<string[]> {
  if (!scan.images?.length) return []
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

/** Remove a test scan: its screenshots, evidence, answers and labels. */
export async function deleteTestScan(id: string) {
  const store = await bucket()
  const safe = safeId(id)
  const files: string[] = []
  for (const folder of [`scans/${safe}`, `scans/${safe}/meta`, `labels/${safe}`]) {
    const { data } = await store.list(folder, { limit: 1000 })
    for (const f of data || []) if (f.id) files.push(`${folder}/${f.name}`)
  }
  files.push(`labels/${safe}.json`)
  for (let i = 0; i < files.length; i += 100) await store.remove(files.slice(i, i + 100))
  return files.length
}

/** Page areas in the order a shopper meets them: the labelling queue follows it. */
const AREA_ORDER = ['Header', 'Hero', 'Product grid', 'Filters and sorting', 'Gallery', 'Buy box', 'Description and details', 'Reviews and social proof', 'Recommendations', 'Cart drawer', 'Checkout form', 'Order summary', 'Page-wide', 'Footer', 'Technical']

/**
 * What Louis labels for a scan, in page order. Left out (with the reason): checkpoints the scanner
 * answers by code ("Measured"; checked against technical tools instead) and checkpoints that do not
 * apply to the store's niche (the scanner answers "not relevant" by rule).
 */
export function labelQueue(scan: LabScan): LabCheckpoint[] {
  const full = new Map((scan.rules || []).map((r) => [r.id, r]))
  const rank = (a?: string) => {
    const i = AREA_ORDER.indexOf(a || '')
    return i < 0 ? AREA_ORDER.length : i
  }
  return scan.checkpoints
    .map((c, i) => {
      const r = full.get(c.id)
      const method = c.method || r?.method
      const area = c.area || r?.area
      const only = (r?.niches || []).filter((n) => n !== 'All')
      const niche = scan.niche as string
      const outOfNiche = !!r && ((r.notRelevantNiches || []).includes(niche) || (only.length > 0 && !only.includes(niche)))
      const skip: LabCheckpoint['skip'] = method === 'Measured' ? 'measured' : outOfNiche ? 'niche' : undefined
      return { cp: { ...c, method, area, ...(skip ? { skip } : {}) }, i }
    })
    .sort((a, b) => rank(a.cp.area) - rank(b.cp.area) || a.i - b.i)
    .map((x) => x.cp)
}

/** Louis's notes per checkpoint ("the definition is wrong because..."), versioned like labels. */
export async function getNotes(id: string): Promise<Record<string, string>> {
  return (await readLatest<Record<string, string>>(`notes/${safeId(id)}`)) || {}
}

export async function saveNotes(id: string, notes: Record<string, string>) {
  await writeVersion(await bucket(), `notes/${safeId(id)}`, notes)
}

/** The text inside closed tabs / accordions the scanner read: the labelling page shows it. */
export async function getHiddenText(id: string): Promise<string> {
  const ev = await readJson<{ hiddenText?: string }>(`scans/${safeId(id)}/evidence.json`)
  return ev?.hiddenText || ''
}
