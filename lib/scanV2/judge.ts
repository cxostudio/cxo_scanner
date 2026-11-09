// Scan engine v2, step 2: a stronger model judges every checkpoint from the full evidence.
// Checkpoints go in fixed groups, in parallel, at temperature 0, and every answer must
// cite what was seen. "unknown" is allowed: we never guess.
import { OpenRouter } from '@openrouter/sdk'
import type { Evidence } from './capture'
import type { ScanRule } from '@/lib/conversionCheckpoints/getCheckpointRules'
import { detectPageTypeFromUrl, type UrlPageType } from '@/lib/conversionCheckpoints/pageType'

// A checkpoint with CXO Studio's definitions, straight from Airtable (getCheckpointRules.ts).
export type Rule = ScanRule
export type Verdict = { id: string; answer: 'pass' | 'fail' | 'na' | 'unknown'; evidence: string; seen?: string[]; rule?: string; by?: 'Seen in' | 'Code check' | 'Measured' }

/** Places on the page, as in Airtable "Seen in". The model says where its evidence sits. */
export const PLACES = ['First screen', 'Header', 'Menu', 'Buy box', 'Gallery', 'Page sections', 'Cart', 'Footer', 'Pop-up or banner', 'Page code'] as const

/** Niche names as in the Airtable "Niches" and "Not relevant for niches" fields. */
export const NICHES = [
  'Fashion',
  'Beauty and skincare',
  'Food and drink',
  'Home and furniture',
  'Electronics',
  'Health and supplements',
  'Pets',
  'Sports and outdoor',
  'Kids',
  'Other',
] as const
export type Niche = (typeof NICHES)[number]

export const V2_MODEL = () => process.env.SCAN_V2_MODEL || 'google/gemini-2.5-flash'
const GROUP_SIZE = 8
const MISSING = '__missing__'

type PageKind = UrlPageType

/** What the page is, in the words the model reads, and the rules that only hold for that kind of page. */
const PAGE: Record<PageKind, { name: string; niche: string; rules: string }> = {
  product: {
    name: 'product page',
    niche: 'from the product on this page',
    rules: `- A sale price or "save X%" is not a quantity discount. A quantity discount means the price per item drops when buying more.
- Labels: judge the main buttons of the page (add to cart, buy box), not navigation links.`,
  },
  homepage: {
    name: 'HOMEPAGE',
    niche: 'from what the store sells (hero, featured products, menu)',
    rules: `- The hero is the first screen. "First screen" means the first desktop screenshot or the first mobile screenshot; "first two screens" means mobile screenshots 1 and 2.
- This is not a product page: checkpoints about a buy box, an add-to-cart button, a product gallery or product details are "na" here, unless this page shows that element itself (quick-add buttons on product cards count).`,
  },
  category: {
    name: 'CATEGORY (collection) page',
    niche: 'from the products in the grid',
    rules: `- The product grid, its filters and sorting, and the product cards are what this page is about. "Where products start" means how far down the first product card appears, on mobile first.
- This is not a product page: checkpoints about a buy box, an add-to-cart button, a product gallery or product details are "na" here, unless the product cards show that element themselves (quick-add buttons count).`,
  },
  other: {
    name: 'page',
    niche: 'from what the store sells',
    rules: `- Checkpoints about elements this kind of page does not have are "na".`,
  },
}

