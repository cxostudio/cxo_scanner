// Which part of the store a result belongs to. The product page scan also judges the cart,
// checkout and store-wide checks, so its results are split by the checkpoint's Airtable page tags.
export type ReportArea = 'site' | 'homepage' | 'category' | 'product' | 'cart' | 'checkout'
const SITE = 'reclgdsv5ric0dkku', PRODUCT = 'recq3oalwwoefg2x5', CART = 'recdyiscpsbfrbbha', CHECKOUT = 'recokhtzh3nxsqnmb'

export function areaOf(page: string, pageTypeIds: string[] | undefined): ReportArea {
  if (page === 'homepage' || page === 'category') return page
  const t = (pageTypeIds || []).map((x) => x.toLowerCase())
  if (t.includes(CHECKOUT)) return 'checkout'
  if (t.includes(CART)) return 'cart'
  if (t.includes(PRODUCT)) return 'product'
  if (t.includes(SITE)) return 'site'
  return 'product'
}
