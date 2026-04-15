import { NextResponse } from 'next/server'
import { getConversionCheckpointRules } from '@/lib/conversionCheckpoints/getCheckpointRules'

/** Airtable fetches use `cache: 'no-store'` — must not run during static generation. */
export const dynamic = 'force-dynamic'

/**
 * Proxies Airtable using server-only env vars (API_KEY must not be exposed to the client).
 * Returns raw `records` plus normalized `rules` for scanning (title / description from Airtable fields).
 */
export async function GET() {
  try {
    const result = await getConversionCheckpointRules()

    if (!result.ok) {
      return NextResponse.json(result.body, { status: result.status })
    }

    // Server log — visible in Vercel / local terminal
    console.log('[conversion-checkpoints]', {
      foundCount: result.foundCount,
      notFoundIds: result.notFoundIds,
      rulesCount: result.rules.length,
      ruleTitles: result.rules.map((r) => r.title),
    })

    return NextResponse.json({
      requestedIds: result.requestedIds,
      foundCount: result.foundCount,
      notFoundIds: result.notFoundIds,
      records: result.records,
      rules: result.rules,
    })
  } catch (err) {
    console.error('[conversion-checkpoints]', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Upstream fetch failed' },
      { status: 502 },
    )
  }
}
