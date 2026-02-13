// Helper utility functions for scan API

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export function extractRetryAfter(errorMessage: string): number {
  const match = errorMessage.match(/try again in ([\d.]+)s/i)
  if (match) {
    return Math.ceil(parseFloat(match[1]) * 1000)
  }
  return 0
}

export function toProtocolRelativeUrl(url: string, baseUrl: string): string {
  if (!url || url.startsWith('data:') || url.startsWith('//')) {
    return url
  }

  try {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const urlObj = new URL(url)
      return `//${urlObj.host}${urlObj.pathname}${urlObj.search}${urlObj.hash}`
    }

    const baseUrlObj = new URL(baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`)
    const resolvedUrl = new URL(url, baseUrlObj.href)
    return `//${resolvedUrl.host}${resolvedUrl.pathname}${resolvedUrl.search}${resolvedUrl.hash}`
  } catch (error) {
    console.warn('Failed to convert URL to protocol-relative:', url, error)
    return url
  }
}

export function normalizeAmazonUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    if (!host.includes('amazon.')) return url

    let asin: string | null = null
    const dpMatch = parsed.pathname.match(/\/dp\/([^/]+)/)
    const gpMatch = parsed.pathname.match(/\/gp\/product\/([^/]+)/)

    if (dpMatch?.[1]) asin = dpMatch[1]
    else if (gpMatch?.[1]) asin = gpMatch[1]

    if (asin) {
      const normalized = `${parsed.protocol}//${parsed.host}/dp/${asin}`
      console.log(`Normalizing Amazon URL: ${url} → ${normalized}`)
      return normalized
    }
  } catch (e) {
    console.warn('URL normalization failed:', e)
  }
  return url
}