function systemFor(kind: PageKind) {
  const page = PAGE[kind]
  return `You are a senior CRO (conversion rate optimisation) practitioner auditing one e-commerce ${page.name}.
You get screenshots of the page (desktop and mobile, top to bottom, plus the footer), the page text, text hidden inside closed tabs/accordions, and facts measured in the page code. Use all of it: the screenshots for what a shopper sees, the facts for things screenshots cannot show (colours, lazy loading, links, form inputs).

For each checkpoint, decide whether the page meets "what good looks like":
- "pass": the page clearly does it (in spirit; a reasonable practitioner would tick it).
- "fail": it clearly does not, or the element is missing where it should be.
- "na": the checkpoint does not make sense for this store or this page (e.g. size guide for a coffee pack, before/after photos for a sofa). Use sparingly: missing-but-relevant is "fail".
- "unknown": the evidence genuinely cannot settle it. Never guess.

Rules:
- Answer polarity: "pass" always means the page meets what good looks like. For a negative question ("Do you use pure black for text or backgrounds?") pure black present means "fail".
- Judge the page as a shopper sees it. Header, navigation and footer count for checkpoints about them.
- Elements in the header are easy to miss in text: check the header screenshot and the measured header controls (icons without text, like a magnifier or bag icon, still count).
${page.rules}

First decide the store's niche, ${page.niche}. Use exactly one of: ${NICHES.join(', ')}. Fashion covers apparel, footwear, bags and jewellery.

Each checkpoint comes with "pass when", "fail when" and "not relevant when" rules, plus niche notes. Follow them exactly: they are CXO Studio's definitions and override the generic description. Use the description only for context.
- "device" says which screenshots to judge. "desktop only" or "mobile only": ignore the other device. "judge desktop and mobile": the checkpoint must be met on BOTH. When one device clearly shows it and the other device's screenshots of the same part of the page clearly do not, answer "fail" and start the evidence with the device that misses it ("On mobile, ..."). When the other device's screenshots do not cover that part of the page, judge on the device that does.
- Where something sits matters. The footer is never the first screen, never a homepage section and never "near the button": evidence found only in the footer does not pass those checkpoints.
- "only for niches" / "not relevant for niches": if the store's niche is outside the first list or inside the second, answer "na".
- Mobile menu checkpoints are judged on the "mobile MENU opened" image (the menu after tapping the menu button). Without it they are "unknown".
- Cart checkpoints are judged on the cart images (taken with one item in the cart). When the store has a cart DRAWER, judge the drawer: it is what most shoppers use on the way to checkout. Use the cart page only for something the drawer sends shoppers to (a "view cart" link) or when there is no drawer. Say in the evidence whether you judged the drawer or the cart page. Without cart images, cart checkpoints are "unknown".
- Empty-cart checkpoints are judged ONLY on the "EMPTY cart" image. Without it they are "unknown"; never judge them from a cart that holds an item.
- Every other cart checkpoint is judged ONLY on the images taken after one item was added ("cart view after one item was added", "CART PAGE"). Ignore the EMPTY cart image for them: an empty cart shows no product lines, totals or checkout button by design.
- Pass only for something you can point to in the screenshots, the page text or the measured facts. Do not infer a feature from a nearby word (a shipping badge is not a coupon field).
- Hover, focus, keyboard type, animation, load speed and sticky or fixed elements while scrolling cannot be seen in screenshots: unless the measured facts settle it, answer "unknown".
- Live activity ("24 people have this in their cart", "12 viewing now") is not how many people bought or use the product: that needs a count of customers, orders or reviews.
- An FAQ means questions with answers. Product detail tabs or accordions (Details, Dimensions, Care, Shipping) are not an FAQ.
- Footer checkpoints: the measured footer links are the list of what the footer contains. Never name a footer link that is not in that list.
- Variant options drawn crossed out, struck through, greyed out or with a diagonal line are sold out or unavailable, and that marking counts as clearly showing it.
- Cart line checkpoints (product lines, discounts, quantities) are about the items IN the cart only. Products recommended inside the cart ("You may also like", "Optimize your routine") are not cart items.
- Buy box checkpoints ("near the button", "near the price", "near the CTA") are judged ONLY on the product page screenshots. Something shown only in the cart drawer, the cart page or the footer is not near the button: that is a fail.
- When ONLINE PURCHASE is NOT OFFERED on this product page, the buy box checkpoints about buying it are "na" (add-to-cart button, shipping, delivery dates, returns, stock status, quantity discounts). The cart, header, footer and the rest of the page are still judged: the store sells other products online.
- The answer must match the evidence: when your evidence says the checkpoint does not apply (product in stock, no bundle, single option), the answer is "na", never "fail".

- Write "evidence" for the store owner: one short, plain sentence naming what is (or is not) on their page and where. No screenshot numbers, no jargon, no em dashes.

- Check the rules in the order given: "not relevant when" first, then "fail when", and only then "pass when". In "rule", name the line your answer rests on and quote its key words (for example: fail when: "only in the footer").
- In "seen", list where on the page your evidence sits, using only these names: ${PLACES.join(', ')}. First screen = visible without scrolling (announcement bar and header included). Page sections = the blocks below the first screen and outside the buy box, gallery and footer. The "product gallery image N of M" pictures are every image of the product gallery, from the store's own product data: they count as Gallery, even when the screenshots only show the first one. Product tabs the scanner opened ("product tab ... opened" images, "OPENED PRODUCT TABS" text) count as Page sections, or Buy box when the tabs sit inside the buy box. Page code = the measured facts. When a checkpoint says "counts only when seen in", something found only elsewhere is a "fail".

Reply with JSON only: {"niche":"<one of the niches>","results":[{"id":"<checkpoint id>","answer":"pass|fail|na|unknown","rule":"<the line it rests on>","seen":["<place>"],"evidence":"..."}]} with exactly one entry per checkpoint given.`
}

