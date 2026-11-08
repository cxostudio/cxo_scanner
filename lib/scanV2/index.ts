// Scan engine v2: capture evidence once, judge every checkpoint with it.
// Returns rows in the same shape as engine v1, so the run and results pages are unchanged.
// Extra field `status` separates "not relevant" and "couldn't check" from real passes and fails.
import { applyGuards } from './guards'

const EMPTY_CART = 'rec53BnzEh3jbjz4O'
import { captureEvidence, PageCheckError, type Evidence, type Tile } from './capture'
import { judge, V2_MODEL, type Niche, type Rule, type Verdict } from './judge'
import { MEASURED } from './measured'

export { PageCheckError }

export type V2Row = {
  ruleId: string
  ruleTitle: string
  passed: boolean
  reason: string
  status: 'pass' | 'fail' | 'na' | 'unknown'
  /** Shopify does this by default: counted as passed, grouped as one line in the report. */
  coveredByShopify?: boolean
  /** For the lab: the definition line the AI used, where it saw the evidence, and what overruled it. */
  rule?: string
  seen?: string[]
  by?: 'Seen in' | 'Code check' | 'Measured'
}

type Answer = Omit<Verdict, 'id'>

/** Hard niche rules from Airtable: "Not relevant for niches", and "Niches" when it is a closed list. */
function nicheVerdict(r: Rule, niche: Niche): Answer | null {
  if (r.notRelevantNiches?.includes(niche))
    return { answer: 'na', evidence: `Not relevant for ${niche.toLowerCase()} stores.` }
  const only = (r.niches || []).filter((n) => n !== 'All')
  if (only.length && !only.includes(niche))
    return { answer: 'na', evidence: `Only checked for ${only.map((n) => n.toLowerCase()).join(', ')} stores.` }
  return null
}

/** Every image the judge sees, in order. Test scans store them in this order (lib/lab). */
export function evidenceImages(ev: Evidence): Tile[] {
  return [...ev.desktopTiles, ...ev.mobileTiles, ...(ev.tabTiles || []), ev.mobileMenu, ev.cartHeader, ev.emptyCart, ev.cartView, ...(ev.cartPage || []), ev.mobileCartView, ...(ev.mobileCartPage || [])].filter(Boolean) as Tile[]
}

const UNMEASURED = 'This is measured in the page code, and the scanner could not measure it on this page.'

/**
 * Judge captured evidence: Shopify defaults and code measurements first, the model for the rest,
 * then the hard niche rules. Used by live scans and by the lab to re-judge saved test scans.
 */
/**
 * Buying checkpoints of the product page itself (buy box): not relevant when the page does not sell
 * online. The cart is the store's and stays judged (the store sells other products online).
 */
const PURCHASE = /add-to-cart button|main add-to-cart|shipping|deliver|arrive|return|in stock|stock is low|restock|quantity discount|trust signals|time-based urgency/i
const STORE_ONLY = /find in (a )?store|where to buy|store locator|find a (store|retailer)|buy in store|vind een winkel|trouver un magasin|händler finden/i
const ADD_TO_CART = /add to (cart|bag|basket)|ajouter au panier|in (de )?winkel(wagen|mand)|in den warenkorb|añadir al carrito|aggiungi al carrello|subscribe & save|pre-?order/i

/** A product page that sends shoppers to stores instead of selling: a store-locator button and no add-to-cart. */
function sellsOnline(ev: Evidence): boolean {
  if (typeof ev.sellsOnline === 'boolean') return ev.sellsOnline
  const f = ev.facts as Record<string, any>
  const buttons: string[] = f.buttons || []
  const text = `${buttons.join(' | ')} ${f.buyBox || ''}`
  if (f.variants?.atc?.ready) return true
  return !(STORE_ONLY.test(text) && !ADD_TO_CART.test(text))
}

