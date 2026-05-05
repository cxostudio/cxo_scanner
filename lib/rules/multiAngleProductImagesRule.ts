/**
 * "Multiple angles / perspectives / complete view" for product gallery imagery.
 * Driven by --- MULTI-ANGLE PRODUCT GALLERY (DOM) --- in KEY ELEMENTS.
 */

import type { ScanRule, ScanResult } from '@/lib/scanner/types'

/** Match titles like Spacegoods checklist: angles, perspectives, complete view — not thumbnails-only or testimonial-video rules */
export function isMultiAngleProductGalleryRule(rule: ScanRule): boolean {
  const t = rule.title.toLowerCase()
  const d = (rule.description || '').toLowerCase()

  if (/\bthumbnail\b/i.test(t) && !t.includes('angle') && !t.includes('perspective')) return false
  if (
    (t.includes('customer') || t.includes('review') || d.includes('testimonial')) &&
    t.includes('video') &&
    !t.includes('image')
  ) {
    return false
  }

  const productImagery =
    (t.includes('product') && (t.includes('image') || t.includes('images') || t.includes('photo'))) ||
    (t.includes('product') && (t.includes('gallery') || t.includes('shown')))

  const multiView =
    (t.includes('multiple') && (t.includes('angle') || t.includes('perspective'))) ||
    (t.includes('perspective') && (t.includes('product') || t.includes('image') || t.includes('complete'))) ||
    (t.includes('angles') && t.includes('product')) ||
    ((t.includes('complete') || t.includes('full')) && t.includes('view') && (t.includes('angle') || t.includes('perspective'))) ||
    (d.includes('multiple angle') || d.includes('multiple perspective') || d.includes('complete view'))

  return productImagery && multiView
}

export function buildMultiAngleGalleryDomBlock(args: {
  distinctCount: number
  passes: boolean
  evidence: string
}): string {
  return [
    '--- MULTI-ANGLE PRODUCT GALLERY (DOM) ---',
    `Distinct gallery media counted: ${args.distinctCount}`,
    `Meets threshold (≥3 distinct views): ${args.passes ? 'YES' : 'NO'}`,
    `Evidence: ${args.evidence}`,
  ].join('\n')
}

/** HTML-only fallback: count unique data-media-id near gallery-like markup (fetch/Puppeteer failure path). */
export function countDistinctGalleryDataMediaIdsFromHtml(html: string): number {
  const anchor = html.search(
    /product__media|product-gallery|media-gallery|data-media-id|media-gallery|data-product-media|product-single__media/i,
  )
  const chunk =
    anchor >= 0
      ? html.slice(Math.max(0, anchor - 600), Math.min(html.length, anchor + 220000))
      : html.slice(0, 240000)
  const re = /\bdata-media-id\s*=\s*["']([^"']+)["']/gi
  const ids = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = re.exec(chunk)) !== null) {
    const id = m[1].trim()
    if (!id) continue
    const start = Math.max(0, m.index - 140)
    const ctx = chunk.slice(start, m.index + 180).toLowerCase()
    if (/review|testimonial|ugc|yotpo|judge|loox|stamped|okendo|junip/.test(ctx)) continue
    ids.add(id)
  }
  if (ids.size >= 3) return ids.size

  const productImages = new Set<string>()
  const ldJsonRe = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let scriptMatch: RegExpExecArray | null
  while ((scriptMatch = ldJsonRe.exec(chunk)) !== null) {
    const raw = scriptMatch[1]?.trim()
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw)
      const nodes = Array.isArray(parsed) ? parsed : [parsed]
      for (const node of nodes) {
        const t = String(node?.['@type'] || '').toLowerCase()
        if (t !== 'product') continue
        const img = node?.image
        const addImage = (v: unknown) => {
          const s = String(v || '').trim()
          if (!s || s.startsWith('data:')) return
          productImages.add(s.split('?')[0].toLowerCase())
        }
        if (Array.isArray(img)) img.forEach(addImage)
        else addImage(img)
      }
    } catch {
      /* ignore malformed ld+json */
    }
  }

  return Math.max(ids.size, productImages.size)
}

export function evaluateMultiAngleProductGalleryRule(rule: ScanRule, keyElementsString: string): ScanResult | null {
  if (!isMultiAngleProductGalleryRule(rule)) return null
  if (!keyElementsString.includes('--- MULTI-ANGLE PRODUCT GALLERY (DOM) ---')) return null

  const countMatch = keyElementsString.match(/Distinct gallery media counted:\s*(\d+)/i)
  const meetsMatch = keyElementsString.match(/Meets threshold[^\n]*:\s*(YES|NO)\b/i)
  const distinct = countMatch ? Math.max(0, parseInt(countMatch[1], 10) || 0) : 0
  const meetsYes = /^yes\b/i.test((meetsMatch?.[1] || '').trim())

  const after = keyElementsString.split('--- MULTI-ANGLE PRODUCT GALLERY (DOM) ---')[1] || ''
  const evLine = after.split('\n').find((l) => /^Evidence:\s*/i.test(l.trim()))
  const evidence = evLine?.replace(/^Evidence:\s*/i, '').trim() || ''

  if (meetsYes && distinct >= 3) {
    return {
      ruleId: rule.id,
      ruleTitle: rule.title,
      passed: true,
      reason:
        evidence.length > 0
          ? `The main product gallery lists at least three distinct media items (angles or views) in the DOM: ${evidence.slice(0, 200)}${evidence.length > 200 ? '…' : ''}`
          : 'The main product gallery includes at least three distinct on-page media items (multiple views/angles) per DOM.',
    }
  }

  return {
    ruleId: rule.id,
    ruleTitle: rule.title,
    passed: false,
    reason:
      distinct > 0
        ? `The product gallery only has ${distinct} distinct media slot(s) in the main gallery area; this checkpoint expects at least three (e.g. front, detail, alternate angle) so shoppers get a fuller view. ${evidence ? `(${evidence.slice(0, 120)}${evidence.length > 120 ? '…' : ''})` : ''}`.trim()
        : `No countable multi-image product gallery was detected in the main media area (fewer than three distinct gallery items). Add more product images or gallery slides. ${evidence ? `(${evidence.slice(0, 120)}${evidence.length > 120 ? '…' : ''})` : ''}`.trim(),
  }
}
