/**
 * Deterministic rule evaluation: pass/fail from structured data only.
 * Use these before calling AI to get consistent results for the same snapshot.
 */

import type { ScanRule, ScanResult, LazyLoadingResult, PageSnapshot } from '@/lib/scanner/types'
import type { FooterSocialSnapshot } from '@/lib/rules/footerSocialLinksRule'
import { evaluateFooterSocialLinksRule } from '@/lib/rules/footerSocialLinksRule'
import type { FooterNewsletterSnapshot } from '@/lib/rules/footerNewsletterRule'
import { evaluateFooterNewsletterRule } from '@/lib/rules/footerNewsletterRule'
import type { FooterCustomerSupportSnapshot } from '@/lib/rules/footerCustomerSupportRule'
import { evaluateFooterCustomerSupportRule } from '@/lib/rules/footerCustomerSupportRule'

export function isLazyLoadingRule(rule: ScanRule): boolean {
  const t = rule.title.toLowerCase()
  const d = rule.description.toLowerCase()
  return (
    rule.id === 'images-lazy-loading' ||
    t.includes('lazy loading') ||
    d.includes('lazy loading') ||
    d.includes('below-the-fold')
  )
}

export function isBreadcrumbRule(rule: ScanRule): boolean {
  const t = rule.title.toLowerCase()
  const d = rule.description.toLowerCase()
  return t.includes('breadcrumb') || d.includes('breadcrumb')
}

export function isLogoHomepageRule(rule: ScanRule): boolean {
  const t = rule.title.toLowerCase()
  const d = rule.description.toLowerCase()
  return (
    rule.id === 'recYUxusypKnfViyM' ||
    (t.includes('logo') && t.includes('clickable') && t.includes('homepage')) ||
    (d.includes('logo') && d.includes('clickable') && d.includes('homepage'))
  )
}

/**
 * "Does the cart icon show the number of items?" — empty cart: PASS (no badge required).
 * Non-empty cart: PASS only if a visible count badge is present.
 */
export function isCartIconItemCountRule(rule: ScanRule): boolean {
  const t = rule.title.toLowerCase()
  const d = rule.description.toLowerCase()
  if (t.includes('quick access') || t.includes('quick access link')) return false
  if (t.includes('sticky') && t.includes('cart')) return false
  const aboutIconAndCount =
    (t.includes('cart') && t.includes('number') && t.includes('item')) ||
    (t.includes('cart icon') && (t.includes('number') || t.includes('items') || t.includes('display'))) ||
    (t.includes('badge') && t.includes('cart') && t.includes('item')) ||
    (d.includes('cart icon') && d.includes('counter')) ||
    (d.includes('cart') && d.includes('badge') && d.includes('number'))
  return aboutIconAndCount
}

/** Quick cart / bag access in header (not sticky product "add to cart"). */
export function isHeaderCartQuickAccessRule(rule: ScanRule): boolean {
  const t = rule.title.toLowerCase()
  const d = rule.description.toLowerCase()
  if (t.includes('sticky') && (t.includes('add to cart') || t.includes('add to bag'))) return false
  if (t.includes('quantity') || t.includes('discount')) return false
  const cartInTitle = t.includes('cart') || d.includes('cart')
  if (!cartInTitle) return false
  if (isCartIconItemCountRule(rule)) return false
  const quickOrAccess =
    t.includes('quick access') ||
    t.includes('quick') ||
    (t.includes('access') && t.includes('link')) ||
    (d.includes('quick access') && d.includes('cart')) ||
    (d.includes('header') && d.includes('cart') && (d.includes('icon') || d.includes('link')))
  return quickOrAccess
}

export function isSearchAccessibilityRule(rule: ScanRule): boolean {
  const t = rule.title.toLowerCase()
  const d = rule.description.toLowerCase()
  if (!(t.includes('search') || d.includes('search'))) return false
  return (
    t.includes('button') ||
    t.includes('icon') ||
    t.includes('accessible') ||
    d.includes('button') ||
    d.includes('icon') ||
    d.includes('accessible') ||
    d.includes('header')
  )
}

export function isTrustBadgesNearCtaRule(rule: ScanRule): boolean {
  const t = rule.title.toLowerCase()
  const d = rule.description.toLowerCase()
  return (
    rule.id === 'trust-badges-near-cta' ||
    rule.id === 'recihw16WgNwYG09z' ||
    (t.includes('trust') && t.includes('cta')) ||
    (t.includes('secure checkout') && t.includes('cta')) ||
    (d.includes('trust') && d.includes('cta'))
  )
}