/** How many products the store sells (Shopify products.json, up to 250), for checkpoints that only matter on bigger catalogues. */
async function countCatalog(ev: Evidence) {
  const f = ev.facts as Record<string, any>
  if (!ev.isShopify || !f || typeof f.catalogSize === 'number') return
  try {
    const u = new URL(ev.url)
    const r = await fetch(`${u.origin}/products.json?limit=250&fields=id`, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
    if (!r.ok) return
    const p = await r.json()
    if (Array.isArray(p?.products)) f.catalogSize = p.products.length
  } catch {}
}

/** Scans saved before discounts were measured: read the product's compare-at prices now (Shopify product .js). */
async function backfillDiscounts(ev: Evidence) {
  const v = (ev.facts as Record<string, any>)?.variants
  if (!ev.isShopify || !v || (typeof v.discounted === 'number' && Array.isArray(v.ratios))) return
  try {
    const u = new URL(ev.url)
    if (!/\/products\//.test(u.pathname)) return
    const r = await fetch(`${u.origin}${u.pathname.replace(/\/$/, '')}.js`, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
    if (!r.ok) return
    const p = await r.json()
    if (typeof v.discounted !== 'number') v.discounted = (p.variants || []).filter((x: any) => x.compare_at_price && x.compare_at_price > x.price).length
    // the shape of each gallery image, for "do all gallery images share the same shape"
    v.ratios = (p.media || []).filter((m: any) => m.media_type === 'image' && m.aspect_ratio).map((m: any) => Number(m.aspect_ratio))
  } catch {}
}

export async function judgeEvidence(ev: Evidence, rules: Rule[], apiKey: string, opts: { guards?: boolean } = {}) {
  ev.sellsOnline = sellsOnline(ev)
  await backfillDiscounts(ev)
  await countCatalog(ev)
  const settled = new Map<string, Answer & { coveredByShopify?: boolean }>()
  for (const r of rules) {
    if (ev.isShopify && r.shopifyControl === 'Handled by Shopify') {
      settled.set(r.id, { answer: 'pass', evidence: 'Shopify handles this by default.', coveredByShopify: true })
      continue
    }
    const m = MEASURED[r.id]?.(ev, ev.facts as Record<string, any>)
    if (m) {
      settled.set(r.id, m)
      continue
    }
    // a Draft checkpoint defined as "Measured" with no conclusive measurement: the model would
    // only guess from screenshots (hover, keyboards, load times), so we say we could not check it
    if (r.status === 'Draft' && r.method === 'Measured') settled.set(r.id, { answer: 'unknown', evidence: UNMEASURED })
  }
  const measured = settled.size
  const { niche, verdicts, usage } = await judge(ev, rules.filter((r) => !settled.has(r.id)), apiKey)
  const byId = new Map<string, Answer & { coveredByShopify?: boolean }>(verdicts.map((v) => [v.id, v]))
  for (const [id, m] of Array.from(settled)) byId.set(id, m)
  // a page that does not sell online: buying checkpoints are not relevant, whatever the model said
  if (ev.sellsOnline === false)
    for (const r of rules) if (r.area === 'Buy box' && PURCHASE.test(r.title)) byId.set(r.id, { answer: 'na', evidence: 'This page does not sell online (the main button sends shoppers to stores), so this does not apply.' })
  // definitions the model keeps breaking (threshold read as a shipping cost, generic header entries, cart read as the buy box)
  // where the evidence sits must match Airtable "Seen in": the same rule for every checkpoint
  applySeenIn(rules, byId, verdicts)
  if (opts.guards !== false) applyGuards(rules, byId)
  // no picture of a filled cart: cart checkpoints cannot be judged (the model otherwise borrows the product page)
  const filledCart = !!(ev.cartView || ev.cartPage?.length || ev.mobileCartView || ev.mobileCartPage?.length)
  if (!filledCart)
    for (const r of rules)
      if (/cart/i.test(r.area || '') && r.id !== EMPTY_CART && !settled.has(r.id) && !byId.get(r.id)?.coveredByShopify && byId.get(r.id)?.answer !== 'na')
        byId.set(r.id, { answer: 'unknown', evidence: 'We could not open the cart with a product in it on this store, so we could not check this.' })
  // niche rules are facts in Airtable, not the model's call: they override any answer
  for (const r of rules) {
    const n = nicheVerdict(r, niche)
    if (n && !byId.get(r.id)?.coveredByShopify) byId.set(r.id, n)
  }
  const results: V2Row[] = rules.map((r) => {
    const v = byId.get(r.id)
    const status = v?.answer ?? 'unknown'
    return {
      ruleId: r.id,
      ruleTitle: r.title,
      // "not relevant" never counts against the store; "couldn't check" is shown apart by the results page
      passed: status === 'pass' || status === 'na',
      reason: v?.evidence || 'We could not check this one.',
      status,
      ...(v?.coveredByShopify ? { coveredByShopify: true } : {}),
      ...(v?.rule ? { rule: v.rule } : {}),
      ...(v?.seen?.length ? { seen: v.seen } : {}),
      ...(v?.by ? { by: v.by } : settled.has(r.id) && !v?.coveredByShopify ? { by: 'Measured' as const } : {}),
    }
  })
  return { results, niche, measured, usage }
}

export async function runScanV2(url: string, rules: Rule[], apiKey: string, opts: { extended?: boolean } = {}) {
  const t0 = Date.now()
  // the extra capture steps run when a checkpoint needs them: always in test mode
  const ev = await captureEvidence(url, { extended: opts.extended || rules.some((r) => r.status === 'Draft') })
  const t1 = Date.now()
  const { results, niche, measured, usage } = await judgeEvidence(ev, rules, apiKey)
  const screenshot = ev.desktopTiles[0]?.dataUrl ?? null
  console.log(`[scanV2] ${url} ${rules.length} checkpoints, niche ${niche}, capture ${t1 - t0}ms judge ${Date.now() - t1}ms model ${V2_MODEL()} tiles ${ev.desktopTiles.length}+${ev.mobileTiles.length}`)
  const diag = {
    facts: Object.keys(ev.facts).length,
    tiles: `${ev.desktopTiles.length}+${ev.mobileTiles.length}`,
    cart: ev.cartTest,
    cartTile: !!ev.cartHeader,
    cartKind: ev.cartKind,
    emptyCart: !!ev.emptyCart,
    cartImages: [ev.cartView, ...(ev.cartPage || []), ev.mobileCartView, ...(ev.mobileCartPage || [])].filter(Boolean).length,
    shopify: !!ev.isShopify,
    niche,
    textChars: ev.text.length,
    hiddenChars: ev.hiddenText.length,
    measured,
    checkpoints: rules.length,
    usage,
    images: evidenceImages(ev).length,
  }
  return { results, screenshot, niche, evidence: ev, timings: { captureMs: t1 - t0, judgeMs: Date.now() - t1 }, model: V2_MODEL(), diag }
}

/**
 * A pass whose evidence sits only in places the checkpoint does not allow (Airtable "Seen in")
 * becomes a fail. Generic: no checkpoint is named here. Measured and Shopify answers are left alone.
 */
function applySeenIn(rules: Rule[], byId: Map<string, { answer: string; evidence: string; coveredByShopify?: boolean }>, verdicts: Verdict[]) {
  const seenOf = new Map(verdicts.map((v) => [v.id, v.seen]))
  for (const r of rules) {
    const allowed = (r.seenIn || []).filter(Boolean)
    if (!allowed.length || allowed.includes('Anywhere')) continue
    const v = byId.get(r.id)
    const seen = seenOf.get(r.id)
    if (!v || v.answer !== 'pass' || v.coveredByShopify || !seen?.length) continue
    // the header is part of the first screen
    const ok = (p: string) => allowed.includes(p) || (p === 'Header' && allowed.includes('First screen'))
    if (seen.some(ok)) continue
    byId.set(r.id, { answer: 'fail', evidence: `This is only on the ${seen.join(' and ').toLowerCase()}, not where it counts (${allowed.join(', ').toLowerCase()}).`, seen, by: 'Seen in' } as any)
  }
}
