import { NextRequest, NextResponse } from 'next/server'

/**
 * Screenshot + image reading: delegates to /api/analyze_image.
 * All screenshot capture and image reading (OpenRouter vision + rules) lives in analyze_image.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { url } = body

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 })
    }

    const validUrl = typeof url === 'string' ? url.trim() : ''
    if (!validUrl) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 })
    }

    const baseUrl =
      process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : (request.nextUrl?.origin ?? 'http://localhost:3000')

    const res = await fetch(`${baseUrl}/api/analyze_image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: validUrl.startsWith('http') ? validUrl : `https://${validUrl}` }),
    })

    const data = await res.json()

    if (!res.ok) {
      return NextResponse.json(
        { error: data?.error ?? 'Image analysis failed', details: data?.details },
        { status: res.status }
      )
    }

    return NextResponse.json(data)
  } catch (error) {
    console.error('Screenshot API error:', error)
    return NextResponse.json(
      { error: 'Failed to analyze images', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
