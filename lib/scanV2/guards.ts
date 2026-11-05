// Guards: definitions the model keeps breaking even when the Airtable rule spells them out.
// Each guard reads the model's own evidence sentence and overrules a pass that the definition forbids.
// They only ever turn a "pass" into a "fail"; everything else is left as the model answered.
import type { ScanRule as Rule } from '@/lib/conversionCheckpoints/getCheckpointRules'

type Verdict = { answer: 'pass' | 'fail' | 'na' | 'unknown'; evidence: string; coveredByShopify?: boolean }

const CART_SHIPPING_COST = 'recBVdoZfPXnwY7Ys'
const HEADER_CATEGORIES = 'reclt5mHrGdpwf2lU'

/** Header entries that do not say what the store sells. */
const GENERIC_NAV =
  /^(shop( all)?|all products|products|learn|discover|explore|about( us)?|our story|subscribe|subscription|blog|journal|stories|find a store|store locator|stores|contact|help|faq|rewards|gift cards?|sale|new|bestsellers?|best sellers|collections?|menu|account|log ?in|search|cart|bag)$/i

/** A threshold or progress bar alone ("Spend $14 to unlock free shipping") says nothing about the cost below it. */
function thresholdOnly(evidence: string) {
  const threshold = /unlock|away from|spend|threshold|progress|qualif|to get free|for free shipping|free shipping (on|over|above|from)/i.test(evidence)
  const cost = /shipping (costs?|is|fee|rate|price)\s*:?\s*[$€£]\s?\d|[$€£]\s?\d+(?:[.,]\d+)?\s*(shipping|delivery)|(otherwise|below (that|this|it)|under (that|this|it))[^.]*[$€£]\s?\d|free shipping (is )?(applied|included|on (all|every))|shipping:\s*free/i.test(evidence)
  return threshold && !cost
}

/** The quoted header labels in the evidence, when the model listed them. */
function quotedLabels(evidence: string) {
  return Array.from(evidence.matchAll(/['"‘“]([^'"’”]{2,30})['"’”]/g)).map((m) => m[1].trim())
}

/** "Near the button" checkpoints: found only in the cart drawer or the footer does not count. */
const NEAR_BUTTON = /near (the )?(main )?(buy|add-to-cart|cta|button|price)|near the main cta|near the buy button/i
const ELSEWHERE = /cart drawer|in the cart|the cart (shows|states|says)|footer/i
const ON_PAGE = /buy box|below the (button|price)|under the (button|price)|next to the (button|price)|above the (button|price)|near the (button|price)/i

export function applyGuards(rules: Rule[], byId: Map<string, Verdict>) {
  for (const r of rules) {
    const v = byId.get(r.id)
    if (!v || v.answer !== 'pass' || v.coveredByShopify) continue

    if (r.id === CART_SHIPPING_COST && thresholdOnly(v.evidence)) {
      byId.set(r.id, { answer: 'fail', evidence: 'The cart only shows how far you are from free shipping; it does not say what shipping costs below that amount.' })
      continue
    }

    if (r.id === HEADER_CATEGORIES) {
      const labels = quotedLabels(v.evidence)
      if (labels.length >= 2 && labels.every((l) => GENERIC_NAV.test(l))) {
        byId.set(r.id, { answer: 'fail', evidence: `The header shows only general entries (${labels.join(', ')}): shoppers must open a menu to see what the store sells.` })
        continue
      }
    }

    if (r.area === 'Buy box' && NEAR_BUTTON.test(r.title) && ELSEWHERE.test(v.evidence) && !ON_PAGE.test(v.evidence)) {
      byId.set(r.id, { answer: 'fail', evidence: 'This only appears in the cart or the footer, not near the add-to-cart button on the product page.' })
    }
  }
}
