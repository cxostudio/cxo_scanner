import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import {
  refreshCheckpointRulesCache,
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

async function writeSnapshotFile(data: {
  requestedIds: readonly string[]
  foundCount: number
  notFoundIds: string[]
  records: unknown[]
  rules: unknown[]
}): Promise<boolean> {
  if (process.env.VERCEL) return false
  try {
    const snapshot = {
      generatedAt: new Date().toISOString(),
      requestedIds: data.requestedIds,
      foundCount: data.foundCount,
      notFoundIds: data.notFoundIds,
      records: data.records,
      rules: data.rules,
    }
    await fs.writeFile(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
    return true
  } catch (err) {
    console.warn('[checkpoints/refresh] snapshot file write skipped:', err)
    return false
  }
}

async function runRefresh(): Promise<NextResponse> {
  const result = await refreshCheckpointRulesCache()
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.body, cache: getCheckpointRulesCacheInfo() },
      { status: result.status },
    )
  }

  const wroteSnapshot = await writeSnapshotFile(result.data)

  console.log('[checkpoints/refresh] cache refilled from Airtable', {
    rulesCount: result.data.rules.length,
    recordsCount: result.data.records.length,
    notFoundIds: result.data.notFoundIds,
    wroteSnapshot,
  })

  return NextResponse.json({
    ok: true,
    emptied: true,
    refilledFrom: 'airtable',
    rulesCount: result.data.rules.length,
    recordsCount: result.data.records.length,
    notFoundIds: result.data.notFoundIds,
    wroteSnapshot,
    cache: getCheckpointRulesCacheInfo(),
  })
}

function isAuthorizedCron(request: NextRequest): boolean {
  // Vercel Cron invocations include this header.
  if (request.headers.get('x-vercel-cron') === '1') return true
  const cronSecret = process.env.CRON_SECRET?.trim()
  if (!cronSecret) return false
  const auth = request.headers.get('authorization')
  return auth === `Bearer ${cronSecret}`
}

/**
 * GET — cache status for the admin UI.
 * When invoked by Vercel Cron (or CRON_SECRET bearer), refreshes Airtable so Example
 * image URLs stay signed (aligned with the 1-day cache TTL).
 */
export async function GET(request: NextRequest) {
  if (isAuthorizedCron(request)) {
    return runRefresh()
  }
  return NextResponse.json(getCheckpointRulesCacheInfo())
}

/**
 * POST — manual refresh from the admin UI.
 * Re-pulls Airtable and replaces the live cache on success (does not wipe first,
 * so a failed pull keeps the previous live cache).
 */
export async function POST() {
  return runRefresh()
}