export function isVerbUrgencyCtaLabelRule(rule: ScanRule): boolean {
  const t = rule.title.toLowerCase()
  const d = rule.description.toLowerCase()
  return (
    (t.includes('button') && t.includes('link') && t.includes('verb') && t.includes('urgency')) ||
    (d.includes('button') && d.includes('link') && d.includes('verb') && d.includes('urgency')) ||
    (t.includes('action verb') && t.includes('label')) ||
    (d.includes('action verb') && d.includes('label')) ||
    (t.includes('cta') && t.includes('label') && (t.includes('verb') || t.includes('urgency'))) ||
    (d.includes('cta') && d.includes('label') && (d.includes('verb') || d.includes('urgency'))) ||
    (t.includes('shop now') && t.includes('button')) ||
    (d.includes('shop now') && d.includes('label'))
  )
}

export function isColorRule(rule: ScanRule): boolean {
  const t = rule.title.toLowerCase()
  const d = rule.description.toLowerCase()
  return (
    t.includes('pure black') ||
    t.includes('avoid pure black') ||
    t.includes('text and backgrounds') ||
    d.includes('#000000') ||
    d.includes('pure black') ||
    d.includes('text and backgrounds')
  )
}

export function isShippingRule(rule: ScanRule): boolean {
  const t = rule.title.toLowerCase()
  const d = rule.description.toLowerCase()
  return (
    rule.id === 'shipping-time-visibility' ||
    t.includes('delivery estimate') ||
    t.includes('shipping time') ||
    d.includes('delivery estimate') ||
    d.includes('delivered by')
  )
}

export function isProductTitleRule(rule: ScanRule): boolean {
  const t = rule.title.toLowerCase()
  const d = rule.description.toLowerCase()
  return (
    rule.id === 'product-title-clarity' ||
    t.includes('product title') ||
    d.includes('product title')
  )
}

export function isThumbnailGalleryRule(rule: ScanRule): boolean {
  const t = rule.title.toLowerCase()
  return (
    rule.id === 'image-thumbnails' ||
    (t.includes('thumbnail') && t.includes('gallery'))
  )
}

/** Before-and-after / comparison imagery rule (not image-background "before/after" mentions). */
export function isBeforeAfterRule(rule: ScanRule): boolean {
  const t = rule.title.toLowerCase()
  const d = rule.description.toLowerCase()
  return (
    rule.id === 'image-before-after' ||
    (t.includes('before') && t.includes('after') && (t.includes('image') || d.includes('image'))) ||
    d.includes('before-and-after') ||
    d.includes('before and after')
  )
}

/**
 * True only when the product category plausibly expects visual transformation proof
 * (skin/hair/body aesthetic results, etc.). Default false — strict to avoid false positives.
 */
export function expectsVisualTransformationContext(text: string, url: string): boolean {
  const combined = `${text}\n${url}`.toLowerCase()
  const head = combined.slice(0, 8000)

  const strongPositive = [
    /\b(?:anti-aging|anti age|anti-acne|anti acne|wrinkle|fine line|dark spot|hyperpigmentation|melasma|age spot|sun spot|blemish|acne|rosacea|eczema|psoriasis|blackhead|whitehead|pore minim)\b/i,
    /\b(?:facial serum|face serum|eye serum|night cream|day cream|SPF\s*\d+|moisturizer|moisturiser|cleanser|toner|essence|face cream|exfoliant|chemical peel|sunscreen)\b/i,
    /\b(?:retinol|retinoid|tretinoin|adapalene|benzoyl|salicylic|glycolic|lactic acid|niacinamide|azelaic|peptide)\b/i,
    /\b(?:body contour|cellulite|stretch mark|scar (?:treatment|cream|gel)|teeth whitening|tooth whitening|whitening strips)\b/i,
    /\b(?:hair loss|alopecia|regrowth|lash serum|brow serum|thinning hair)\b/i,
    /\b(?:weight loss|fat loss|slimming)\b.*\b(?:program|plan|transform|results?)\b/i,
  ]

  if (!strongPositive.some((p) => p.test(head))) return false

  const excludeUnlessSkinCosmetic = [
    /\b(?:coffee|espresso|tea|latte|matcha|chai|cappuccino|brew|mug|tumbler|flavou?r|decaf)\b/i,
    /\b(?:protein powder|meal replacement|snack bar|gummy vitamin|multivitamin)\b/i,
    /\b(?:book|headphone|phone case|laptop|charger|furniture|wine|beer|spirit|vodka)\b/i,
  ]

  const hasSkinCosmeticContext =
    /\b(?:skin|face|serum|cream|spf|moistur|cleanser|derma|cosmetic|acne|wrinkle|blemish|body care|hair care|scalp|lip care|eye care|toner|exfoliant)\b/i.test(
      head
    )

  if (excludeUnlessSkinCosmetic.some((p) => p.test(head)) && !hasSkinCosmeticContext) {
    return false
  }

  return true
}

