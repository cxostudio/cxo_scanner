// Guards: definitions the model keeps breaking even when the Airtable rule spells them out.
// Where a pass may be found is NOT decided here: that is Airtable "Seen in" (index.ts applySeenIn).
// Each guard below is listed in the Airtable "Code check" field of its checkpoint, so nothing is hidden.
// Each guard reads the model's own evidence sentence and overrules a pass that the definition forbids.
// They only ever turn a "pass" into a "fail"; everything else is left as the model answered.
import type { ScanRule as Rule } from '@/lib/conversionCheckpoints/getCheckpointRules'

type Verdict = { answer: 'pass' | 'fail' | 'na' | 'unknown'; evidence: string; coveredByShopify?: boolean; seen?: string[]; by?: 'Code check' | 'Seen in' | 'Measured' }

const CART_SHIPPING_COST = 'recBVdoZfPXnwY7Ys'
const PDP_SHIPPING_COST = 'rec62ttMsx3Yk5lY6'
const HEADER_CATEGORIES = 'reclt5mHrGdpwf2lU'
const CART_ADDON = 'recaOn94y8pUSo5JK'
const TRUST_NEAR_BUTTON = 'recihw16WgNwYG09z'
const HOME_PRODUCTS = 'recspAXgCOM7wTkLm'
const FOOTER_CATEGORIES = 'recEgJJ3Ja7iD3B63'
const QUICK_ADD = 'recUh4cUJHiSxfvun'
const CATEGORY_PROMO = 'recin5p14RpTXTPtp'
const BADGES = 'recg02Mog2Ho8dJFQ'
const LOGIN = 'recJQvv7DmyS0KGJr'
const EMPTY_CART = 'rec53BnzEh3jbjz4O'
/** Checkpoints about customer PICTURES or VIDEOS: written reviews and testimonials never count. */
const CUSTOMER_MEDIA = new Set(['recDdGiDiKLK3SIyX', 'recy3ghSc1IY6x9lf', 'recBIykwniSTLYVjI'])
const MEDIA_WORDS = /photo|picture|image|video|clip|ugc|instagram|tiktok|reel|selfie|thumbnail|play (icon|button)/i
const TEXT_PROOF = /testimonial|review|quote|rating|stars?\b|avis|témoignage/i
/** Pay-later offers are a payment option, not a trust signal (the definition says so). */
const BNPL = /scalapay|klarna|afterpay|clearpay|alma|affirm|sezzle|zip pay|paypal pay in|in 3 (fois|x)|in 4 payments|pay later|en 3 fois|en 4 fois/i
const TRUST = /secure|ssl|encrypt|guarantee|garantie|money.back|returns?|retour|trustpilot|rating|reviews?|avis|badge|sécuris|veilig|norton|mcafee/i

/** Header entries that do not say what the store sells. */
const GENERIC_NAV =
  /^(shop( all)?|all products|products|learn|discover|explore|about( us)?|our story|subscribe|subscription|blog|journal|stories|find a store|store locator|stores|contact|help|faq|rewards|gift cards?|sale|new|bestsellers?|best sellers|collections?|menu|account|log ?in|search|cart|bag|cartes? cadeaux?|contact|nous contacter|livraisons?( et retours?)?|retours?|garantie( produit)?|mentions légales|cgv|conditions générales( de vente)?|le journal|journal|nos revendeurs|revendeurs|showroom|notre showroom.*|la boutique.*|boutique|à propos|qui sommes-nous|build (my|your) routine|take the quiz|quiz|find your (match|routine|fit)|science|research)$/i

