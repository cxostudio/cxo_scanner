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

    // Add more realistic headers to avoid blocking
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Cache-Control': 'max-age=0',
      'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    }

    // Fetch the target website with timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000) // 10 second timeout

    const response = await fetch(targetUrl, {
      headers,
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    // Get the HTML content
    const html = await response.text()

    // Modify HTML to remove security restrictions
    const modifiedHtml = html
      .replace(/<meta[^>]*http-equiv[^>]*X-Frame-Options[^>]*>/gi, '')
      .replace(/<meta[^>]*content[^>]*X-Frame-Options[^>]*>/gi, '')
      .replace(/X-Frame-Options[^;]*/gi, '')
      .replace(/Content-Security-Policy[^;]*/gi, '')
      .replace(/frame-ancestors[^;]*/gi, '')
      .replace(/<head>/i, `<head>
        <meta http-equiv="Content-Security-Policy" content="frame-ancestors *;">
        <meta http-equiv="X-Frame-Options" content="ALLOWALL">
        <base href="${targetUrl}">
      `)

    // Return the modified HTML
    return new NextResponse(modifiedHtml, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'X-Content-Type-Options': 'nosniff',
      },
    })

  } catch (error) {
    console.error('Proxy error:', error)

    // Return a more informative error message
    let errorMessage = 'Failed to proxy URL'
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        errorMessage = 'Request timeout - website took too long to respond'
      } else if (error.message.includes('403')) {
        errorMessage = 'Website blocks proxy requests - will show screenshot instead'
      } else if (error.message.includes('401')) {
        errorMessage = 'Website requires authentication - will show screenshot instead'
      } else {
        errorMessage = `Failed to proxy URL: ${error.message}`
      }
    }

    return NextResponse.json(
      { error: errorMessage },
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