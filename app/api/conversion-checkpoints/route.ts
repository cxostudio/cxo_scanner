import { NextRequest, NextResponse } from 'next/server'
import { getConversionCheckpointRules } from '@/lib/conversionCheckpoints/getCheckpointRules'
import { filterCheckpointsByUrl } from '@/lib/conversionCheckpoints/filterByUrlPageType'

/** Airtable fetches use `cache: 'no-store'` — must not run during static generation. */
export const dynamic = 'force-dynamic'

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

    const rawUrl = request.nextUrl.searchParams.get('url')?.trim()
    if (rawUrl) {
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

    return NextResponse.json({
      requestedIds: result.requestedIds,
      foundCount: result.foundCount,
      notFoundIds: result.notFoundIds,
      records,
      rules,
      ...filterMeta,
    })
  } catch (err) {
    console.error('[conversion-checkpoints]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Upstream fetch failed' },
      { status: 502 },
    )
  }
}
