/**
 * Deterministic rule evaluation: pass/fail from structured data only.
 * Use these before calling AI to get consistent results for the same snapshot.
 */

import type { ScanRule, ScanResult, LazyLoadingResult } from '@/lib/scanner/types'

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
    t.includes('color') ||
    t.includes('black') ||
    d.includes('color') ||
    d.includes('#000000') ||
    d.includes('pure black')
  )
}

/**
 * Evaluate lazy loading rule from DOM result only.
 * PASS if any lazy loading detected; FAIL if no media or no lazy loading.
 */
export function evaluateLazyLoadingRule(
  rule: ScanRule,
  lazyResult: LazyLoadingResult
): ScanResult {
  const passed = lazyResult.detected || (lazyResult.totalMediaCount === 0 && lazyResult.lazyLoadedCount === 0)
  // If no media at all, rule fails (page should have images/videos for product pages)
  const noMedia = lazyResult.totalMediaCount === 0
  const passedFinal = noMedia ? false : lazyResult.detected
  const reason = passedFinal
    ? `Lazy loading detected: YES. Lazy loaded media count: ${lazyResult.lazyLoadedCount}, total media: ${lazyResult.totalMediaCount}. ${lazyResult.examples.length ? `Examples: ${lazyResult.examples.slice(0, 3).join(', ')}.` : ''}`
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

/**
 * Evaluate breadcrumb rule from key elements string.
 * Looks for "Breadcrumbs: ..." and "Not found".
 */
export function evaluateBreadcrumbRule(rule: ScanRule, keyElementsString: string): ScanResult {
  const notFound = /Breadcrumbs:\s*Not found/i.test(keyElementsString)
  const passed = !notFound && keyElementsString.includes('Breadcrumbs:') && !keyElementsString.includes('Breadcrumbs: Not found')
  const reason = passed
    ? 'Breadcrumb navigation is present on the page.'
    : 'Breadcrumbs: Not found. Add breadcrumb navigation near the top of the product page.'
  return {
    ruleId: rule.id,
    ruleTitle: rule.title,
    passed,
    reason,
  }
}

/**
 * Evaluate pure-black color rule from key elements string.
 */
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

/**
 * If this rule can be evaluated deterministically, return the result; else null.
 */
export function tryEvaluateDeterministic(
  rule: ScanRule,
  context: {
    lazyLoading: LazyLoadingResult
    keyElementsString: string
  }
): ScanResult | null {
  if (isLazyLoadingRule(rule)) {
    return evaluateLazyLoadingRule(rule, context.lazyLoading)
  }
  if (isBreadcrumbRule(rule)) {
    return evaluateBreadcrumbRule(rule, context.keyElementsString)
  }
  if (isColorRule(rule)) {
    return evaluateColorRule(rule, context.keyElementsString)
  }
  return null
}
