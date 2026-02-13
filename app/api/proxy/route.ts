import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const targetUrl = searchParams.get('url')

  if (!targetUrl) {
    return NextResponse.json(
      { error: 'URL parameter is required' },
      { status: 400 }
    )
  }

  try {
    console.log('Proxying URL:', targetUrl)

    // Fetch the target website
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    // Get the HTML content
    const html = await response.text()

    // Modify HTML to remove X-Frame-Options and add our own CSP
    const modifiedHtml = html
      .replace(/<meta[^>]*http-equiv[^>]*X-Frame-Options[^>]*>/gi, '')
      .replace(/<meta[^>]*content[^>]*X-Frame-Options[^>]*>/gi, '')
      .replace(/X-Frame-Options[^;]*/gi, '')
      .replace(/Content-Security-Policy[^;]*/gi, '')
      .replace(/<head>/i, `<head>
        <meta http-equiv="Content-Security-Policy" content="frame-ancestors 'self' *;">
        <meta http-equiv="X-Frame-Options" content="ALLOWALL">
      `)

    // Return the modified HTML
    return new NextResponse(modifiedHtml, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })

  } catch (error) {
    console.error('Proxy error:', error)
    return NextResponse.json(
      { error: `Failed to proxy URL: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    )
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}