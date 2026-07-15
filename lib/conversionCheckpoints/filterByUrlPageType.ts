/**
 * Server-only: infer URL page shape and filter Airtable checkpoints by linked Page Type record IDs.
 */

import type { ScanRule } from '@/lib/conversionCheckpoints/getCheckpointRules'
import { detectPageTypeFromUrl, type UrlPageType } from '@/lib/conversionCheckpoints/pageType'

export { detectPageTypeFromUrl }
export type { UrlPageType }

const GENERAL_PAGE_TYPE_ID = 'reclgdsv5ric0dkku'
const HOME_PAGE_TYPE_ID = 'rectbairzlgei24hg'
const PRODUCT_PAGE_TYPE_ID = 'recq3oalwwoefg2x5'
const CATEGORY_PAGE_TYPE_ID = 'recpwt9mnrffkte9i'

type AirtableRecord = { id: string; createdTime?: string; fields?: Record<string, unknown> }

function normalizeId(id: string): string {
  return id.trim().toLowerCase()
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

type CheckpointFilterResult = {
  pageType: UrlPageType
  requiredPageTypeIds: string[]
  records: AirtableRecord[]
  rules: ScanRule[]
  filteredCount: number
  usedFallback: boolean
}

/**
 * Returns filtered rules + records; if filter would remove everything, returns original rules/records.
 */
export function filterCheckpointsByUrl(
  records: AirtableRecord[],
  rules: ScanRule[],
  targetUrl: string,
): CheckpointFilterResult {
  return filterCheckpointsByPageType(records, rules, detectPageTypeFromUrl(targetUrl))
}

/**
 * Same filtering as `filterCheckpointsByUrl` but keyed by a page type directly — used by the
 * `?pageType=` cache-shared endpoint so every domain's homepage/product/etc. reuses one result.
 */
export function filterCheckpointsByPageType(
  records: AirtableRecord[],
  rules: ScanRule[],
  pageType: UrlPageType,
): CheckpointFilterResult {
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
