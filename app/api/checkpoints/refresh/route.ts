import { NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import {
  fetchCheckpointRulesFromAirtable,
  setCheckpointRulesCache,
  clearCheckpointRulesCache,
  getCheckpointRulesCacheInfo,
} from '@/lib/conversionCheckpoints/getCheckpointRules'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SNAPSHOT_PATH = path.join(
  process.cwd(),
  'lib',
  'conversionCheckpoints',
  'checkpoints.snapshot.json',
)

/** GET — current cache status (for the admin UI to display). */
export async function GET() {
  return NextResponse.json(getCheckpointRulesCacheInfo())
}

/**
 * POST — the "Empty cache" action.
 *
 * Empties the in-memory rules cache and re-pulls fresh rules from Airtable, so edits go live
 * on the very next scan without a redeploy. Works in production (memory only). When run locally
 * it *also* rewrites the committed snapshot file so you can commit a fresh baseline.
 */
export async function POST() {
  // Empty first, so a failed Airtable pull leaves reads falling back to the committed snapshot.
  clearCheckpointRulesCache()

  const result = await fetchCheckpointRulesFromAirtable()
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, emptied: true, error: result.body },
      { status: result.status },
    )
  }

  // Refill the in-memory cache — this is what makes the refresh take effect in production.
  setCheckpointRulesCache(result)

  // Locally, also persist the committed snapshot so it can be committed as the new baseline.
  let wroteSnapshot = false
  if (!process.env.VERCEL) {
    try {
      const snapshot = {
        generatedAt: new Date().toISOString(),
        requestedIds: result.requestedIds,
        foundCount: result.foundCount,
        notFoundIds: result.notFoundIds,
        records: result.records,
        rules: result.rules,
      }
      await fs.writeFile(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
      wroteSnapshot = true
    } catch (err) {
      console.warn('[checkpoints/refresh] snapshot file write skipped:', err)
    }
  }

  console.log('[checkpoints/refresh] cache refilled from Airtable', {
    rulesCount: result.rules.length,
    recordsCount: result.records.length,
    notFoundIds: result.notFoundIds,
    wroteSnapshot,
  })

  return NextResponse.json({
    ok: true,
    emptied: true,
    refilledFrom: 'airtable',
    rulesCount: result.rules.length,
    recordsCount: result.records.length,
    notFoundIds: result.notFoundIds,
    wroteSnapshot,
    cache: getCheckpointRulesCacheInfo(),
  })
}
