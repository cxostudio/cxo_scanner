// Guards: definitions the model keeps breaking even when the Airtable rule spells them out.
// Each guard reads the model's own evidence sentence and overrules a pass that the definition forbids.
// They only ever turn a "pass" into a "fail"; everything else is left as the model answered.
import type { ScanRule as Rule } from '@/lib/conversionCheckpoints/getCheckpointRules'

type Verdict = { answer: 'pass' | 'fail' | 'na' | 'unknown'; evidence: string; coveredByShopify?: boolean }

const CART_SHIPPING_COST = 'recBVdoZfPXnwY7Ys'
const HEADER_CATEGORIES = 'reclt5mHrGdpwf2lU'
const CART_ADDON = 'recaOn94y8pUSo5JK'
const TRUST_NEAR_BUTTON = 'recihw16WgNwYG09z'
const HOME_PRODUCTS = 'recspAXgCOM7wTkLm'
const FOOTER_CATEGORIES = 'recEgJJ3Ja7iD3B63'
/** Page areas the footer can never stand in for. */
const NOT_FOOTER_AREAS = new Set(['Hero', 'Product grid', 'Reviews and social proof', 'Header'])
/** Pay-later offers are a payment option, not a trust signal (the definition says so). */
const BNPL = /scalapay|klarna|afterpay|clearpay|alma|affirm|sezzle|zip pay|paypal pay in|in 3 (fois|x)|in 4 payments|pay later|en 3 fois|en 4 fois/i
const TRUST = /secure|ssl|encrypt|guarantee|garantie|money.back|returns?|retour|trustpilot|rating|reviews?|avis|badge|sécuris|veilig|norton|mcafee/i

/** Header entries that do not say what the store sells. */
const GENERIC_NAV =
  /^(shop( all)?|all products|products|learn|discover|explore|about( us)?|our story|subscribe|subscription|blog|journal|stories|find a store|store locator|stores|contact|help|faq|rewards|gift cards?|sale|new|bestsellers?|best sellers|collections?|menu|account|log ?in|search|cart|bag|cartes? cadeaux?|contact|nous contacter|livraisons?( et retours?)?|retours?|garantie( produit)?|mentions légales|cgv|conditions générales( de vente)?|le journal|journal|nos revendeurs|revendeurs|showroom|notre showroom.*|la boutique.*|boutique|à propos|qui sommes-nous)$/i

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
const ON_PAGE = /buy box|product page|announcement|button|price|title|next to|below|above|beside|under/i

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

    // a low-priced add-on must cost less than what is in the cart: the model sometimes says so and passes anyway
    if (r.id === CART_ADDON && /more expensive|pricier|costs? more|higher.priced|not cheaper|not lower/i.test(v.evidence)) {
      byId.set(r.id, { answer: 'fail', evidence: 'The cart suggests products, but they cost more than what is already in the cart, so they are not a low-priced add-on.' })
      continue
    }

    // the model cites the footer for "first screen", "homepage reviews" and the like: wrong place
    if (r.area && NOT_FOOTER_AREAS.has(r.area) && /footer/i.test(v.evidence) && !/hero|announcement|banner|first screen|top of|header bar|section|carousel|slider|under the header/i.test(v.evidence)) {
      byId.set(r.id, { answer: 'fail', evidence: `This only appears in the footer, not where the checkpoint asks for it (${r.area.toLowerCase()}).` })
      continue
    }

    // category or collection tiles are not products with prices
    if (r.id === HOME_PRODUCTS && /categor|collection/i.test(v.evidence) && !/[€$£]\s?\d|\d\s?[€$£]|price|prix|priced/i.test(v.evidence)) {
      byId.set(r.id, { answer: 'fail', evidence: 'The homepage shows category or collection tiles, not products with prices that link to product pages.' })
      continue
    }

    if (r.id === FOOTER_CATEGORIES) {
      const labels = quotedLabels(v.evidence)
      if (labels.length >= 1 && labels.every((l) => GENERIC_NAV.test(l))) {
        byId.set(r.id, { answer: 'fail', evidence: `The footer links only to service pages (${Array.from(new Set(labels)).join(', ')}), not to the main categories or best-sellers.` })
        continue
      }
    }

    if (r.id === TRUST_NEAR_BUTTON && BNPL.test(v.evidence) && !TRUST.test(v.evidence.replace(BNPL, ''))) {
      byId.set(r.id, { answer: 'fail', evidence: 'Only a pay-later offer sits near the button; it is a payment option, not a trust signal (secure checkout, guarantee, rating).' })
      continue
    }

    if (r.area === 'Buy box' && NEAR_BUTTON.test(r.title) && ELSEWHERE.test(v.evidence) && !ON_PAGE.test(v.evidence)) {
      byId.set(r.id, { answer: 'fail', evidence: 'This only appears in the cart or the footer, not near the add-to-cart button on the product page.' })
    }
  }
}
