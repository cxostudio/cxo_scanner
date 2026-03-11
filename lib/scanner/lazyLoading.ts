/**
 * Lazy loading detection: scans img/video for loading="lazy", data-src,
 * data-lazy, data-original, and lazy/lazyload classes.
 * Filters out small UI icons/logos. Returns a structured summary for AI.
 */

import type { LazyLoadingResult } from './types'

const MAX_EXAMPLES = 5

export interface LazyLoadingDetectionPayload {
  detected: boolean
  lazyLoadedCount: number
  totalMediaCount: number
  examples: string[]
}

/**
 * Run lazy loading detection in the page. Call after full page load + scroll.
 */
export async function detectLazyLoading(
  page: import('puppeteer-core').Page
): Promise<LazyLoadingDetectionPayload> {
  const payload = await page.evaluate(() => {
    const result: LazyLoadingDetectionPayload = {
      detected: false,
      lazyLoadedCount: 0,
      totalMediaCount: 0,
      examples: [],
    }

    const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('img'))
    const videos = Array.from(document.querySelectorAll('video'))
    const totalMedia = imgs.length + videos.length
    result.totalMediaCount = totalMedia

    function isLikelyUIIcon(el: HTMLImageElement): boolean {
      const w = el.naturalWidth || el.width || 0
      const h = el.naturalHeight || el.height || 0
      const rect = el.getBoundingClientRect()
      const rw = rect.width || 0
      const rh = rect.height || 0
      const size = Math.max(w, h, rw, rh)
      return size > 0 && size < 40
    }

    function hasLazyLoading(el: HTMLImageElement | Element): boolean {
      if (el instanceof HTMLImageElement && el.getAttribute('loading') === 'lazy') return true
      const dataSrc = el.getAttribute('data-src') || el.getAttribute('data-lazy') || el.getAttribute('data-original') || el.getAttribute('data-srcset')
      if (dataSrc) return true
      const cls = (el.className && typeof el.className === 'string' ? el.className : '') || ''
      if (/lazyload|lazy\b|js-lazy|blur-up/i.test(cls)) return true
      return false
    }

    const lazyExamples: string[] = []
    let lazyCount = 0
    for (const img of imgs) {
      if (isLikelyUIIcon(img)) continue
      if (hasLazyLoading(img)) {
        lazyCount++
        const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-original') || ''
        const name = src.split('/').pop() || (img.alt || 'image').substring(0, 40)
        if (lazyExamples.length < 5) lazyExamples.push(name)
      }
    }
    for (const video of videos) {
      if (hasLazyLoading(video)) {
        lazyCount++
        const src = video.src || video.getAttribute('data-src') || ''
        const name = src.split('/').pop() || 'video'
        if (lazyExamples.length < 5) lazyExamples.push(name)
      }
    }
    result.lazyLoadedCount = lazyCount
    result.detected = lazyCount > 0
    result.examples = lazyExamples
    return result
  })
  return payload
}

/**
 * Build the summary string for KEY ELEMENTS and AI.
 */
export function buildLazyLoadingSummary(payload: LazyLoadingDetectionPayload): LazyLoadingResult {
  const lines = [
    `Lazy loading detected: ${payload.detected ? 'YES' : 'NO'}`,
    `Lazy loaded media count: ${payload.lazyLoadedCount}`,
    `Total media: ${payload.totalMediaCount}`,
  ]
  if (payload.examples.length > 0) {
    lines.push(`Examples: ${payload.examples.join(', ')}`)
  }
  return {
    detected: payload.detected,
    lazyLoadedCount: payload.lazyLoadedCount,
    totalMediaCount: payload.totalMediaCount,
    examples: payload.examples,
    summary: lines.join('\n'),
  }
}
