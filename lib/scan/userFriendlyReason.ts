/**
 * Formats rule results for non-technical readers (short, plain English).
 */

type RuleLike = { id: string; title: string; description: string }

function stripJargon(text: string): string {
  return text
    .replace(/\bHTML fallback:\s*/gi, '')
    .replace(/\bDOM (?:scan|check):\s*/gi, '')
    .replace(/\bKEY ELEMENTS\b/gi, 'page summary')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Plain summary without cutting mid-word; avoids bad splits on “Rs.”, “e.g.”, etc. */
function firstPlainWords(text: string, maxLen: number): string {
  const t = stripJargon(text)
  if (!t) return ''
  const words = t.split(/\s+/).filter(Boolean)
  let out = ''
  for (const w of words) {
    const next = out ? `${out} ${w}` : w
    if (next.length > maxLen) break
    out = next
  }
  if (!out) return `${t.slice(0, Math.min(maxLen, t.length)).trim().replace(/[.,;:!?]+$/, '')}.`
  if (out.length < t.length) return `${out.replace(/[.,;:!?]+$/, '')}.`
  return out
}

function fitWordRange(text: string, minWords: number, maxWords: number, fallbackTail: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned) return fallbackTail
  const words = cleaned.split(' ').filter(Boolean)
  if (words.length > maxWords) {
    return `${words.slice(0, maxWords).join(' ').replace(/[.,;:!?]+$/, '')}.`
  }
  if (words.length < minWords) {
    const extra = fallbackTail.split(' ').filter(Boolean)
    const merged = [...words]
    for (const w of extra) {
      if (merged.length >= minWords) break
      merged.push(w)
    }
    return `${merged.join(' ').replace(/[.,;:!?]+$/, '')}.`
  }
  return cleaned
}

