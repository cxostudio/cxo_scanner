import { NextRequest, NextResponse } from 'next/server'
import { getConversionCheckpointRules } from '@/lib/conversionCheckpoints/getCheckpointRules'
import {
  filterCheckpointsByUrl,
  filterCheckpointsByPageType,
} from '@/lib/conversionCheckpoints/filterByUrlPageType'
import { isUrlPageType } from '@/lib/conversionCheckpoints/pageType'

export const dynamic = 'force-dynamic'

/**
 * Browser cache for the checkpoints JSON (titles/descriptions used before a scan).
 * Default 1 day (aligned with live cache TTL); override with CHECKPOINTS_BROWSER_CACHE_SECONDS.
 */
const CHECKPOINTS_BROWSER_CACHE_SECONDS = (() => {
  const n = parseInt(process.env.CHECKPOINTS_BROWSER_CACHE_SECONDS ?? '', 10)
  return Number.isFinite(n) && n >= 0 ? n : 24 * 60 * 60
})()

/**
 * Proxies Airtable using server-only env vars (API_KEY must not be exposed to the client).
 * Returns raw `records` plus normalized `rules` for scanning (title / description from Airtable fields).
 *
 * Optional `?url=` — when present, rules + records are filtered server-side by URL page type
 * (same heuristics as before on the client) and Airtable "Page Type" linked-record IDs.
 */
export async function GET(request: NextRequest) {
  try {
    const result = await getConversionCheckpointRules()

    if (!result.ok) {
      return NextResponse.json(result.body, { status: result.status })
    }

    let records = result.records
    let rules = result.rules
    let filterMeta: Record<string, unknown> = {}

    // Preferred: `?pageType=` — the rules only depend on page type, so keying by it lets every
    // domain's homepage/product/category/other share ONE browser cache entry (not one per URL).
    const rawPageType = request.nextUrl.searchParams.get('pageType')?.trim()
    const rawUrl = request.nextUrl.searchParams.get('url')?.trim()
    if (rawPageType && isUrlPageType(rawPageType)) {
      const filtered = filterCheckpointsByPageType(records, rules, rawPageType)
      records = filtered.records
      rules = filtered.rules
      filterMeta = {
        detectedPageType: filtered.pageType,
        requiredPageTypeIds: filtered.requiredPageTypeIds,
        filteredRulesCount: filtered.filteredCount,
        filterUsedFallback: filtered.usedFallback,
      }
    } else if (rawUrl) {
      let normalized = rawUrl
      if (!/^https?:\/\//i.test(normalized)) {
        normalized = `https://${normalized}`
      }
      try {
        void new URL(normalized)
        const filtered = filterCheckpointsByUrl(records, rules, normalized)
        records = filtered.records
        rules = filtered.rules
        filterMeta = {
          detectedPageType: filtered.pageType,
          requiredPageTypeIds: filtered.requiredPageTypeIds,
          filteredRulesCount: filtered.filteredCount,
          filterUsedFallback: filtered.usedFallback,
        }
      } catch {
        filterMeta = { filterError: 'Invalid url query parameter' }
      }
    }

    // Server log — visible in Vercel / local terminal
    console.log('[conversion-checkpoints]', {
      foundCount: result.foundCount,
      notFoundIds: result.notFoundIds,
      rulesCount: rules.length,
      ruleTitles: rules.map((r) => r.title),
      ...filterMeta,
    })

    const response = NextResponse.json({
      requestedIds: result.requestedIds,
      foundCount: result.foundCount,
      notFoundIds: result.notFoundIds,
      records,
      rules,
      ...filterMeta,
    })
    // Browser-side cache: reuse this URL's rules for N days; hard reload bypasses it.
    response.headers.set(
      'Cache-Control',
      `private, max-age=${CHECKPOINTS_BROWSER_CACHE_SECONDS}`,
    )
    return response
  } catch (err) {
    console.error('[conversion-checkpoints]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Upstream fetch failed' },
      { status: 502 },
    )
  }
}
