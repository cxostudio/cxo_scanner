// The server finishes a scan whose browser went quiet (tab closed, phone locked, app switched).
import { claimForServer, failJob, getJob } from './store'
import { runScanOnServer } from './runServer'
import { finishJob } from './finish'

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Take the scan over if the browser has been quiet for `quietSeconds`; returns true if it did. */
export async function takeOver(id: string, quietSeconds: number): Promise<boolean> {
  const job = await claimForServer(id, quietSeconds)
  if (!job) return false
  console.log('[scan-job] server takes over', id, job.url)
  try {
    const snap = await runScanOnServer(job)
    const r = await finishJob(job, snap)
    console.log('[scan-job] server finished', id, r)
  } catch (e) {
    console.error('[scan-job] server run failed', id, e)
    await failJob(id, e instanceof Error ? e.message : 'server run failed')
  }
  return true
}

/**
 * Watch a new scan for its first two minutes (most scans finish in about one). If the browser's
 * heartbeat stops, take over. After that, the "leave" signal from the page covers the rest.
 */
export async function watch(id: string): Promise<void> {
  const until = Date.now() + 120_000
  while (Date.now() < until) {
    await sleep(10_000)
    const job = await getJob(id).catch(() => null)
    if (!job || job.status !== 'running') return
    if (Date.now() - new Date(job.heartbeat_at).getTime() > 30_000) { await takeOver(id, 30); return }
  }
}