function removeDanglingTail(text: string): string {
  return text
    .replace(/\bThis meets the requirement for\.?$/i, '')
    .replace(/\bThis meets the requirement\.?$/i, '')
    .replace(/\bwhich meets the requirement\.?$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Pull shopper-facing delivery text from evaluator output (dates / “Order now…” lines). */
function extractDeliveryEstimatePassLine(raw: string): string | null {
  const t = stripJargon(raw)
  if (!t || /^none$/i.test(t.trim())) return null
  const low = t.toLowerCase()
  if (low.includes('no specific delivery') || low.includes('no delivery date')) return null
  if (/^a delivery date range or cutoff time is shown on the product page\.?$/i.test(t.trim())) {
    return null
  }

  const orderBetween = t.match(/\bOrder now and get it between [^.!?\n]+/i)
  if (orderBetween) {
    return `Found "${orderBetween[0].trim()}" near the "Add to cart" section, so shoppers can clearly see a delivery window before buying.`
  }
  const getBy = t.match(/\bGet it by [^.!?\n]+/i)
  if (getBy) {
    return `Found "${getBy[0].trim()}" near the "Add to cart" section, so shoppers can clearly see the expected arrival timing.`
  }
  const betweenDates = t.match(/\b(?:deliver(?:y|ed)?|arriv(?:e|es|ing)|estimated)[^.!?\n]*\bbetween\b[^.!?\n]+/i)
  if (betweenDates) {
    return `Found "${betweenDates[0].trim()}" in shipping text near "Add to cart", showing clear delivery timing on the product page.`
  }
  const deliveredOn = t.match(/\bDelivered on [A-Za-z]+,?\s*\d{1,2}\s+[A-Za-z]+(?:\s+with\s+Express\s+Shipping)?/i)
  if (deliveredOn) {
    return `Found "${deliveredOn[0].trim()}" near the purchase section, so shoppers can clearly see the delivery date before checkout.`
  }
  const deliveredWithExpress = t.match(/\bDelivered on [^.!?\n]+ with Express Shipping/i)
  if (deliveredWithExpress) {
    return `Found "${deliveredWithExpress[0].trim()}" near the purchase section, so shoppers can clearly see the delivery date before checkout.`
  }
  if (/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b.+\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i.test(t)) {
    const snippet = firstPlainWords(t, 220)
    return snippet ? `Delivery estimate: ${snippet}` : null
  }
  return null
}

/** Pull free-shipping threshold lines like “Free express shipping over €60” from evaluator output. */
function extractFreeShippingPassLine(raw: string): string | null {
  const t = stripJargon(raw)
  if (!t) return null

  const over = t.match(
    /\bFree\s+(?:express\s+)?(?:shipping|delivery)\s+over\s+[^.!?\n]+/i
  )
  if (over) {
    return `Found "${over[0].trim().replace(/\.$/, '')}" near the purchase area, so shoppers can instantly understand the free-shipping threshold.`
  }
  const away = t.match(/\bYou\s+are\s+[^.!?\n]+\s+away\s+from[^.!?\n]+/i)
  if (away) {
    return `Found "${away[0].trim().replace(/\.$/, '')}" near the cart section, clearly showing how much more is needed for free shipping.`
  }
  if (/free\s+(?:express\s+)?(?:shipping|delivery)/i.test(t)) {
    const snippet = firstPlainWords(t, 200)
    return snippet ? `Shipping offer: ${snippet}` : null
  }
  return null
}

function errorUserMessage(raw: string): string {
  const s = raw.toLowerCase()
  if (s.includes('api key') || s.includes('not configured')) {
    return 'The scan could not run the smart check because the AI service is not set up.'
  }
  if (s.includes('model not found')) {
    return 'The scan could not run because the chosen AI model is not available.'
  }
  if (s.includes('rate limit')) {
    return 'The scan hit a temporary limit. Please wait a moment and try again.'
  }
  return 'Something went wrong while checking this rule. Please try again.'
}

/** One short reason line derived from pass/fail + raw evaluator text. */
function userReasonLine(rule: RuleLike, passed: boolean, raw: string): string {
  const r = removeDanglingTail(stripJargon(raw))
  const low = r.toLowerCase()

  if (/^error:/i.test(r) || low.includes('unknown error')) {
    return errorUserMessage(r)
  }

  // Keep these high-visibility PASS reasons short and complete (never cut mid-thought).
  if (passed && rule.id === 'colors-avoid-pure-black') {
    return 'Found softer dark colors in text and background areas on the product page instead of pure black.'
  }
  if (rule.id === 'image-thumbnails') {
    return passed
      ? 'Found thumbnail previews in the product image gallery, so users can quickly switch between product photos.'
      : 'No thumbnail preview row was found in the product image gallery on desktop or mobile.'
  }
  if (rule.id === 'trust-badges-near-cta') {
    return passed
      ? 'Found payment or trust badges (such as card logos or secure checkout text) in visible purchase-related sections of the page.'
      : 'No payment logos or trust badges were found in visible purchase-related sections of the page.'
  }
  if (rule.id === 'image-before-after' && /this meets the requirement/i.test(raw)) {
    return firstPlainWords(r, 260)
  }

  // Use AI/evaluator reason directly (cleaned), with only tiny helper extraction for key shipping rules.
  if (rule.id === 'shipping-time-visibility' && passed) {
    const deliveryLine = extractDeliveryEstimatePassLine(raw)
    if (deliveryLine) return deliveryLine
    return 'Found delivery estimate text near the purchase area (for example “Get it by” or “delivered between” dates), so shoppers can see expected arrival timing.'
  }
  if (rule.id === 'free-shipping-threshold' && passed) {
    const shippingLine = extractFreeShippingPassLine(raw)
    if (shippingLine) return shippingLine
    return 'Found free-shipping threshold messaging in purchase sections (for example “Free express shipping” or “free shipping over”), so shoppers can see the shipping incentive.'
  }

  const plain = firstPlainWords(r, 220)
  if (plain) return plain
  return passed ? 'Rule passed for this page.' : 'Rule failed for this page.'
}

function failSuggestion(rule: RuleLike): string {
  const byId: Record<string, string> = {
    'colors-avoid-pure-black': 'Change pure black (#000000) to a soft dark gray for text or backgrounds.',
    'images-lazy-loading': 'Add lazy loading to images and videos that load below the first screen.',
    'navigation-breadcrumbs': 'Add a simple path like Home / Category / Product near the top.',
    'cta-sticky-add-to-cart': 'Add a buy bar or floating button that stays on screen while scrolling.',
    'social-proof-product-ratings': 'Show stars or a score close to the product title.',
    'image-thumbnails': 'Add a row of small images under or beside the main product photo.',
    'image-before-after': 'Add clear before/after or results photos if you sell results-driven products.',
    'image-mobile-navigation': 'Add arrows or swipe support for the product photo gallery on phones.',
    'trust-badges-near-cta': 'Add card logos or a short “secure checkout” line on the product page.',
    'shipping-time-visibility': 'Add an estimated delivery date or date range on the page.',
    'description-benefits-over-features': 'Add short bullets that say how the product helps the customer.',
    'ugc-customer-photos': 'Add customer photos in reviews or lifestyle shots in the gallery.',
    'variant-preselection': 'Make one size/color clearly selected when the page opens.',
    'quantity-discounts': 'Add a tier price, percent off, or was/now price if you offer deals.',
    'free-shipping-threshold': 'Add how much to spend for free shipping near the buy button.',
    'product-title-clarity': 'Use a clear title with brand, product type, and size or volume.',
    'product-tabs': 'Split long details into tabs or accordions (Description, Ingredients, Shipping, etc.).',
    'benefits-near-title': 'Add 2–3 short benefit bullets right under the product name.',
    'image-annotations': 'Add small labels or badges on images (claims, percentages, “tested”, etc.).',
    'image-square-format': 'Use square image frames for main gallery photos.',
    'image-multiple-angles': 'Add more gallery images: angles, texture, packaging, and in-use shots.',
    'image-background-consistency': 'Use a clean white or light background on the main product photo.',
    'product-comparison': 'Add a comparison block (vs another product or checkmark list).',
    'video-testimonials': 'Add short customer video reviews with a play button in the reviews area.',
    'cta-prominence': 'Make the Add to cart button larger and higher contrast than other controls.',
  }
  return (
    byId[rule.id] ||
    `Adjust the page so it clearly meets: ${rule.title}.`
  )
}

/**
 * Public API: Status + Reason always; Suggestion only when the rule fails.
 * Does not change PASS/FAIL — only formats the explanation text.
 */
export function formatUserFriendlyRuleResult(
  rule: RuleLike,
  passed: boolean,
  rawReason: string
): string {
  const status = passed ? 'PASS' : 'FAIL'
  const reasonLine = fitWordRange(
    userReasonLine(rule, passed, rawReason),
    16,
    45,
    'in visible product page sections'
  )
  const lines: string[] = [
    `Status: ${status}`,
    '',
    `Reason: ${reasonLine}`,
  ]
  if (!passed) {
    const suggestionLine = fitWordRange(
      failSuggestion(rule),
      10,
      20,
      'near the main product purchase area'
    )
    lines.push('', `Suggestion: ${suggestionLine}`)
  }
  return lines.join('\n')
}
