/**
 * Server-only: infer URL page shape and filter Airtable checkpoints by linked Page Type record IDs.
 */

import type { ScanRule } from '@/lib/conversionCheckpoints/getCheckpointRules'

export type UrlPageType = 'homepage' | 'product' | 'category' | 'other'

const GENERAL_PAGE_TYPE_ID = 'reclgdsv5ric0dkku'
const HOME_PAGE_TYPE_ID = 'rectbairzlgei24hg'
const PRODUCT_PAGE_TYPE_ID = 'recq3oalwwoefg2x5'
const CATEGORY_PAGE_TYPE_ID = 'recpwt9mnrffkte9i'

type AirtableRecord = { id: string; createdTime?: string; fields?: Record<string, unknown> }

function normalizeId(id: string): string {
  return id.trim().toLowerCase()
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

export function getRequiredPageTypeIds(pageType: UrlPageType): string[] {
  const ids =
    pageType === 'homepage'
      ? [GENERAL_PAGE_TYPE_ID, HOME_PAGE_TYPE_ID]
      : pageType === 'product'
        ? [GENERAL_PAGE_TYPE_ID, PRODUCT_PAGE_TYPE_ID, CATEGORY_PAGE_TYPE_ID]
        : [GENERAL_PAGE_TYPE_ID, CATEGORY_PAGE_TYPE_ID]
  return ids.map(normalizeId)
}

function recordPageTypeIds(record: AirtableRecord): Set<string> {
  const raw = record.fields?.['Page Type']
  const ids = Array.isArray(raw)
    ? raw.filter((v): v is string => typeof v === 'string').map(normalizeId)
    : []
  return new Set(ids)
}

export function ruleMatchesPageTypes(record: AirtableRecord, requiredIds: string[]): boolean {
  const ruleTypes = recordPageTypeIds(record)
  return requiredIds.some((id) => ruleTypes.has(id))
}

/**
 * Returns filtered rules + records; if filter would remove everything, returns original rules/records.
 */
export function filterCheckpointsByUrl(
  records: AirtableRecord[],
  rules: ScanRule[],
  targetUrl: string,
): {
  pageType: UrlPageType
  requiredPageTypeIds: string[]
  records: AirtableRecord[]
  rules: ScanRule[]
  filteredCount: number
  usedFallback: boolean
} {
  const pageType = detectPageTypeFromUrl(targetUrl)
  const requiredPageTypeIds = getRequiredPageTypeIds(pageType)

  const recordById = new Map(records.map((r) => [r.id, r]))
  const filteredRules = rules.filter((rule) => {
    const rec = recordById.get(rule.id)
    if (!rec) return false
    return ruleMatchesPageTypes(rec, requiredPageTypeIds)
  })

  if (filteredRules.length === 0) {
    return {
      pageType,
      requiredPageTypeIds,
      records,
      rules,
      filteredCount: 0,
      usedFallback: true,
    }
  }

  const keptIds = new Set(filteredRules.map((r) => r.id))
  const filteredRecords = records.filter((r) => keptIds.has(r.id))

  return {
    pageType,
    requiredPageTypeIds,
    records: filteredRecords,
    rules: filteredRules,
    filteredCount: filteredRules.length,
    usedFallback: false,
  }
}