/** The kind of page: captured with the evidence, or read from the URL for scans saved before that. */
export const pageKindOf = (ev: Evidence): PageKind => ev.pageType || detectPageTypeFromUrl(ev.finalUrl || ev.url)

function evidenceText(ev: Evidence, scope: Scope | 'all' = 'all') {
  const pageText = scope !== 'cart'
  return [
    `PAGE: ${ev.finalUrl} (${PAGE[pageKindOf(ev)].name})`,
    `TITLE: ${ev.title}`,
    `MEASURED FACTS (desktop): ${JSON.stringify(ev.facts)}`,
    `MEASURED FACTS (mobile): ${JSON.stringify(ev.mobileFacts)}`,
    `PLATFORM: ${ev.isShopify ? 'Shopify' : 'not Shopify (or not detected)'}`,
    ev.sellsOnline === false ? 'ONLINE PURCHASE: NOT OFFERED on this page. The main button sends shoppers to a store locator ("Find in store" / "Where to buy"); there is no add-to-cart.' : '',
    `CART TEST: ${ev.cartTest || 'not run'}${ev.cartHeader ? ' (see the image of the header after adding to cart)' : ''}${ev.cartView || ev.mobileCartView ? ' (see the images of the cart view after adding to cart)' : ''}`,
    `CART TYPE: ${ev.cartKind === 'drawer' ? (ev.cartPage?.length || ev.mobileCartPage?.length ? 'the cart icon opens a cart DRAWER; the cart page (/cart) is captured too' : 'the cart icon opens a cart DRAWER; the store has no separate cart page') : ev.cartKind === 'page' ? 'the cart icon goes to the CART PAGE (no drawer)' : ev.cartKind === 'none' ? 'nothing opened from the cart icon; the cart page (/cart) is captured' : 'cart not tested'}`,
    pageText ? `VISIBLE TEXT (desktop, top to bottom):\n${ev.text}` : 'Judge these cart checkpoints ONLY on the cart images below. The product page is not shown on purpose.',
    pageText && ev.hiddenText ? `TEXT INSIDE CLOSED TABS / ACCORDIONS:\n${ev.hiddenText}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

type Tile = Evidence['desktopTiles'][number]
type Scope = 'header' | 'footer' | 'cart' | 'page'

/** Which part of the evidence a page area is judged on. */
function scopeOf(area?: string): Scope {
  const a = (area || '').toLowerCase()
  if (/header|navigation|menu/.test(a)) return 'header'
  if (/footer/.test(a)) return 'footer'
  if (/cart|checkout/.test(a)) return 'cart'
  return 'page'
}

/**
 * Only the images an area needs: the cart is judged on cart images and never on the product page,
 * the buy box never on the cart drawer, the footer on the footer. Fewer images, fewer wrong reads.
 */
function tilesFor(ev: Evidence, scope: Scope | 'all'): Tile[] {
  const isFooter = (t: Tile) => /footer|page bottom/i.test(t.label)
  const cart = [ev.emptyCart, ev.cartView, ...(ev.cartPage || []), ev.mobileCartView, ...(ev.mobileCartPage || [])].filter(Boolean) as Tile[]
  const page = [...ev.desktopTiles, ...ev.mobileTiles]
  const tabs = [...(ev.tabTiles || []), ...(ev.galleryTiles || [])]
  if (scope === 'header') return [ev.desktopTiles[0], ev.mobileTiles[0], ev.mobileMenu, ev.cartHeader].filter(Boolean) as Tile[]
  if (scope === 'footer') return page.filter(isFooter)
  if (scope === 'cart') return [...(ev.cartHeader ? [ev.cartHeader] : []), ...cart]
  if (scope === 'page') return [...page, ...tabs]
  return [...page, ...tabs, ...(ev.mobileMenu ? [ev.mobileMenu] : []), ...(ev.cartHeader ? [ev.cartHeader] : []), ...cart]
}

function images(ev: Evidence, scope: Scope | 'all' = 'all') {
  const tiles = tilesFor(ev, scope)
  return tiles.flatMap((t) => [
    { type: 'text' as const, text: `[${t.label}]` },
    { type: 'image_url' as const, imageUrl: { url: t.dataUrl } },
  ])
}

function parse(raw: unknown): { niche?: string; results: Verdict[] } {
  let s = ''
  if (typeof raw === 'string') s = raw
  else if (Array.isArray(raw)) s = raw.filter((p: any) => p?.type === 'text').map((p: any) => p.text).join('')
  s = s.replace(/^```(json)?/i, '').replace(/```$/, '').trim()
  const j = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1))
  return { niche: typeof j.niche === 'string' ? j.niche : undefined, results: (j.results || []) as Verdict[] }
}

const DEVICE: Record<string, string> = {
  Both: 'judge desktop and mobile',
  'Desktop only': 'judge on desktop only',
  'Mobile only': 'judge on mobile only',
}

function describe(r: Rule): string {
  const desc = r.description.replace(/\s+/g, ' ').slice(0, r.pass ? 400 : 900)
  if (!r.pass) return `- id: ${r.id}\n  question: ${r.title}\n  what good looks like: ${desc}`
  const only = (r.niches || []).filter((n) => n !== 'All')
  return [
    `- id: ${r.id}`,
    `  question: ${r.title}`,
    `  device: ${DEVICE[r.device || 'Both'] || DEVICE.Both}`,
    // the exclusions first: the model otherwise passes on its first impression and skims the rest
    r.na ? `  not relevant when: ${r.na}` : '',
    r.fail ? `  fail when: ${r.fail}` : '',
    `  pass when: ${r.pass}`,
    r.seenIn?.length && !r.seenIn.includes('Anywhere') ? `  counts only when seen in: ${r.seenIn.join(', ')}` : '',
    only.length ? `  only for niches: ${only.join(', ')}` : '',
    r.notRelevantNiches?.length ? `  not relevant for niches: ${r.notRelevantNiches.join(', ')}` : '',
    r.nicheNotes ? `  niche notes: ${r.nicheNotes}` : '',
    `  description (context only): ${desc}`,
  ]
    .filter(Boolean)
    .join('\n')
}

export type Usage = { calls: number; inputTokens: number; outputTokens: number; costUsd: number }

async function judgeGroup(client: OpenRouter, ev: Evidence, group: Rule[], shared: { text: string; imgs: ReturnType<typeof images> }, usage?: Usage): Promise<{ niche?: string; verdicts: Verdict[] }> {
  const list = group.map(describe).join('\n')
  const content = [
    { type: 'text' as const, text: shared.text },
    ...shared.imgs,
    { type: 'text' as const, text: `CHECKPOINTS TO JUDGE (${group.length}):\n${list}\n\nReply with the JSON object only.` },
  ]
  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res: any = await client.chat.send({
        model: V2_MODEL(),
        messages: [
          { role: 'system', content: systemFor(pageKindOf(ev)) },
          { role: 'user', content: content as any },
        ],
        temperature: 0,
        topP: 0.1,
        seed: 42,
        maxTokens: 6000,
        stream: false,
        responseFormat: { type: 'json_object' },
      } as any)
      if (usage) {
        const u = res?.usage || {}
        usage.calls++
        usage.inputTokens += Number(u.promptTokens ?? u.prompt_tokens ?? 0)
        usage.outputTokens += Number(u.completionTokens ?? u.completion_tokens ?? 0)
        usage.costUsd += Number(u.cost ?? 0)
      }
      const parsed = parse(res?.choices?.[0]?.message?.content)
      const byId = new Map(parsed.results.map((v) => [v.id, v]))
      const verdicts = group.map((r) => {
        const v = byId.get(r.id)
        const answer = v && ['pass', 'fail', 'na', 'unknown'].includes(String(v.answer).toLowerCase()) ? (String(v.answer).toLowerCase() as Verdict['answer']) : 'unknown'
        // MISSING: the model skipped this checkpoint; judge() asks again for those
        const seen = Array.isArray(v?.seen) ? v!.seen.filter((x): x is string => typeof x === 'string') : undefined
        return { id: r.id, answer: v ? answer : 'unknown', evidence: v ? (v.evidence || 'We could not check this one.').replace(/\s*—\s*/g, ', ') : MISSING, seen, rule: typeof v?.rule === 'string' ? v.rule.slice(0, 200) : undefined }
      })
      return { niche: parsed.niche, verdicts }
    } catch (e) {
      lastErr = e
    }
  }
  console.warn('[scanV2] group failed', lastErr)
  return { verdicts: group.map((r) => ({ id: r.id, answer: 'unknown', evidence: 'We could not check this one.' })) }
}

/** The niche most groups agreed on, matched to the Airtable names. */
function majorityNiche(answers: (string | undefined)[]): Niche {
  const counts = new Map<Niche, number>()
  for (const a of answers) {
    const n = NICHES.find((x) => x.toLowerCase() === (a || '').trim().toLowerCase())
    if (n) counts.set(n, (counts.get(n) || 0) + 1)
  }
  let best: Niche = 'Other'
  let max = 0
  for (const [n, c] of Array.from(counts)) if (c > max) [best, max] = [n, c]
  return best
}

export async function judge(ev: Evidence, rules: Rule[], apiKey: string): Promise<{ niche: Niche; verdicts: Verdict[]; usage: Usage }> {
  const client = new OpenRouter({ apiKey })
  const usage: Usage = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }
  // one set of requests per part of the page, each with only that part's images; a stable order
  // (by id) so the same checkpoints are always judged together from one run to the next
  const byScope = new Map<Scope, Rule[]>()
  for (const r of [...rules].sort((x, y) => x.id.localeCompare(y.id))) {
    const sc = scopeOf(r.area)
    byScope.set(sc, [...(byScope.get(sc) || []), r])
  }
  const jobs: { group: Rule[]; shared: { text: string; imgs: ReturnType<typeof images> } }[] = []
  for (const [sc, list] of Array.from(byScope)) {
    const shared = { text: evidenceText(ev, sc), imgs: images(ev, sc) }
    for (let i = 0; i < list.length; i += GROUP_SIZE) jobs.push({ group: list.slice(i, i + GROUP_SIZE), shared })
  }
  const out = await Promise.all(jobs.map((j) => judgeGroup(client, ev, j.group, j.shared, usage)))
  const verdicts = out.flatMap((o) => o.verdicts)
  // checkpoints the model skipped get one more try, together
  const skipped = rules.filter((r) => verdicts.find((v) => v.id === r.id)?.evidence === MISSING)
  if (skipped.length) {
    const retry = new Map((await judgeGroup(client, ev, skipped, { text: evidenceText(ev), imgs: images(ev) }, usage)).verdicts.map((v) => [v.id, v]))
    for (const v of verdicts) if (v.evidence === MISSING) Object.assign(v, retry.get(v.id))
  }
  for (const v of verdicts) if (v.evidence === MISSING) v.evidence = 'We could not check this one.'
  return { niche: majorityNiche(out.map((o) => o.niche)), verdicts, usage }
}
