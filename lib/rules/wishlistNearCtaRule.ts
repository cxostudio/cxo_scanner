/**
 * Deterministic "save for later / wishlist near primary CTA" from DOM snapshot text
 * (see --- WISHLIST / SAVE FOR LATER NEAR CTA (DOM) --- in scan keyElements).
 */

import type { ScanRule, ScanResult } from '@/lib/scanner/types'

export function isWishlistNearCtaRule(rule: ScanRule): boolean {
  const t = rule.title.toLowerCase()
  const d = rule.description.toLowerCase()
  const hay = `${t} ${d}`
  const mentionsSaveWish =
    /\b(wishlist|wish\s*list|save\s*for\s*later|favourites?\b|favorites?\b|shopping\s*list|add\s*to\s*list|save\s+to\s+list|bookmark)\b/i.test(
      hay,
    ) ||
    (hay.includes('save') && hay.includes('later') && hay.includes('cta')) ||
    (hay.includes('heart') && hay.includes('cta'))
  const mentionsNearBuy =
    /\b(cta|add\s+to\s+(cart|bag)|buy\s+now|main\s+(button|cta)|purchase|shopping\s+bag|potential\s+purchases)\b/i.test(
      hay,
    ) ||
    (hay.includes('near') && hay.includes('main'))
  return mentionsSaveWish && mentionsNearBuy
}

export function evaluateWishlistNearCtaRule(rule: ScanRule, keyElementsString: string): ScanResult | null {
  if (!keyElementsString.includes('--- WISHLIST / SAVE FOR LATER NEAR CTA (DOM) ---')) return null

  const ctaFound = /Primary CTA found:\s*YES/i.test(keyElementsString)
  const nearCta = /Save-for-later control near primary CTA:\s*YES/i.test(keyElementsString)
  const afterBlock = keyElementsString.split('--- WISHLIST / SAVE FOR LATER NEAR CTA (DOM) ---')[1]
  let evidence = 'None'
  if (afterBlock) {
    const evLine = afterBlock.split('\n').find((l) => /^Evidence:/i.test(l.trim()))
    if (evLine) evidence = evLine.replace(/^Evidence:\s*/i, '').trim() || 'None'
  }

  if (nearCta) {
    return {
      ruleId: rule.id,
      ruleTitle: rule.title,
      passed: true,
      reason:
        evidence && evidence.toLowerCase() !== 'none'
          ? `A save-for-later or list control is visible in the product area or next to the main purchase action (${evidence.slice(0, 120)}).`
          : 'A save-for-later or list control is visible in the product area or next to the main purchase action.',
    }
  }

  if (!ctaFound) {
    return {
      ruleId: rule.id,
      ruleTitle: rule.title,
      passed: false,
      reason:
        'The main purchase button was not detected, so a wishlist or save-for-later control next to it could not be verified.',
    }
  }

  return {
    ruleId: rule.id,
    ruleTitle: rule.title,
    passed: false,
    reason:
      'No wishlist, favorites, or save-for-later control was detected in the product buy area or beside the main Add to cart / Buy control.',
  }
}
