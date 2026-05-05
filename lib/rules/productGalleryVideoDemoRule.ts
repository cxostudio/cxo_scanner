/**
 * Product gallery includes video to demonstrate the product — not customer testimonial videos.
 * Driven by --- PRODUCT GALLERY VIDEO DEMO (DOM) --- in KEY ELEMENTS.
 */

import type { ScanRule, ScanResult } from '@/lib/scanner/types'

/** True for “gallery + video + demonstration” checkpoints; excludes customer video testimonial rules. */
export function isProductGalleryVideoDemoRule(rule: ScanRule): boolean {
  const t = rule.title.toLowerCase()
  const d = rule.description.toLowerCase()
  const isTestimonialStyle =
    (t.includes('testimonial') && t.includes('video')) ||
    (t.includes('customer') && (t.includes('video') || t.includes('review'))) ||
    d.includes('video testimonial') ||
    d.includes('customer video testimonial')
  if (isTestimonialStyle) return false

  const hasGallery = t.includes('gallery') || d.includes('gallery')
  const hasVideo = t.includes('video') || d.includes('video')
  if (!hasGallery || !hasVideo) return false

  const demoIntent =
    t.includes('demonstrat') ||
    d.includes('demonstrat') ||
    t.includes(' demo') ||
    d.includes(' demo') ||
    (t.includes('product') && t.includes('include') && hasVideo && hasGallery)

  return demoIntent
}

export function evaluateProductGalleryVideoDemoRule(rule: ScanRule, keyElementsString: string): ScanResult | null {
  if (!isProductGalleryVideoDemoRule(rule)) return null
  if (!keyElementsString.includes('--- PRODUCT GALLERY VIDEO DEMO (DOM) ---')) return null

  const galleryVideoYes = /Videos in product gallery \(DOM\):\s*YES\b/i.test(keyElementsString)

  const evLine = keyElementsString
    .split('--- PRODUCT GALLERY VIDEO DEMO (DOM) ---')[1]
    ?.split('\n')
    .find((l) => /^Evidence:/i.test(l.trim()))
  const evidence = evLine?.replace(/^Evidence:\s*/i, '').trim() || ''

  if (galleryVideoYes) {
    return {
      ruleId: rule.id,
      ruleTitle: rule.title,
      passed: true,
      reason:
        evidence.length > 0 && evidence.toLowerCase() !== 'none'
          ? `The product image gallery contains demonstrative video (HTML5 video, embedded player, or Shopify video media): ${evidence.slice(0, 180)}${evidence.length > 180 ? '…' : ''}`
          : 'The product image gallery contains video media suited to demonstrating the product (detected via DOM).',
    }
  }

  return {
    ruleId: rule.id,
    ruleTitle: rule.title,
    passed: false,
    reason:
      'No video was detected inside the **product gallery** (main product media/carousel area). Images, review-section videos, or off-page embeds do not satisfy this checkpoint — add an on-gallery video or embedded demo.',
  }
}
