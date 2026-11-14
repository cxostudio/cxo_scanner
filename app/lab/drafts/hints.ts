// Claude's recommendation per Draft checkpoint, shown as "My take" in /lab/drafts. Opinions, not data:
// the accuracy next to them is the fact.

/** The scanner does not capture what these need yet. */
export const NO_CAPTURE = new Set([
  'recPKeMkL99ewxiFu', // search suggestions
  'rec2NXZ5QTVyDYSua', // dead-end pages
  'rec7y312t00iNPOu7', // added to cart
  'reckvvOz1p1ZbqVVZ', // image zoom
  'recGtf0uyLiIAUc8S', // cart checkout button hover
  'recXEoY42x4W6qMHr', // filter keeps your place
  'recWctdeyEyTRSFcU', // search results look like a category
])

/** Kept back on purpose. */
export const PARKED = new Set([
  'recRdraUHMBfjsRd9', // shipping promise: being rebuilt (AI reads the numbers, code decides)
  'rec0MZqSu1LFuM9BI', // membership at checkout: your call, kept as draft
])

export const HINTS: Record<string, string> = {
  // missing a capture step
  recPKeMkL99ewxiFu: 'Build. Type a product word in the search and screenshot the dropdown. High impact, cheap to capture.',
  rec2NXZ5QTVyDYSua: 'Build. Visit a made-up URL and an empty search, screenshot both. Cheap, and stores get it wrong often.',
  rec7y312t00iNPOu7: 'Build. We already click add to cart; screenshot right after the click. Cheap.',
  reckvvOz1p1ZbqVVZ: 'Build. Click the main image and screenshot what opens. Cheap.',
  recGtf0uyLiIAUc8S: 'Build, low priority: same hover test as the add-to-cart button, on the cart button.',
  recXEoY42x4W6qMHr: 'Later. Needs clicking a filter and comparing scroll position: fiddly and store-specific.',
  recWctdeyEyTRSFcU: 'Build together with search suggestions: run the search and screenshot the results page.',
  // parked
  recRdraUHMBfjsRd9: 'Rebuilding: the AI reads threshold, order total and shipping charged; code decides. The AI alone contradicts itself.',
  rec0MZqSu1LFuM9BI: 'Keep draft, as you said: very few stores have a membership.',
  // needs labels
  recJIKYF3A1cqKzEn: 'Now really measured (response headers), names the app at fault. Label 3 and promote.',
  rec4FB41t10SPslqM: 'Real test (we switch tabs). Fails almost everywhere, which is true. Low value in a report; I would keep it but low priority.',
  recwXj9uJbO8SXOZW: 'Rewritten this morning as the checkout timer check, as you asked. Needs 4 more labels.',
  recqdZbBbXoGLLZYV: 'Needs 3 more labels. Useful in Europe where consent banners are big.',
  // under 90%
  recWRP5tUfrR3B4rI: 'Now 10/12 after the fix (was 0/12). Agreed rule: fails unless the store says it tested. Check the 2 left.',
  recMmrb4rP1lYJqjK: '12/18 with the new rule (no optional label = required). Some of your older labels were made under the old rule: worth a relabel pass.',
  recugOkV72c8sERRM: 'Dropped from 20/20 to 17/20 after the checkout fix: the model now sees the real checkout. Look at the 3.',
  recy4v2IJlY07COSY: '41/50: subjective (are the menu words the ones shoppers use). I would keep it as an audit-only check.',
  recyDWQ5MaZKgdzY1: '44/50: mostly currency switchers the scanner misses. Measurement fix on my side.',
  recYRJzuWC8lHXc40: '17/20: gallery proportions should be measured from image sizes, not judged by eye. Fix on my side.',
  recaOn94y8pUSo5JK: '10/17: the definition of "relevant, low-priced" is loose. Needs a sharper rule (price under X% of the cart).',
  recin5p14RpTXTPtp: '6/13 and marked Manual: drop from the scanner, keep for the paid audit.',
  recF2wcD29XraBQaP: '5/9: few stores offer it, labels are thin. Keep draft until more checkout stores.',
  recRbVoxG8qjJlszm: '15/20: chat bubbles are often not visible in the screenshot. Measurement fix (detect chat widgets in the code).',
  recJCypfRGqHXDMTG: '14/20: "sells on sustainability" is a judgment call. Keep draft or move to audit.',
  recmj6IwHOuekoyE5: '14/19: same problem as sustainability. Keep draft or move to audit.',
  recFb69uZnZjNStB4: '11/16: needs the shopper country to be known. Fix: compare units with the store language.',
  recRuzk4g4Dh6o211: '13/16 after the fix. Close; check the 3.',
}