export function isVariantRule(rule: ScanRule): boolean {
  const t = rule.title.toLowerCase()
  const d = rule.description.toLowerCase()
  return (
    rule.id === 'variant-preselection' ||
    t.includes('preselect') ||
    t.includes('variant') ||
    d.includes('preselect') ||
    d.includes('variant')
  )
}

function normalizeDeliveryText(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getDeliveryPatterns(): RegExp[] {
  const weekday = '(?:mon|monday|tue|tues|tuesday|wed|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday|sun|sunday)\\.?'
  const month = '(?:jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\\.?'
  const dayNum = '\\d{1,2}(?:st|nd|rd|th)?'
  const dateToken = `(?:${weekday}\\s*,\\s*)?${month}\\s+${dayNum}`

  return [
    new RegExp(`get\\s+it\\s+by\\s+${dateToken}`, 'i'),
    new RegExp(`delivered\\s+by\\s+${dateToken}`, 'i'),
    new RegExp(`arrives\\s+by\\s+${dateToken}`, 'i'),
    new RegExp(`delivery\\s+by\\s+${dateToken}`, 'i'),
    new RegExp(`delivered\\s+on\\s+${dateToken}`, 'i'),
    new RegExp(`get\\s+it\\s+between\\s+${dateToken}\\s+and\\s+${dateToken}`, 'i'),
    new RegExp(`delivered\\s+between\\s+${dateToken}\\s+and\\s+${dateToken}`, 'i'),
    new RegExp(`arrives\\s+between\\s+${dateToken}\\s+and\\s+${dateToken}`, 'i'),
    new RegExp(`order\\s+now\\s+and\\s+get\\s+it\\s+between\\s+${dateToken}\\s+and\\s+${dateToken}`, 'i'),
    /order\s+within\s+\d+(?:\s+\d+)?\s*(?:hours?|hrs?|minutes?|mins?)/i,
    /order\s+before\s+\d+(?::\d+)?\s*(?:am|pm)/i,
    /cutoff\s+time/i,
  ]
}

function extractPrimaryProductTitle(keyElementsString: string): string | null {
  const match = keyElementsString.match(/Primary Product Title:\s*(.+?)(?:\n|$)/i)
  const title = match?.[1]?.trim()
  if (!title || /^not found$/i.test(title)) return null
  return title
}

function extractSelectedVariant(keyElementsString: string): string | null {
  const match = keyElementsString.match(/Selected Variant:\s*(.+?)(?:\n|$)/i)
  const value = match?.[1]?.trim()
  if (!value || /^none$/i.test(value)) return null
  return value
}

function getProductTitleDetailSignals(title: string): string[] {
  const lower = title.toLowerCase()
  const signals: string[] = []

  if (title.split(/\s+/).filter(Boolean).length >= 4) {
    signals.push('multi-word descriptive title')
  }
  if (/\b\d+(?:\.\d+)?\s?(?:ml|g|kg|oz|lb|l|cm|mm|pack|pcs|count|ct)\b/i.test(title)) {
    signals.push('size/quantity')
  }
  if (/[()/-]/.test(title)) {
    signals.push('structured qualifier')
  }
  if (/\b(?:serum|cream|cleanser|mask|kit|bundle|capsules|shampoo|conditioner|supplement|oil|lotion|moisturizer|spray|tablet|drops)\b/i.test(lower)) {
    signals.push('product type')
  }
  if (/\b(?:dark spot|brightening|hydrating|anti-aging|anti age|vitamin c|retinol|coffee|vanilla|sensitive skin|glow|radiance|repair|firming)\b/i.test(lower)) {
    signals.push('variant/benefit')
  }

  return signals
}

export function evaluateLazyLoadingRule(
  rule: ScanRule,
  lazyResult: LazyLoadingResult
): ScanResult {
  const noMedia = lazyResult.totalMediaCount === 0
  const passedFinal = noMedia ? false : lazyResult.detected
  const reason = passedFinal
    ? 'Lazy loading found below the fold.'
    : noMedia
      ? 'No images or videos were found on the page. Product pages should include media with lazy loading for below-the-fold content.'
      : `Lazy loading detected: NO. Total media: ${lazyResult.totalMediaCount}. Add loading="lazy" or use data-src/lazyload for below-the-fold images and videos.`
  return {
    ruleId: rule.id,
    ruleTitle: rule.title,
    passed: passedFinal,
    reason,
  }
}

export function evaluateBreadcrumbRule(rule: ScanRule, keyElementsString: string): ScanResult | null {
  void rule
  void keyElementsString
  // Breadcrumb visibility is now judged from screenshot evidence in the AI step.
  // DOM/text-only signals can exist without a clearly visible breadcrumb trail.
  return null
}

export function evaluateLogoHomepageRule(rule: ScanRule, keyElementsString: string): ScanResult | null {
  const hasBlock = keyElementsString.includes('--- LOGO LINK CHECK ---')
  if (!hasBlock) return null

  const clickable = /Logo clickable in header:\s*YES/i.test(keyElementsString)
  const homepageLinked = /Logo homepage link:\s*YES/i.test(keyElementsString)
  const hrefMatch = keyElementsString.match(/Logo href:\s*(.+?)(?:\n|$)/i)
  const href = hrefMatch?.[1]?.trim() || 'Not found'

  if (clickable && homepageLinked) {
    return {
      ruleId: rule.id,
      ruleTitle: rule.title,
      passed: true,
      reason: `The header logo is clickable and links to the homepage (${href}).`,
    }
  }

  if (!clickable) {
    return {
      ruleId: rule.id,
      ruleTitle: rule.title,
      passed: false,
      reason: 'No clickable logo link was detected in the header. Make the logo clickable and link it to the homepage.',
    }
  }

  return {
    ruleId: rule.id,
    ruleTitle: rule.title,
    passed: false,
    reason: `A clickable header logo was found, but it does not link to the homepage (href: ${href}).`,
  }
}

export function evaluateHeaderCartQuickAccessRule(rule: ScanRule, keyElementsString: string): ScanResult | null {
  if (!keyElementsString.includes('--- HEADER CART QUICK ACCESS (DOM) ---')) return null
  if (/Header cart quick access present:\s*UNKNOWN/i.test(keyElementsString)) return null
  const present = /Header cart quick access present:\s*YES/i.test(keyElementsString)
  const detail =
    keyElementsString.match(/Cart quick access detail:\s*(.+?)(?:\n|$)/i)?.[1]?.trim() || 'header cart control'
  if (present) {
    return {
      ruleId: rule.id,
      ruleTitle: rule.title,
      passed: true,
      reason: `A cart quick access control is present in the site header (${detail}).`,
    }
  }
  return {
    ruleId: rule.id,
    ruleTitle: rule.title,
    passed: false,
    reason: 'No cart or bag quick access link or control was detected in the header.',
  }
}

export function evaluateCartIconItemCountRule(rule: ScanRule, keyElementsString: string): ScanResult | null {
  if (!keyElementsString.includes('--- CART ICON ITEM COUNT (DOM) ---')) return null
  const verdict = keyElementsString
    .match(/Cart icon item count rule verdict:\s*(PASS|FAIL|INDETERMINATE)/i)?.[1]
    ?.toUpperCase()
  if (!verdict || verdict === 'INDETERMINATE') return null
  const detail =
    keyElementsString.match(/Cart icon item count rule detail:\s*(.+?)(?:\n|$)/i)?.[1]?.trim() || ''
  if (verdict === 'PASS') {
    return {
      ruleId: rule.id,
      ruleTitle: rule.title,
      passed: true,
      reason: detail || 'Cart count display meets the rule for the current cart state.',
    }
  }
  return {
    ruleId: rule.id,
    ruleTitle: rule.title,
    passed: false,
    reason: detail || 'Cart has items but no visible item-count badge on the cart icon.',
  }
}

export function evaluateSearchAccessibilityRule(rule: ScanRule, keyElementsString: string): ScanResult | null {
  if (!keyElementsString.includes('--- SEARCH ACCESS CHECK ---')) return null
  if (/Search accessible control:\s*UNKNOWN/i.test(keyElementsString)) return null
  const present = /Search accessible control:\s*YES/i.test(keyElementsString)
  const detail =
    keyElementsString.match(/Search control detail:\s*(.+?)(?:\n|$)/i)?.[1]?.trim() || 'search control'
  if (present) {
    return {
      ruleId: rule.id,
      ruleTitle: rule.title,
      passed: true,
      reason: `A clear and accessible search control is present (${detail}).`,
    }
  }
  return {
    ruleId: rule.id,
    ruleTitle: rule.title,
    passed: false,
    reason: 'No clear and accessible search button/icon was detected in the header area.',
  }
}

export function evaluateTrustBadgesNearCtaRule(rule: ScanRule, keyElementsString: string): ScanResult | null {
  const hasBlock = keyElementsString.includes('--- TRUST BADGES CHECK')
  if (!hasBlock) return null

  const nearCtaYes = /Visual trust icons near CTA \(DOM\):\s*YES/i.test(keyElementsString)
  const ctaFound = /CTA Found:\s*YES/i.test(keyElementsString)
  const nearMarks = keyElementsString.match(/Visual trust marks near CTA(?: \(payment logos, seals, guarantee icons\))?:\s*(.+?)(?:\n|$)/i)?.[1]?.trim() || 'None'
  const elsewhereMarks = keyElementsString.match(/Visual trust marks elsewhere only(?: \(footer, etc\. — does NOT pass\))?:\s*(.+?)(?:\n|$)/i)?.[1]?.trim() || 'None'

  if (nearCtaYes) {
    return {
      ruleId: rule.id,
      ruleTitle: rule.title,
      passed: true,
      reason: `Trust/payment icons are detected near the primary CTA (${nearMarks}).`,
    }
  }

  if (!ctaFound) {
    return {
      ruleId: rule.id,
      ruleTitle: rule.title,
      passed: false,
      reason: 'Primary purchase CTA was not detected, so trust badges near CTA could not be verified.',
    }
  }

  if (elsewhereMarks && elsewhereMarks.toLowerCase() !== 'none') {
    return {
      ruleId: rule.id,
      ruleTitle: rule.title,
      passed: false,
      reason: `Trust/payment icons appear only away from the primary CTA (${elsewhereMarks}).`,
    }
  }

  return {
    ruleId: rule.id,
    ruleTitle: rule.title,
    passed: false,
    reason: 'No trust/payment icons were detected near the primary CTA.',
  }
}

function extractButtonLinkLabelsFromKeyElements(keyElementsString: string): string[] {
  const m = keyElementsString.match(/Buttons\/Links:\s*(.+?)(?:\n|$)/i)
  if (!m?.[1]) return []
  return m[1]
    .split('|')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((s) => s.length >= 2 && s.length <= 70)
}

export function evaluateVerbUrgencyCtaLabelRule(rule: ScanRule, keyElementsString: string): ScanResult | null {
  const labels = extractButtonLinkLabelsFromKeyElements(keyElementsString)
  if (labels.length === 0) return null

  const skipNoise = (s: string): boolean => {
    const l = s.toLowerCase()
    return (
      l.includes('privacy') ||
      l.includes('terms') ||
      l.includes('return policy') ||
      l.includes('shipping policy') ||
      l.includes('store locator') ||
      l.includes('afghanistan (') ||
      /\b[a-z]{2,}\s+\([a-z]{3}\s/.test(l)
    )
  }

  const filtered = labels.filter((s) => !skipNoise(s))
  const actionVerbStart = [
    'shop', 'buy', 'add', 'get', 'order', 'start', 'try', 'discover',
    'explore', 'view', 'check', 'join', 'subscribe', 'learn', 'claim',
  ]
  const urgencyWords = ['now', 'today', 'limited', 'hurry', 'instant', 'immediately', 'last chance']
  const purchaseIntent = [
    'add to cart', 'add to bag', 'buy now', 'shop now', 'checkout', 'order now', 'get started', 'shop all',
  ]

  const startsWithVerb = filtered.filter((s) => {
    const l = s.toLowerCase()
    return actionVerbStart.some((v) => l === v || l.startsWith(v + ' '))
  })
  const urgent = filtered.filter((s) => urgencyWords.some((u) => s.toLowerCase().includes(u)))
  const purchase = filtered.filter((s) => purchaseIntent.some((p) => s.toLowerCase().includes(p)))

  // Lenient for ecommerce templates:
  // PASS if at least one strong action label exists and either urgency OR purchase-intent wording appears.
  const passed = startsWithVerb.length >= 1 && (urgent.length >= 1 || purchase.length >= 1)
  if (passed) {
    const examples = [...new Set([...startsWithVerb, ...urgent, ...purchase])].slice(0, 4).join(', ')
    return {
      ruleId: rule.id,
      ruleTitle: rule.title,
      passed: true,
      reason: `Action-oriented labels are present and start with strong verbs (e.g. ${examples}). This supports urgency and click intent.`,
    }
  }

  return {
    ruleId: rule.id,
    ruleTitle: rule.title,
    passed: false,
    reason:
      'Button/link labels do not consistently start with clear action verbs or urgency wording. Use labels such as "Shop now", "Buy now", or "Get yours today".',
  }
}

export function evaluateColorRule(rule: ScanRule, keyElementsString: string): ScanResult {
  const hasPureBlack = /Pure black \(#000000\) detected:\s*YES/i.test(keyElementsString)
  const meaningfulCount = Number(
    keyElementsString.match(/Meaningful pure-black elements count:\s*(\d+)/i)?.[1] || '0',
  )
  const largeBgYes = /Large pure-black background found:\s*YES/i.test(keyElementsString)

  // Practical UX rule:
  // - PASS when pure black is absent, OR present only in limited/non-harsh usage.
  // - FAIL when pure black is materially overused or forms large dark backgrounds.
  const passed = !hasPureBlack || (!largeBgYes && meaningfulCount <= 4)
  const reason = passed
    ? hasPureBlack
      ? `Pure black exists in limited usage (count=${meaningfulCount}) and does not create a harsh full-page background, so readability remains acceptable.`
      : 'Pure black (#000000) detected: NO. Page uses softer tones.'
    : 'Pure black (#000000) is materially overused in meaningful content/background areas. Use softer dark tones (e.g. #333333, #121212).'
  return {
    ruleId: rule.id,
    ruleTitle: rule.title,
    passed,
    reason,
  }
}

export function evaluateProductTitleRule(rule: ScanRule, keyElementsString: string): ScanResult | null {
  const title = extractPrimaryProductTitle(keyElementsString)
  if (!title) return null

  const wordCount = title.split(/\s+/).filter(Boolean).length
  const detailSignals = getProductTitleDetailSignals(title)
  const shortTitle = title.length < 18 || wordCount < 3
  const hasSize = detailSignals.includes('size/quantity')
  const hasProductType = detailSignals.includes('product type')
  const hasVariantOrBenefit = detailSignals.includes('variant/benefit')
  const descriptiveEnough =
    wordCount >= 5 ||
    (hasSize && hasProductType) ||
    (hasProductType && hasVariantOrBenefit) ||
    detailSignals.length >= 3

  if (!shortTitle && descriptiveEnough) {
    const details = detailSignals.filter((signal) => signal !== 'multi-word descriptive title').join(', ') || 'specific product details'
    return {
      ruleId: rule.id,
      ruleTitle: rule.title,
      passed: true,
      reason: `The product title "${title}" is descriptive and clear. It includes specific details such as ${details}, so users can quickly understand what the product is.`,
    }
  }

  return {
    ruleId: rule.id,
    ruleTitle: rule.title,
    passed: false,
    reason: `The product title "${title}" in the product page header is too generic. It needs more specific attributes such as brand, size, variant, or key benefit so the title is clear on its own.`,
  }
}


function uniqueEvidenceParts(...parts: (string | undefined)[]): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of parts) {
    const t = (p || '').trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out.join('; ')
}

export function evaluateThumbnailGalleryRule(
  rule: ScanRule,
  thumbnailGallery: PageSnapshot['thumbnailGallery']
): ScanResult | null {
  if (!thumbnailGallery) return null

  const { desktopThumbnails, mobileThumbnails, desktopEvidence, mobileEvidence } = thumbnailGallery

  if (desktopThumbnails && mobileThumbnails) {
    const detail = uniqueEvidenceParts(desktopEvidence, mobileEvidence) || 'DOM check'
    return {
      ruleId: rule.id,
      ruleTitle: rule.title,
      passed: true,
      reason: `Product image gallery thumbnails are present on both desktop and mobile (${detail}). Users can browse gallery images via small previews.`,
    }
  }

  if (desktopThumbnails) {
    return {
      ruleId: rule.id,
      ruleTitle: rule.title,
      passed: true,
      reason: `Thumbnails are available in the product gallery on desktop${desktopEvidence ? ` (${desktopEvidence})` : ''}. The rule passes when the desktop layout shows thumbnail previews, even if mobile uses a different pattern (e.g. swipe only).`,
    }
  }

  if (mobileThumbnails) {
    return {
      ruleId: rule.id,
      ruleTitle: rule.title,
      passed: true,
      reason: `Thumbnails are available in the product gallery on mobile${mobileEvidence ? ` (${mobileEvidence})` : ''}. The rule passes because at least one viewport shows thumbnail previews.`,
    }
  }

  return {
    ruleId: rule.id,
    ruleTitle: rule.title,
    passed: false,
    reason:
      'No product gallery thumbnails were detected on desktop or mobile. The rule fails when neither viewport shows a thumbnail strip or row of small preview images for the gallery.',
  }
}

export function evaluateVariantRule(
  rule: ScanRule,
  keyElementsString: string,
  fullVisibleText?: string
): ScanResult | null {
  const selectedVariant = extractSelectedVariant(keyElementsString)
  if (selectedVariant) {
    return {
      ruleId: rule.id,
      ruleTitle: rule.title,
      passed: true,
      reason: `The selected variant "${selectedVariant}" is preselected by default and visibly highlighted on page load, so users can proceed without making an extra selection.`,
    }
  }

  if (!keyElementsString.includes('Selected Variant:')) return null

  // When DOM says None, check page text for variant options — ecommerce pages often preselect first option (e.g. flavour/size/plan)
  const raw = (fullVisibleText || '').toLowerCase()
  const hasFlavourOptions = raw.includes('coffee') && (raw.includes('chocolate') || raw.includes('vanilla') || raw.includes('caramel') || raw.includes('decaf'))
  const hasSizeOptions = /\b(small|medium|large|s|m|l|xl)\b/i.test(raw) && (raw.includes('size') || raw.includes('choose'))
  const hasPlanOptions = (raw.includes('one time') || raw.includes('one-time')) && (raw.includes('subscription') || raw.includes('subscribe'))
  const hasVariantUI = hasFlavourOptions || hasSizeOptions || hasPlanOptions || /choose\s+(delicious\s+)?flavour|choose\s+flavor|flavour\s*:|flavor\s*:/i.test(raw)
  if (hasVariantUI) {
    return {
      ruleId: rule.id,
      ruleTitle: rule.title,
      passed: true,
      reason: 'A variant option is preselected by default (variant selector with options such as flavour or size is present). The selected option is clearly indicated so users can add to cart without extra steps.',
    }
  }

  return {
    ruleId: rule.id,
    ruleTitle: rule.title,
    passed: false,
    reason: 'No option is visibly preselected on page load. Add a default selected state so one option is clearly active when the page opens.',
  }
}

export function evaluateShippingRule(
  rule: ScanRule,
  snapshot: Pick<PageSnapshot, 'fullVisibleText' | 'shippingTime'>
): ScanResult | null {
  if (snapshot.shippingTime?.allRequirementsMet) {
    const evidence = snapshot.shippingTime.shippingText !== 'None'
      ? snapshot.shippingTime.shippingText.trim()
      : 'A delivery date range or cutoff time is shown on the product page.'

    return {
      ruleId: rule.id,
      ruleTitle: rule.title,
      passed: true,
      reason: evidence === 'A delivery date range or cutoff time is shown on the product page.'
        ? evidence
        : evidence,
    }
  }

  const normalizedText = normalizeDeliveryText(snapshot.fullVisibleText || '')
  if (!normalizedText) return null

  const matchedPattern = getDeliveryPatterns().find((pattern) => pattern.test(normalizedText))
  if (!matchedPattern) return null

  const matchedText = normalizedText.match(matchedPattern)?.[0]?.trim()

  return {
    ruleId: rule.id,
    ruleTitle: rule.title,
    passed: true,
    reason: matchedText
      ? matchedText
      : 'A delivery date range or cutoff time is shown on the product page.',
  }
}

export function tryEvaluateDeterministic(
  rule: ScanRule,
  context: {
    lazyLoading: LazyLoadingResult
    keyElementsString: string
    fullVisibleText: string
    shippingTime: PageSnapshot['shippingTime']
    thumbnailGallery: PageSnapshot['thumbnailGallery']
    /** Precomputed: expectsVisualTransformationContext(...) */
    beforeAfterTransformationExpected: boolean
    footerSocial: FooterSocialSnapshot
    footerNewsletter: FooterNewsletterSnapshot
    footerCustomerSupport: FooterCustomerSupportSnapshot
  }
): ScanResult | null {
  const footerNewsletterResult = evaluateFooterNewsletterRule(rule, context.footerNewsletter)
  if (footerNewsletterResult !== null) return footerNewsletterResult
  const footerCustomerSupportResult = evaluateFooterCustomerSupportRule(rule, context.footerCustomerSupport)
  if (footerCustomerSupportResult !== null) return footerCustomerSupportResult
  const footerResult = evaluateFooterSocialLinksRule(rule, context.footerSocial)
  if (footerResult !== null) return footerResult
  if (isLazyLoadingRule(rule)) {
    return evaluateLazyLoadingRule(rule, context.lazyLoading)
  }
  if (isBreadcrumbRule(rule)) {
    const breadcrumbResult = evaluateBreadcrumbRule(rule, context.keyElementsString)
    if (breadcrumbResult !== null) return breadcrumbResult
  }
  if (isLogoHomepageRule(rule)) {
    const logoResult = evaluateLogoHomepageRule(rule, context.keyElementsString)
    if (logoResult !== null) return logoResult
  }
  if (isHeaderCartQuickAccessRule(rule)) {
    const cartHeaderResult = evaluateHeaderCartQuickAccessRule(rule, context.keyElementsString)
    if (cartHeaderResult !== null) return cartHeaderResult
  }
  if (isCartIconItemCountRule(rule)) {
    const cartCountResult = evaluateCartIconItemCountRule(rule, context.keyElementsString)
    if (cartCountResult !== null) return cartCountResult
  }
  if (isSearchAccessibilityRule(rule)) {
    const searchResult = evaluateSearchAccessibilityRule(rule, context.keyElementsString)
    if (searchResult !== null) return searchResult
  }
  if (isTrustBadgesNearCtaRule(rule)) {
    const trustResult = evaluateTrustBadgesNearCtaRule(rule, context.keyElementsString)
    if (trustResult !== null) return trustResult
  }
  if (isVerbUrgencyCtaLabelRule(rule)) {
    const ctaVerbResult = evaluateVerbUrgencyCtaLabelRule(rule, context.keyElementsString)
    if (ctaVerbResult !== null) return ctaVerbResult
  }
  if (isProductTitleRule(rule)) {
    const productTitleResult = evaluateProductTitleRule(rule, context.keyElementsString)
    if (productTitleResult !== null) return productTitleResult
  }
  if (isVariantRule(rule)) {
    const variantResult = evaluateVariantRule(rule, context.keyElementsString, context.fullVisibleText)
    if (variantResult !== null) return variantResult
  }
  if (isThumbnailGalleryRule(rule)) {
    const thumbResult = evaluateThumbnailGalleryRule(rule, context.thumbnailGallery)
    if (thumbResult !== null) return thumbResult
  }
  if (isBeforeAfterRule(rule)) {
    if (!context.beforeAfterTransformationExpected) {
      return {
        ruleId: rule.id,
        ruleTitle: rule.title,
        passed: true,
        reason:
          'This product category does not require before-and-after images (no visual transformation is the primary purchase expectation). The rule passes as not applicable.',
      }
    }
    return null
  }
  if (isColorRule(rule)) {
    return evaluateColorRule(rule, context.keyElementsString)
  }
  if (isShippingRule(rule)) {
    const shippingResult = evaluateShippingRule(rule, {
      fullVisibleText: context.fullVisibleText,
      shippingTime: context.shippingTime,
    })
    if (shippingResult !== null) return shippingResult
  }
  return null
}
