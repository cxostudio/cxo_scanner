/**
 * Browser-only bundle / included-pack snapshot (passed to page.evaluate).
 */

export function snapshotIncludedPackDom(): {
  ctaFound: boolean
  bundleLikely: boolean
  includedNearCta: boolean
  evidence: string[]
} {
  function findPrimaryPurchaseCta(): HTMLElement | null {
    const ctaPatterns = [
      'add to bag',
      'add to basket',
      'add to cart',
      'add to order',
      'buy now',
      'buy it now',
      'purchase',
      'checkout',
      'pay now',
      'order now',
      'complete order',
      'place order',
      'add pack',
      'get it now',
    ]
    const selectors =
      'button, [type="submit"], [role="button"], a[href*="/cart"], input[type="submit"], input[type="button"]'
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(selectors))
    let best: HTMLElement | null = null
    let bestScore = 0
    for (const el of candidates) {
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase()
      const aria = (el.getAttribute('aria-label') || '').toLowerCase()
      const val = el instanceof HTMLInputElement ? el.value.toLowerCase() : ''
      const combined = `${text} ${aria} ${val}`
      if (!ctaPatterns.some((p) => combined.includes(p))) continue
      const st = window.getComputedStyle(el)
      if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) < 0.05) continue
      const r = el.getBoundingClientRect()
      if (r.width < 4 || r.height < 4) continue
      const inFooter = !!el.closest('footer, [class*="footer" i], [id*="footer" i]')
      const inHeaderOnly =
        !!el.closest('header, [class*="header" i], nav') &&
        !el.closest('main, [role="main"], [class*="product" i], [id*="Product" i]')
      const inProduct = !!(
        el.closest('form[action*="cart" i]') ||
        el.closest('[class*="product-form" i]') ||
        el.closest('[class*="product__" i]') ||
        el.closest('[class*="product-info" i]') ||
        el.closest('[class*="product-details" i]') ||
        el.closest('[data-product-form]') ||
        el.closest('[id*="product-form" i]') ||
        el.closest('[class*="purchase" i]') ||
        el.closest('[name="add"]') ||
        el.closest('[class*="shopify" i]')
      )
      let score = r.width * r.height + (inProduct ? 800000 : 0)
      if (inFooter) score *= 0.02
      if (inHeaderOnly && !inProduct) score *= 0.05
      if (score > bestScore) {
        bestScore = score
        best = el
      }
    }
    return best
  }

  function getProductMerchRoot(cta: HTMLElement): Element | null {
    return (
      cta.closest('main, [role="main"]') ||
      cta.closest('[class*="pip-product" i]') ||
      cta.closest('[class*="product-information" i]') ||
      cta.closest('[class*="product-details" i]') ||
      cta.closest('[id*="product" i]') ||
      cta.closest('article') ||
      null
    )
  }

  function isVisibleForPack(h: HTMLElement): boolean {
    const st = window.getComputedStyle(h)
    if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) < 0.05) return false
    const r = h.getBoundingClientRect()
    return r.width > 2 && r.height > 2
  }

  function imgPassesMinSize(img: HTMLImageElement): boolean {
    const ir = img.getBoundingClientRect()
    const laidOut = ir.width >= 16 && ir.height >= 16 && ir.width * ir.height >= 380
    const decoded =
      img.complete && (img.naturalWidth || 0) >= 40 && (img.naturalHeight || 0) >= 40
    return laidOut || decoded
  }

  function countGiftRowImagesNearCta(
    rootEl: Element | null,
    ctaEl: HTMLElement | null,
  ): { count: number; note: string } {
    if (!rootEl) return { count: 0, note: '' }
    const ctaRect = ctaEl?.getBoundingClientRect() || null
    let best = 0
    let bestNote = ''

    const giftHeadingText = (raw: string) => {
      const s = raw.toLowerCase().replace(/\s+/g, ' ')
      return (
        (/\bfree\s+gifts?\b/.test(s) &&
          /\b(with|your|worth|first|order|bonus|included|supply|kit|pack|!|,)\b/i.test(s)) ||
        /\bgifts?\s+with\s+your\s+first\s+order\b/i.test(s) ||
        /\bfree\s+gifts?\s+with\b/i.test(s)
      )
    }

    const hubs = Array.from(
      rootEl.querySelectorAll(
        'h2, h3, h4, h5, h6, strong, [class*="banner" i], [class*="heading" i], [class*="label" i], p',
      ),
    ) as HTMLElement[]
    for (const hub of hubs) {
      const raw = (hub.textContent || '').replace(/\s+/g, ' ').trim()
      if (raw.length > 280 || raw.length < 8) continue
      if (!giftHeadingText(raw)) continue

      const scope =
        (hub.closest(
          'section, article, [class*="plan" i], [class*="subscription" i], [class*="offer" i], [class*="bundle" i], [class*="grid" i]',
        ) as HTMLElement | null) ||
        (hub.closest('[class*="product__" i]') as HTMLElement | null) ||
        (hub.closest('[class*="product" i]') as HTMLElement | null) ||
        hub.parentElement
      if (!scope) continue

      const seenUrls = new Set<string>()
      let imgs = 0
      scope.querySelectorAll('img').forEach((imgEl) => {
        const img = imgEl as HTMLImageElement
        if (img.closest('header, footer, [class*="header" i], [class*="footer" i]')) return
        if (!isVisibleForPack(img)) return
        if (!imgPassesMinSize(img)) return
        const u = (img.currentSrc || img.src || '').split('?')[0]
        if (u) {
          if (seenUrls.has(u)) return
          seenUrls.add(u)
        }
        imgs++
      })

      if (imgs > best) {
        best = imgs
        bestNote = `"${raw.slice(0, 76)}" (${imgs} product images)`
      }
    }

    const classSelectors = [
      '[class*="free-gift" i]',
      '[class*="free_gift" i]',
      '[class*="gift-with" i]',
      '[class*="gift_row" i]',
      '[class*="gift-row" i]',
      '[class*="gift-grid" i]',
      '[class*="gift_grid" i]',
      '[class*="first-order" i]',
      '[class*="incentive" i]',
    ]
    for (const sel of classSelectors) {
      let boxes: HTMLElement[] = []
      try {
        boxes = Array.from(rootEl.querySelectorAll(sel)) as HTMLElement[]
      } catch {
        continue
      }
      for (const box of boxes) {
        if (!isVisibleForPack(box)) continue
        if (ctaRect) {
          const br = box.getBoundingClientRect()
          const xOverlap = Math.min(br.right, ctaRect.right) - Math.max(br.left, ctaRect.left)
          if (xOverlap < 12 && Math.abs(br.left - ctaRect.left) > 320) continue
        }
        const seenUrls = new Set<string>()
        let imgs = 0
        box.querySelectorAll('img').forEach((imgEl) => {
          const img = imgEl as HTMLImageElement
          if (img.closest('header, footer, nav')) return
          if (!isVisibleForPack(img)) return
          if (!imgPassesMinSize(img)) return
          const u = (img.currentSrc || img.src || '').split('?')[0]
          if (u) {
            if (seenUrls.has(u)) return
            seenUrls.add(u)
          }
          imgs++
        })
        if (imgs > best) {
          best = imgs
          bestNote = `${imgs} images in gift/pack row (${sel.trim()})`
        }
      }
    }

    return { count: best, note: bestNote }
  }

  const cta = findPrimaryPurchaseCta()
  const path = window.location.pathname.toLowerCase()
  const h1 = (document.querySelector('h1')?.textContent || '').toLowerCase()
  const docTitle = (document.title || '').toLowerCase()
  const pathTitle = `${path} ${h1} ${docTitle}`

  const bundleLikely =
    /starter-kit|starter kit|gift-set|sample-pack|value-pack|\/bundles\/|-bundle-|combo-pack|2-pack|3-pack|bogo|subscription-box/i.test(pathTitle) ||
    /\b(starter kit|gift set|value pack|bundle deal|kit includes|pack includes)\b/i.test(pathTitle) ||
    /\b(what'?s included|items included|everything you get|everything you need|need to get started)\b/i.test(
      h1 + docTitle,
    ) ||
    /\/[\w-]*-kit\b|\/[\w-]*-bundle\b|\/[\w-]*starter[\w-]*\b/i.test(path)

  const root = cta ? getProductMerchRoot(cta) : document.querySelector('main, [role="main"]')
  const zoneFull = root
    ? ((root as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim().toLowerCase()
    : (document.body.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase()

  const low = zoneFull
  const ctaParentText = cta?.parentElement
    ? (cta.parentElement.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase()
    : ''
  const ctaFormText = cta?.closest('form, [class*="product-form" i], [class*="product-info" i], [class*="product-details" i]')
    ? (
        (cta.closest('form, [class*="product-form" i], [class*="product-info" i], [class*="product-details" i]') as HTMLElement).innerText || ''
      ).replace(/\s+/g, ' ').trim().toLowerCase()
    : ''

  const buyAnchorTerms = [
    'add to bag',
    'add to basket',
    'add to cart',
    'buy it now',
    'buy now',
    'sold out',
    'out of stock',
    'add pack',
    'get it now',
  ]
  let buyIdx = -1
  for (const term of buyAnchorTerms) {
    const at = low.lastIndexOf(term)
    if (at > buyIdx) buyIdx = at
  }
  let fallbackIdx = -1
  const fallbackTerms = ['quantity', 'flavour', 'flavor']
  for (const term of fallbackTerms) {
    const at = low.indexOf(term)
    if (at >= 0 && (fallbackIdx < 0 || at < fallbackIdx)) fallbackIdx = at
  }
  const span = 5200
  const anchorIdx = buyIdx >= 0 ? buyIdx : fallbackIdx
  const bodyNearWindow =
    anchorIdx >= 0
      ? low.slice(Math.max(0, anchorIdx - span), Math.min(low.length, anchorIdx + span))
      : low.slice(0, 6200)
  const nearWindow = `${ctaFormText} ${ctaParentText} ${bodyNearWindow}`.trim()
  const zoneSlice = zoneFull.slice(0, 28000)
  const merchWideForBundle =
    /\b(free\s+gifts?|with\s+your\s+first\s+order|gifts?\s+worth|flexible\s+plan|month\s+supply|starter\s+kit|subscription|bonus\s+(items?|gifts?)|get started)\b/i.test(
      zoneSlice,
    )

  const textReinforcesBundle =
    /\b(free gifts?|what'?s included|starter kit|subscription|bonus|kit includes|pack includes|you'?re getting|everything you need|get started|your first order)\b/i.test(nearWindow) ||
    merchWideForBundle

  const bundleLikelyFromGiftsPlan =
    /\bfree\s+gifts?\b/i.test(zoneSlice) &&
    /\b(subscription|month\s+supply|flexible\s+plan|starter\s*kit|\d+\s*servings\b|trial|first\s+order)/i.test(
      `${path}\n${h1}\n${zoneSlice.slice(0, 5000)}`,
    )

  const bundleLikelyFinal =
    bundleLikely || (/\b(kit|bundle)\b/i.test(h1) && textReinforcesBundle) || bundleLikelyFromGiftsPlan

  const evidence: string[] = []
  let score = 0

  const freeItemCallouts = (
    nearWindow.match(/\bfree\s+(?:tin|whisk|scooper|mug|spoon|scoop|sample|samples)\b/gi) || []
  ).length

  const { count: visualGiftImgCount, note: visualGiftNote } = countGiftRowImagesNearCta(root, cta)
  if (visualGiftImgCount >= 3 && visualGiftNote) {
    score += 6
    evidence.push(`visual lineup: ${visualGiftNote}`)
  }

  if (freeItemCallouts >= 3 && bundleLikelyFinal && cta) {
    score += 5
    evidence.push(`${freeItemCallouts} labelled free item callouts (tin/whisk/mug/etc.)`)
  }

  if (
    /what'?s included|included items?|kit includes|pack includes|bundle includes|everything you get|everything you need|need to get started|get started|you'?re getting|in the box|what you get|contains|included with|in this kit|in this pack/i.test(
      nearWindow,
    )
  ) {
    score += 4
    evidence.push('explicit included / kit copy')
  }
  if (
    /free\s+gifts?\s*(with|worth|!|,|\b)|with\s+your\s+first\s+order|\bflexible\s+plan\b|\bmonth\s+supply\b|bonus|complimentary|free\s+sample|free accessories/i.test(
      nearWindow,
    ) ||
    merchWideForBundle
  ) {
    score += 2
    evidence.push('free gifts or bonus language')
  }

  let quantityPackSignals = (
    nearWindow.match(/\b\d+x\s*(?:bag|bags|item|items|pack|packs|sample|samples|servings?|accessories|gifts?)\b/gi) || []
  ).length
  if (/\b\d+x\b/i.test(nearWindow) && /\bsamples?\b/i.test(nearWindow)) {
    quantityPackSignals = Math.max(quantityPackSignals, 1)
  }
  if (quantityPackSignals >= 2) {
    score += 3
    evidence.push(`${quantityPackSignals} quantity pack line(s)`)
  } else if (quantityPackSignals === 1) {
    score += 1
    evidence.push('quantity pack line')
  }

  const money = (nearWindow.match(/(?:[$£€₹]|(?:\brs\.?\s*))\s*[\d.,]+/gi) || []).length
  if (money >= 4) {
    score += 3
    evidence.push(`${money} price lines in buy zone`)
  } else if (money >= 2) {
    score += 2
    evidence.push(`${money} price lines in buy zone`)
  }

  if ((nearWindow.match(/✅|•|✓/g) || []).length >= 2) {
    score += 1
    evidence.push('bullet or check list near buy')
  }

  if (
    /\b(and|\+)\s+free\b|\+\s*free gifts|\+\s*free accessories|gifts worth|worth\s*(?:[£$€₹]|rs\.?)\b/i.test(
      nearWindow,
    )
  ) {
    score += 1
    evidence.push('stacked value / gifts worth copy')
  }

  if (/starter kit bundle|starter kit\s*:/i.test(nearWindow)) {
    score += 2
    evidence.push('starter-kit bundle copy')
  }

  const explicitIncludedHeading =
    /what'?s included|kit includes|pack includes|bundle includes|in the box|what you get|contains|everything you need|need to get started|everything you get|you'?re getting/i.test(nearWindow) ||
    /\bfree\s+gifts?\s*(with|$|worth|!)/i.test(nearWindow) ||
    /\bwith\s+your\s+first\s+order\b/i.test(nearWindow) ||
    /\bgifts?\s+worth\b/i.test(nearWindow) ||
    /\bfree\s+gifts?\s+with\b/i.test(zoneSlice)

  const giftCopyInZone = /\bfree\s+gifts?\b/i.test(zoneSlice) || merchWideForBundle

  const visualGiftLineup =
    (visualGiftImgCount >= 3 && (giftCopyInZone || bundleLikelyFinal || merchWideForBundle)) ||
    (!!cta && visualGiftImgCount >= 2 && giftCopyInZone && bundleLikelyFinal)

  const labelledFreeBundlePass =
    bundleLikelyFinal &&
    (buyIdx >= 0 || /\b(add to (bag|cart)|buy now|quantity|flavou?r)\b/i.test(zoneSlice)) &&
    freeItemCallouts >= 3 &&
    /\bfree\s+gifts?\b/i.test(zoneSlice)

  const includedNearCta =
    score >= 5 ||
    (score >= 4 && money >= 2) ||
    (score >= 3 && /free\s+gifts?\s+with/i.test(nearWindow) && money >= 2) ||
    (explicitIncludedHeading && (money >= 1 || quantityPackSignals >= 1) && score >= 3) ||
    (bundleLikelyFinal &&
      buyIdx >= 0 &&
      explicitIncludedHeading &&
      (/free\s+gifts?|worth\s*(?:[£$€₹]|rs\.?)|sample|whisk|mug|spoon|accessories included|no extra cost/i.test(nearWindow) ||
        quantityPackSignals >= 1 ||
        money >= 2)) ||
    visualGiftLineup ||
    (visualGiftImgCount >= 4 && /\b(free|bonus|gift|included|kit|pack|starter)\b/i.test(zoneSlice)) ||
    labelledFreeBundlePass

  return {
    ctaFound: !!cta,
    bundleLikely: bundleLikelyFinal,
    includedNearCta,
    evidence,
  }
}
