import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'

/**
 * POST /api/leads — answers from the onboarding flow on cxo.studio/start.
 * Stored in Supabase (see supabase/leads.sql). Fails open: if storage is
 * unavailable we still return 200, so a visitor is never blocked from their
 * scan or booking because of our database.
 */

const ALLOWED_ORIGINS = [
  'https://cxo.studio',
  'https://www.cxo.studio',
]
const isAllowed = (origin: string | null) =>
  !!origin &&
  (ALLOWED_ORIGINS.includes(origin) ||
    /^https:\/\/cxo-studio-[a-z0-9-]+\.vercel\.app$/.test(origin) || // website preview deploys
    /^http:\/\/localhost:\d+$/.test(origin))

function cors(origin: string | null) {
  const h: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  }
  if (isAllowed(origin)) h['Access-Control-Allow-Origin'] = origin as string
  return h
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: cors(request.headers.get('origin')) })
}

const str = (v: unknown, max = 300) =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null

export async function POST(request: NextRequest) {
  const headers = cors(request.headers.get('origin'))
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

  const email = str(body.email, 200)?.toLowerCase()
  const siteType = str(body.siteType, 20)
  const route = str(body.route, 10)
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !siteType || !route) {
    return NextResponse.json({ error: 'email, siteType and route are required' }, { status: 400, headers })
  }

  const row = {
    email,
    name: str(body.name, 120),
    site_type: siteType,
    platform: str(body.platform, 20),
    url: str(body.url, 500),
    revenue_band: str(body.revenueBand, 40),
    traffic_band: str(body.trafficBand, 40),
    goal: str(body.goal, 60),
    role: str(body.role, 60),
    route,
    locale: str(body.locale, 5),
    source: typeof body.source === 'object' && body.source ? body.source : null,
  }

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (url && key) {
    try {
      const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
      const { error } = await sb.from('leads').insert(row)
      if (error) console.error('[leads] insert failed:', error.message)
    } catch (e) {
      console.error('[leads] supabase unavailable:', e)
    }
  } else {
    console.warn('[leads] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set; lead not stored', row.email)
  }

  return NextResponse.json({ ok: true }, { headers })
}
