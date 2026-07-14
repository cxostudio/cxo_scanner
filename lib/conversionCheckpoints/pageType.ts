/**
 * Pure, dependency-free page-type detection — safe to import on BOTH client and server.
 * The client uses this to build a page-type cache key (`?pageType=…`) so browsers share one
 * cached rule set per page type across all domains, instead of one per exact URL.
 */

export type UrlPageType = 'homepage' | 'product' | 'category' | 'other'

export const URL_PAGE_TYPES: readonly UrlPageType[] = ['homepage', 'product', 'category', 'other']

export function isUrlPageType(v: unknown): v is UrlPageType {
  return typeof v === 'string' && (URL_PAGE_TYPES as readonly string[]).includes(v)
}

export function detectPageTypeFromUrl(url: string): UrlPageType {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.toLowerCase()
    const cleanPath = path.replace(/^\/|\/$/g, '')
    const segments = cleanPath ? cleanPath.split('/') : []

    if (segments.length === 0) return 'homepage'

    const localeRegex = /^[a-z]{2}(-[a-z]{2,3})?$/i
    if (segments.length === 1 && localeRegex.test(segments[0])) return 'homepage'

    const productPatterns = ['product', 'products', 'item', 'p', 'dp', 'gp', 'sku', 'buy']
    const hasProductKeyword = segments.some((segment) => productPatterns.includes(segment))
    const hasAmazonASIN = segments.some((segment) => /^[a-z0-9]{10}$/i.test(segment))
    if (hasProductKeyword || hasAmazonASIN) return 'product'

    const categoryPatterns = [
      'category',
      'categories',
      'collection',
      'collections',
      'catalog',
      'shop',
      'store',
    ]
    const hasCategoryKeyword = segments.some((segment) => categoryPatterns.includes(segment))
    if (hasCategoryKeyword) return 'category'

    return 'other'
  } catch {
    return 'other'
  }
}
