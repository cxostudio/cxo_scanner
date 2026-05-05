/**
 * Deterministic: bundle/kit/starter pages show included or bonus items near the buy CTA.
 * (see --- INCLUDED / BUNDLE ITEMS NEAR CTA (DOM) --- in scan keyElements).
 */

import type { ScanRule, ScanResult } from '@/lib/scanner/types'

export function isIncludedPackNearCtaRule(rule: ScanRule): boolean {
  const t = rule.title.toLowerCase()
  const d = rule.description.toLowerCase()
  const hay = `${t} ${d}`
  const mentionsPackBundle =
    /\b(pack|bundle|kit|starter kit|additional items?|included products?|what'?s included|items included|all included)\b/i.test(
      hay,
    ) ||
    (hay.includes('included') && (hay.includes('pack') || hay.includes('bundle') || hay.includes('kit'))) ||
    (hay.includes('visually') && hay.includes('display')) ||
    (hay.includes('included') && hay.includes('products') && hay.includes('visually')) ||
    (hay.includes('additional') && hay.includes('items') && hay.includes('pack')) ||
    (d.includes('included') && d.includes('cta'))
  const mentionsCtaOrNear =
    /\b(cta|add\s+to\s+(cart|bag)|buy\s+now|purchase|near\s+(the\s+)?cta|call to action)\b/i.test(hay) ||
    (hay.includes('near') && (hay.includes('cart') || hay.includes('button'))) ||
    (hay.includes('visually') && hay.includes('display')) ||
    (hay.includes('product') && hay.includes('includes'))
  return mentionsPackBundle && mentionsCtaOrNear
}

export function evaluateIncludedPackNearCtaRule(rule: ScanRule, keyElementsString: string): ScanResult | null {
  if (!keyElementsString.includes('--- INCLUDED / BUNDLE ITEMS NEAR CTA (DOM) ---')) return null

  const bundleLikely = /Bundle or kit style offer \(DOM\):\s*YES/i.test(keyElementsString)
  if (!bundleLikely) {
    return null
  }

  const ctaFound = /Primary CTA found:\s*YES/i.test(keyElementsString)
  const includedNear = /Included items \/ bonus lineup near buy area \(DOM\):\s*YES/i.test(keyElementsString)
  const afterBlock = keyElementsString.split('--- INCLUDED / BUNDLE ITEMS NEAR CTA (DOM) ---')[1]
  let evidence = 'None'
  if (afterBlock) {
    const evLine = afterBlock.split('\n').find((l) => /^Evidence:/i.test(l.trim()))
    if (evLine) evidence = evLine.replace(/^Evidence:\s*/i, '').trim() || 'None'
  }

  if (includedNear) {
    const visual = /visual lineup:/i.test(evidence)
    const tail =
      evidence && evidence.toLowerCase() !== 'none' ? evidence.slice(0, 160) + (evidence.length > 160 ? '…' : '') : ''

    return {
      ruleId: rule.id,
      ruleTitle: rule.title,
      passed: true,
      reason:
        visual && tail
          ? `Bonus or pack items are shown with images near the purchase area (${tail}).`
          : tail
            ? `Included or bonus items are clearly shown in the purchase area near the main action (${tail}).`
            : 'Included or bonus items are clearly shown in the purchase area near the main buy action.',
    }
  }

  if (!ctaFound) {
    return {
      ruleId: rule.id,
      ruleTitle: rule.title,
      passed: false,
      reason:
        'This page looks like a bundle or kit, but the main purchase button was not detected, so included items near the CTA could not be verified.',
    }
  }

  return {
    ruleId: rule.id,
    ruleTitle: rule.title,
    passed: false,
    reason:
      'This product is presented as a bundle or kit, but no clear list of included or bonus items was detected next to the main Add to cart / Buy area.',
  }
}
