/**
 * Server-only: pick the checkpoints a scan runs.
 *   - page type: inferred from the URL, matched to the Airtable "Page Type" links
 *   - status: Live always; Draft only in test mode (CXO Studio and +test emails)
 *   - check method: only what the scanner can check (not manual audit items or customer uploads)
 */

import type { ScanRule } from '@/lib/conversionCheckpoints/getCheckpointRules'
import { detectPageTypeFromUrl, isTestEmail, type UrlPageType } from '@/lib/conversionCheckpoints/pageType'

export { detectPageTypeFromUrl, isTestEmail }
export type { UrlPageType }

const GENERAL_PAGE_TYPE_ID = 'reclgdsv5ric0dkku'
const HOME_PAGE_TYPE_ID = 'rectbairzlgei24hg'
const PRODUCT_PAGE_TYPE_ID = 'recq3oalwwoefg2x5'
const CATEGORY_PAGE_TYPE_ID = 'recpwt9mnrffkte9i'
// The product scan adds one item to the cart and captures the cart view, so cart checkpoints run there too.
const CART_PAGE_TYPE_ID = 'recdyiscpsbfrbbha'
// ...and opens the first step of checkout. Test scans only until these checkpoints are labelled.
const CHECKOUT_PAGE_TYPE_ID = 'recokhtzh3nxsqnmb'

/** Check methods the scanner cannot do on its own: they stay in the paid audit. */
const NOT_SCANNABLE_METHODS = new Set(['Manual (audit only)', 'Customer upload'])


export type ScanSelectionOptions = { includeDrafts?: boolean }

/** Live always, Draft only in test mode. A rule without status comes from the legacy snapshot (live only). */
export function ruleIsScannable(rule: ScanRule, opts: ScanSelectionOptions = {}): boolean {
  if (rule.method && NOT_SCANNABLE_METHODS.has(rule.method)) return false
  const status = rule.status ?? 'Live'
  return status === 'Live' || (status === 'Draft' && !!opts.includeDrafts)
}

type AirtableRecord = { id: string; createdTime?: string; fields?: Record<string, unknown> }

function normalizeId(id: string): string {
  return id.trim().toLowerCase()
}

export function getRequiredPageTypeIds(pageType: UrlPageType, opts: ScanSelectionOptions = {}): string[] {
  const ids =
    pageType === 'homepage'
      ? [GENERAL_PAGE_TYPE_ID, HOME_PAGE_TYPE_ID]
      : pageType === 'product'
        ? [GENERAL_PAGE_TYPE_ID, PRODUCT_PAGE_TYPE_ID, CART_PAGE_TYPE_ID, ...(opts.includeDrafts ? [CHECKOUT_PAGE_TYPE_ID] : [])]
        : pageType === 'category'
          ? [GENERAL_PAGE_TYPE_ID, CATEGORY_PAGE_TYPE_ID]
          : [GENERAL_PAGE_TYPE_ID]
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
  opts: ScanSelectionOptions = {},
): CheckpointFilterResult {
  return filterCheckpointsByPageType(records, rules, detectPageTypeFromUrl(targetUrl), opts)
}

/**
 * Same filtering as `filterCheckpointsByUrl` but keyed by a page type directly — used by the
 * `?pageType=` cache-shared endpoint so every domain's homepage/product/etc. reuses one result.
 */
export function filterCheckpointsByPageType(
  records: AirtableRecord[],
  rules: ScanRule[],
  pageType: UrlPageType,
  opts: ScanSelectionOptions = {},
): CheckpointFilterResult {
  const requiredPageTypeIds = getRequiredPageTypeIds(pageType, opts)

  const recordById = new Map(records.map((r) => [r.id, r]))
  rules = rules.filter((rule) => ruleIsScannable(rule, opts))
  const filteredRules = rules.filter((rule) => {
    const rec = recordById.get(rule.id)
    if (!rec) return false
    return ruleMatchesPageTypes(rec, requiredPageTypeIds)
  })

  if (filteredRules.length === 0) {
    const keep = new Set(rules.map((r) => r.id))
    return {
      pageType,
      requiredPageTypeIds,
      records: records.filter((r) => keep.has(r.id)),
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
