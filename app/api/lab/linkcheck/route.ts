// Test lab: check that links in checkpoint texts still work before they go in front of clients.
// POST { urls: string[] } → [{ url, status, finalUrl, ok }]. GET fallback when HEAD is refused.
import { NextRequest, NextResponse } from 'next/server'
import { labAllowed } from '@/lib/lab/store'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

async function check(url: string) {
  for (const method of ['HEAD', 'GET'] as const) {
    try {
      const res = await fetch(url, { method, redirect: 'follow', headers: { 'User-Agent': UA, Accept: 'text/html,*/*' }, signal: AbortSignal.timeout(12000), cache: 'no-store' })
      if (method === 'HEAD' && (res.status === 405 || res.status === 403 || res.status >= 500)) continue
      return { url, status: res.status, finalUrl: res.url, ok: res.status < 400 }
    } catch (e) {
      if (method === 'GET') return { url, status: 0, finalUrl: '', ok: false, error: String((e as Error).message || e) }
    }
  }
  return { url, status: 0, finalUrl: '', ok: false }
}

export async function POST(req: NextRequest) {
  if (!labAllowed(req.nextUrl.searchParams.get('key'))) return NextResponse.json({ error: 'Not allowed' }, { status: 403 })
  const body = (await req.json().catch(() => ({}))) as { urls?: string[] }
  const urls = [...new Set((body.urls || []).filter((u) => /^https?:\/\//.test(u)))].slice(0, 80)
  const out = []
  for (let i = 0; i < urls.length; i += 10) out.push(...(await Promise.all(urls.slice(i, i + 10).map(check))))
  return NextResponse.json({ results: out })
}
