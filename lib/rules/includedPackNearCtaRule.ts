/**
 * Deterministic: bundle/kit/starter pages show included or bonus items near the buy CTA.
 * (see --- INCLUDED / BUNDLE ITEMS NEAR CTA (DOM) --- in scan keyElements).
 */

import type { ScanRule, ScanResult } from '@/lib/scanner/types'

/**
 * Which checkpoints this deterministic rule answers. Decided on the TITLE only: matching the
 * description (as before) hijacked unrelated checks whose required actions happen to say
 * "display … visually" or "near the CTA" (free shipping, key benefits, quantity discounts,
 * cross-sell…), which then all got this rule's verdict and reason.
 */
export function isIncludedPackNearCtaRule(rule: ScanRule): boolean {
  const t = rule.title.toLowerCase()
  const packIncluded =
    (/\b(pack|bundle|kit)\b/.test(t) && /\b(includ|item|product)/.test(t)) || /what'?s included|items included/.test(t)
  const addonNearCta = /\b(add-on|addon|upsell)\b/.test(t) && /\b(cta|button|add to cart|near)\b/.test(t)
  return packIncluded || addonNearCta
}

export function evaluateIncludedPackNearCtaRule(rule: ScanRule, keyElementsString: string): ScanResult | null {
  if (!keyElementsString.includes('--- INCLUDED / BUNDLE ITEMS NEAR CTA (DOM) ---')) return null

  const bundleLikely = /Bundle or kit style offer \(DOM\):\s*YES/i.test(keyElementsString)
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

  // For quick complementary add-on / upsell-near-CTA rules, we should still return
  // a deterministic FAIL when CTA exists but no near-CTA add-on evidence is found.
  // This avoids falling back to noisy AI-only interpretation.
  const ruleText = `${rule.title} ${rule.description}`.toLowerCase()
  const isAddonUpsellFlavor =
    (ruleText.includes('complementary') && (ruleText.includes('add-on') || ruleText.includes('addon') || ruleText.includes('upsell'))) ||
    (ruleText.includes('quick') && ruleText.includes('upsell')) ||
    (ruleText.includes('upsell') && ruleText.includes('cta'))

  if (!ctaFound) {
    return {
      ruleId: rule.id,
      ruleTitle: rule.title,
      passed: false,
      reason:
        'This page looks like a bundle or kit, but the main purchase button was not detected, so included items near the CTA could not be verified.',
    }
  }

  if (!bundleLikely && !isAddonUpsellFlavor) {
    return null
  }

  return {
    ruleId: rule.id,
    ruleTitle: rule.title,
    passed: false,
    reason:
      isAddonUpsellFlavor
        ? 'No quick complementary add-on or upsell block was detected near the main purchase CTA.'
        : 'This product is presented as a bundle or kit, but no clear list of included or bonus items was detected next to the main Add to cart / Buy area.',
  }
}