/** A threshold or progress bar alone ("Spend $14 to unlock free shipping") says nothing about the cost below it. */
function thresholdOnly(evidence: string) {
  const threshold = /unlock|away from|spend|threshold|progress|qualif|to get free|for free shipping|free shipping (on|over|above|from)|offerte? (dès|à partir)|gratuite? (dès|à partir)|shipping\s*[$€£]\s?\d+(?:[.,]\d+)?\s*\+|shipping\s*\d+(?:[.,]\d+)?\s*[$€£]\s*\+|plus que|gratis vanaf|kostenlos ab|(possible|disponible|available) (dès|à partir de|from|vanaf)/i.test(evidence)
  const cost = /shipping (costs?|is|fee|rate|price)\s*:?\s*[$€£]\s?\d|[$€£]\s?\d+(?:[.,]\d+)?\s*(shipping|delivery)|(otherwise|below (that|this|it)|under (that|this|it))[^.]*[$€£]\s?\d|free shipping (is )?(applied|included|on (all|every))|shipping:\s*free/i.test(evidence)
  // "calculated at checkout" plus an estimator or a tax line is still no shipping cost
  const later = /calculated (at|in) checkout|calculé(s)? (lors|à l'étape) |berekend bij|at checkout|estimate shipping|shipping estimator/i.test(evidence)
  return (threshold || later) && !cost
}

/** The quoted header labels in the evidence, when the model listed them. */
function quotedLabels(evidence: string) {
  return Array.from(evidence.matchAll(/['"‘“]([^'"’”]{2,30})['"’”]/g)).map((m) => m[1].trim())
}


export function applyGuards(rules: Rule[], byId: Map<string, Verdict>, catalogSize?: number) {
  for (const r of rules) {
    const v = byId.get(r.id)
    // empty cart: one button back to the shop ('Shop our bestsellers') is a pass only for a small catalog (under 10 products)
    if (v && r.id === EMPTY_CART && v.answer === 'pass' && !(typeof catalogSize === 'number' && catalogSize < 10)) {
      const outside = v.evidence.replace(/['"‘“][^'"’”]{1,60}['"’”]/g, ' ')
      if (/button|link/i.test(outside) && !/products?|items?|categor|recommend|recently viewed|suggest|carousel|grid|tiles?|collections|thumbnails?|images of/i.test(outside)) {
        byId.set(r.id, { answer: 'fail', evidence: 'The empty cart only offers a button back to the shop, with no products or categories to start again from.', seen: v.seen, by: 'Code check' })
        continue
      }
    }
    // no promotion running on this category: not relevant, never a fail (the model keeps failing it)
    if (v && r.id === CATEGORY_PROMO && v.answer === 'fail' && /no (category[- ]specific )?promotion|not category[- ]specific|only (a )?sitewide|sitewide (announcement|offer|bar|free shipping)|no (current )?(discount|sale|offer)/i.test(v.evidence)) {
      byId.set(r.id, { answer: 'na', evidence: 'No promotion is running on this category, so there is nothing to show at the top.', seen: v.seen, by: 'Code check' })
      continue
    }
    // login: fail only when the way in is a footer link; no entry point at all means the store does not promote accounts
    if (v && r.id === LOGIN && v.answer === 'fail' && !/(only|just|solely)[^.]{0,40}(footer|pied de page|voettekst)|(footer|pied de page)[^.]{0,30}(link|lien)[^.]{0,30}(only|seul)|in the footer(?! either)(?![^.]*\bno\b)/i.test(v.evidence.replace(/no [^.]{0,60}(found )?in the footer/gi, ''))) {
      byId.set(r.id, { answer: 'na', evidence: 'There is no account entry point on the page, so the store does not promote customer accounts.', seen: v.seen, by: 'Code check' })
      continue
    }
    if (!v || v.answer !== 'pass' || v.coveredByShopify) continue

    // merchandising badges only: discount badges ('-30%') alone are not a pass
    if (r.id === BADGES && /-?\d+ ?%|discount|sale|promo|soldes|korting/i.test(v.evidence) && !/best ?seller|new\b|nouveau|nieuw|back in stock|limited|limit[ée]e?|exclusi|top|favou?rite|trending|award/i.test(v.evidence)) {
      byId.set(r.id, { answer: 'fail', evidence: 'Cards only carry discount badges; there are no merchandising badges like Bestseller, New or Back in stock.', seen: v.seen, by: 'Code check' })
      continue
    }

    if (r.id === PDP_SHIPPING_COST && thresholdOnly(v.evidence)) {
      byId.set(r.id, { answer: 'fail', evidence: 'The product page only says when shipping is free; it does not say what shipping costs below that amount.', seen: v.seen, by: 'Code check' })
      continue
    }

    if (r.id === CART_SHIPPING_COST && thresholdOnly(v.evidence)) {
      byId.set(r.id, { answer: 'fail', evidence: 'The cart does not say what shipping costs: it only shows a free-shipping threshold or says shipping is calculated at checkout.', seen: v.seen, by: 'Code check' })
      continue
    }

    if (r.id === HEADER_CATEGORIES) {
      const labels = quotedLabels(v.evidence)
      if (labels.length >= 2 && labels.every((l) => GENERIC_NAV.test(l))) {
        byId.set(r.id, { answer: 'fail', evidence: `The header shows only general entries (${labels.join(', ')}): shoppers must open a menu to see what the store sells.`, seen: v.seen, by: 'Code check' })
        continue
      }
    }

    // a low-priced add-on must cost less than what is in the cart: the model sometimes says so and passes anyway
    if (r.id === CART_ADDON && /more expensive|pricier|costs? more|higher.priced|not cheaper|not lower/i.test(v.evidence)) {
      byId.set(r.id, { answer: 'fail', evidence: 'The cart suggests products, but they cost more than what is already in the cart, so they are not a low-priced add-on.', seen: v.seen, by: 'Code check' })
      continue
    }

    // category or collection tiles are not products with prices
    if (r.id === HOME_PRODUCTS && /categor|collection/i.test(v.evidence) && !/[€$£]\s?\d|\d\s?[€$£]|price|prix|priced/i.test(v.evidence)) {
      byId.set(r.id, { answer: 'fail', evidence: 'The homepage shows category or collection tiles, not products with prices that link to product pages.', seen: v.seen, by: 'Code check' })
      continue
    }

    if (r.id === FOOTER_CATEGORIES) {
      const labels = quotedLabels(v.evidence)
      // a quoted section heading ('Shop') with categories under it is not a service link: only fail when the model
      // names several links and all of them are generic, and does not mention categories at all
      if (labels.length >= 2 && labels.every((l) => GENERIC_NAV.test(l)) && !/categor|collection|bestseller|best-seller|section|under (it|the)|such as/i.test(v.evidence)) {
        byId.set(r.id, { answer: 'fail', evidence: `The footer links only to service pages (${Array.from(new Set(labels)).join(', ')}), not to the main categories or best-sellers.`, seen: v.seen, by: 'Code check' })
        continue
      }
    }

    // written testimonials are not customer photos or videos, however positive or named
    if (CUSTOMER_MEDIA.has(r.id) && (!MEDIA_WORDS.test(v.evidence) || (TEXT_PROOF.test(v.evidence) && !/photos? (of|from|by) (customers?|clients?|real)|customer (photos?|videos?|pictures?)|(user|creator).generated (photos?|videos?)|ugc|tiktok|instagram/i.test(v.evidence)))) {
      byId.set(r.id, { answer: 'fail', evidence: 'There are written reviews or testimonials, but no photos or videos from customers. Written testimonials are not user-generated photos or videos.', seen: v.seen, by: 'Code check' })
      continue
    }

    // "+1" next to colour dots is a variant count, never an add button
    if (r.id === QUICK_ADD && /['"‘“]?\+\s?\d+['"’”]?/.test(v.evidence) && !/cart icon|bag icon|add to (cart|bag)|quick (add|view)|plus button/i.test(v.evidence)) {
      byId.set(r.id, { answer: 'fail', evidence: "The '+1' next to the colour dots counts more variants; it is not an add-to-cart button. There is no quick add on the product cards.", seen: v.seen, by: 'Code check' })
      continue
    }

    if (r.id === TRUST_NEAR_BUTTON && BNPL.test(v.evidence) && !TRUST.test(v.evidence.replace(BNPL, ''))) {
      byId.set(r.id, { answer: 'fail', evidence: 'Only a pay-later offer sits near the button; it is a payment option, not a trust signal (secure checkout, guarantee, rating).', seen: v.seen, by: 'Code check' })
      continue
    }

  }
}
