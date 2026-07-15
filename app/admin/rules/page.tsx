'use client'

import { useEffect, useState } from 'react'

type CacheInfo = {
  source: 'live-cache' | 'snapshot' | 'empty'
  cached: boolean
  ageMs: number | null
  ttlMs: number
  rulesCount: number
  snapshotGeneratedAt: string | null
}

type RefreshResult = {
  ok: boolean
  rulesCount?: number
  recordsCount?: number
  notFoundIds?: string[]
  wroteSnapshot?: boolean
  error?: unknown
}

function fmtAge(ms: number | null): string {
  if (ms == null) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.round(m / 60)}h ago`
}

const SOURCE_LABEL: Record<CacheInfo['source'], string> = {
  'live-cache': 'Fresh from Airtable (in-memory cache)',
  snapshot: 'Committed snapshot (as of last refresh)',
  empty: 'Empty — will fall back to a live Airtable fetch',
}

export default function RulesAdminPage() {
  const [info, setInfo] = useState<CacheInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function loadStatus() {
    try {
      const res = await fetch('/api/checkpoints/refresh', { method: 'GET', cache: 'no-store' })
      setInfo((await res.json()) as CacheInfo)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to load status')
    }
  }

  useEffect(() => {
    loadStatus()
  }, [])

  async function emptyCache() {
    setBusy(true)
    setMsg(null)
    setErr(null)
    try {
      const res = await fetch('/api/checkpoints/refresh', { method: 'POST', cache: 'no-store' })
      const data = (await res.json()) as RefreshResult
      if (!res.ok || !data.ok) {
        setErr(
          typeof data.error === 'string'
            ? data.error
            : `Refresh failed (HTTP ${res.status}) — reads will fall back to the committed snapshot.`,
        )
      } else {
        setMsg(
          `Cache emptied and reloaded ${data.rulesCount} rules from Airtable` +
            (data.wroteSnapshot ? ' (snapshot file rewritten — commit it to publish).' : '.'),
        )
      }
      await loadStatus()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Refresh request failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-xl font-semibold text-zinc-900">Checkpoint rules cache</h1>
      <p className="mt-2 text-sm text-zinc-500">
        Scans read the checklist rules from the server cache instead of calling Airtable every time.
        Click <span className="font-medium">Empty cache</span> to drop the cached copy and reload
        the latest rules from Airtable — the change goes live on the next scan.
      </p>

      <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-zinc-500">Currently serving</dt>
          <dd className="font-medium text-zinc-900">{info ? SOURCE_LABEL[info.source] : '…'}</dd>
          <dt className="text-zinc-500">Rules cached</dt>
          <dd className="font-medium text-zinc-900">{info?.rulesCount ?? '…'}</dd>
          <dt className="text-zinc-500">Live cache age</dt>
          <dd className="font-medium text-zinc-900">
            {info ? fmtAge(info.ageMs) : '…'}
            {info ? <span className="text-zinc-400"> (auto-expires after {Math.round(info.ttlMs / 60000)}m)</span> : null}
          </dd>
          <dt className="text-zinc-500">Snapshot generated</dt>
          <dd className="font-medium text-zinc-900">
            {info?.snapshotGeneratedAt ? new Date(info.snapshotGeneratedAt).toLocaleString() : '—'}
          </dd>
        </dl>
      </div>

      <button
        type="button"
        onClick={emptyCache}
        disabled={busy}
        className="mt-5 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        {busy ? 'Emptying…' : 'Empty cache'}
      </button>

      {msg ? <p className="mt-4 text-sm text-green-700">{msg}</p> : null}
      {err ? <p className="mt-4 text-sm text-red-600">{err}</p> : null}
    </main>
  )
}
