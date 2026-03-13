/**
 * Deterministic rule evaluation: pass/fail from structured data only.
 * Use these before calling AI to get consistent results for the same snapshot.
 */

import type { ScanRule, ScanResult, LazyLoadingResult, PageSnapshot } from '@/lib/scanner/types'

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

export function isStickyCartRule(rule: ScanRule): boolean {
  const t = rule.title.toLowerCase()
  return (
    rule.id === 'cta-sticky-add-to-cart' ||
    (t.includes('sticky') && t.includes('cart'))
  )
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
  const notFound = /Breadcrumbs:\s*Not found/i.test(keyElementsString)
  const hasLine = keyElementsString.includes('Breadcrumbs:')

  if (!hasLine) return null
  if (notFound) return null

  const match = keyElementsString.match(/Breadcrumbs:\s*(.+?)(?:\n|$)/)
  const breadcrumbText = match?.[1]?.trim() || 'present'
  return {
    ruleId: rule.id,
    ruleTitle: rule.title,
    passed: true,
    reason: `Breadcrumb navigation found: "${breadcrumbText}". Rule passes.`,
  }
}

export function evaluateColorRule(rule: ScanRule, keyElementsString: string): ScanResult {
  const hasPureBlack = /Pure black \(#000000\) detected:\s*YES/i.test(keyElementsString)
  const passed = !hasPureBlack
  const reason = passed
    ? 'Pure black (#000000) detected: NO. Page uses softer tones.'
    : 'Pure black (#000000) detected: YES. Use softer dark tones (e.g. #333333, #121212) for text and backgrounds.'
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

export function evaluateStickyCartRule(
  rule: ScanRule,
  stickyCTA: PageSnapshot['stickyCTA']
): ScanResult | null {
  if (!stickyCTA) return null

  if (stickyCTA.mobileSticky && stickyCTA.desktopSticky) {
    return {
      ruleId: rule.id,
      ruleTitle: rule.title,
      passed: true,
      reason: 'Sticky Add to Cart is detected on both mobile and desktop. The CTA remains visible while scrolling, so the rule passes.',
    }
  }

  if (stickyCTA.mobileSticky) {
    return {
      ruleId: rule.id,
      ruleTitle: rule.title,
      passed: true,
      reason: 'Sticky Add to Cart is detected on mobile. Even though desktop may not use a sticky CTA, the rule passes because the button remains visible while scrolling on mobile.',
    }
  }

  if (stickyCTA.desktopSticky) {
    return {
      ruleId: rule.id,
      ruleTitle: rule.title,
      passed: true,
      reason: 'Sticky Add to Cart is detected on desktop. The button stays fixed while scrolling, so the rule passes.',
    }
  }

  return {
    ruleId: rule.id,
    ruleTitle: rule.title,
    passed: false,
    reason: 'No sticky Add to Cart button was detected on mobile or desktop. The rule fails only when both views lack a sticky or floating CTA.',
  }
}

export function evaluateVariantRule(rule: ScanRule, keyElementsString: string): ScanResult | null {
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
    stickyCTA: PageSnapshot['stickyCTA']
  }
): ScanResult | null {
  if (isLazyLoadingRule(rule)) {
    return evaluateLazyLoadingRule(rule, context.lazyLoading)
  }
  if (isBreadcrumbRule(rule)) {
    const breadcrumbResult = evaluateBreadcrumbRule(rule, context.keyElementsString)
    if (breadcrumbResult !== null) return breadcrumbResult
  }
  if (isProductTitleRule(rule)) {
    const productTitleResult = evaluateProductTitleRule(rule, context.keyElementsString)
    if (productTitleResult !== null) return productTitleResult
  }
  if (isVariantRule(rule)) {
    const variantResult = evaluateVariantRule(rule, context.keyElementsString)
    if (variantResult !== null) return variantResult
  }
  if (isStickyCartRule(rule)) {
    const stickyResult = evaluateStickyCartRule(rule, context.stickyCTA)
    if (stickyResult !== null) return stickyResult
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
