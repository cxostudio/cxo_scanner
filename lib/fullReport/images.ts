// Screenshots of a full report (pages with pins, cart, checkout), in a private storage bucket.
// The report API hands out short-lived signed links; nothing here is public.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { noStoreFetch } from '@/lib/supabaseFetch'
import type { Evidence, Tile } from '@/lib/scanV2/capture'

const BUCKET = 'reports'
let client: SupabaseClient | null = null
let ready = false

function sb(): SupabaseClient {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase is not configured')
  if (!client) client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: noStoreFetch } })
  return client
}
async function bucket() {
  if (!ready) {
    const { error } = await sb().storage.createBucket(BUCKET, { public: false })
    if (error && !/already exists|duplicate/i.test(error.message)) throw error
    ready = true
  }
  return sb().storage.from(BUCKET)
}

/** Save one image (a data URL) and return its path in the bucket. */
export async function saveImage(path: string, dataUrl: string): Promise<string> {
  const store = await bucket()
  const [head, b64] = dataUrl.split(',')
  const type = /image\/png/.test(head || '') ? 'image/png' : 'image/jpeg'
  const bytes = Buffer.from(b64 || '', 'base64')
  for (let attempt = 0; ; attempt++) {
    const { error } = await store.upload(path, bytes, { contentType: type, upsert: true })
    if (!error) return path
    if (attempt >= 2) throw new Error(`could not save ${path}: ${error.message}`)
    await new Promise((r) => setTimeout(r, 500 * (attempt + 1)))
  }
}

export type ReportImage = { role: 'cart' | 'checkout'; device: 'desktop' | 'mobile'; label: string; file: string }

/** The cart and checkout screenshots a product scan took, saved for the report. */
export async function saveFlowImages(reportPageId: string, ev: Evidence): Promise<ReportImage[]> {
  const list: { role: ReportImage['role']; device: ReportImage['device']; tile: Tile }[] = []
  const add = (role: ReportImage['role'], device: ReportImage['device'], t?: Tile | Tile[]) => (Array.isArray(t) ? t : t ? [t] : []).forEach((tile) => list.push({ role, device, tile }))
  add('cart', 'desktop', ev.cartView); add('cart', 'desktop', ev.cartPage)
  add('cart', 'mobile', ev.mobileCartView); add('cart', 'mobile', ev.mobileCartPage)
  add('checkout', 'desktop', ev.checkout); add('checkout', 'mobile', ev.mobileCheckout)
  const stamp = Date.now().toString(36)
  const out: ReportImage[] = []
  for (let i = 0; i < list.length; i += 6) {
    out.push(...await Promise.all(list.slice(i, i + 6).map(async ({ role, device, tile }, j) => ({
      role, device, label: tile.label, file: await saveImage(`${reportPageId}/${stamp}-${role}-${device}-${i + j}.jpg`, tile.dataUrl),
    }))))
  }
  return out
}

/** Signed links (1 hour) for the given paths, in the same order. */
export async function signedUrls(paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const uniq = Array.from(new Set(paths.filter(Boolean)))
  if (!uniq.length) return out
  const { data, error } = await (await bucket()).createSignedUrls(uniq, 3600)
  if (error) throw new Error(error.message)
  for (const d of data || []) if (d.path && d.signedUrl) out.set(d.path, d.signedUrl)
  return out
}
