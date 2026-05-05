/**
 * Customer Media Detection
 * Detects customer video testimonials and customer photos directly from the DOM.
 * Covers: Shopify UGC, Loox, Yotpo, Stamped, Okendo, Junip, Judge.me,
 *         review section images, Instagram embeds, and generic patterns.
 */

export interface CustomerMediaResult {
  // Video Testimonials
  videoFound: boolean
  videoCount: number
  videoEvidence: string[]

  // Customer Photos
  photoFound: boolean
  photoCount: number
  photoEvidence: string[]

  summary: string
}

export async function detectCustomerMedia(
  page: import('puppeteer-core').Page
): Promise<CustomerMediaResult> {
  return page.evaluate(() => {
    const videoEvidence: string[] = []
    const photoEvidence: string[] = []

    // ─────────────────────────────────────────────────────────────
    // HELPER: check if an element is inside a review/testimonial section
    // ─────────────────────────────────────────────────────────────
    function isInsideReviewSection(el: Element): boolean {
      let cur: Element | null = el
      while (cur && cur !== document.body) {
        const cls = (cur.className && typeof cur.className === 'string' ? cur.className : '').toLowerCase()
        const id = (cur.id || '').toLowerCase()
        const tag = cur.tagName.toLowerCase()
        if (
          /review|testimonial|ugc|customer|rating|feedback|loox|yotpo|stamped|okendo|junip|jdgm|judge/i.test(cls + id)
        ) return true
        // Check text heading nearby
        if (tag === 'section' || tag === 'div') {
          const firstHeading = cur.querySelector('h1,h2,h3,h4')
          if (firstHeading) {
            const ht = (firstHeading.textContent || '').toLowerCase()
            if (/review|testimonial|customer|saying|fan|gram|photo|ugc/i.test(ht)) return true
          }
        }
        cur = cur.parentElement
      }
      return false
    }

    // ─────────────────────────────────────────────────────────────
    // VIDEO TESTIMONIAL DETECTION
    // ─────────────────────────────────────────────────────────────

    // 1. Explicit UGC video sections (Shopify themes)
    const ugcVideoEls = Array.from(document.querySelectorAll(
      '[class*="ugc-video"], [class*="ugc_video"], [class*="ugcvideo"], ' +
      '[class*="video-testimonial"], [class*="testimonial-video"], ' +
      '[class*="customer-video"], [class*="review-video"], ' +
      '[class*="video-review"], [class*="videoreview"]'
    )).filter(el => {
      const hasVideo = !!el.querySelector('video')
      const hasPlayBtn = !!el.querySelector('[aria-label*="play" i], [class*="play-button"], [class*="play_button"], [class*="play-icon"]')
      const isVideoEl = el.tagName.toLowerCase() === 'video'
      return hasVideo || hasPlayBtn || isVideoEl
    })
    if (ugcVideoEls.length > 0) {
      videoEvidence.push(`UGC video elements: ${ugcVideoEls.length} (classes: ${ugcVideoEls.slice(0,3).map(e => (e.className||'').toString().substring(0,40)).join(', ')})`)
    }

    // 1b. <video> with poster URL indicating UGC/preview (Spacegoods-style)
    const videosWithPreviewPoster = Array.from(document.querySelectorAll('video')).filter(v => {
      const poster = (v.getAttribute('poster') || '').toLowerCase()
      return poster.includes('preview_images') || poster.includes('thumbnail') || poster.includes('ugc')
    })
    if (videosWithPreviewPoster.length > 0) {
      videoEvidence.push(`UGC video posters (preview_images/thumbnail): ${videosWithPreviewPoster.length}`)
    }

    // 2. <video> tags inside review sections
    const allVideos = Array.from(document.querySelectorAll('video'))
    const reviewVideos = allVideos.filter(v => isInsideReviewSection(v))
    if (reviewVideos.length > 0) {
      videoEvidence.push(`<video> tags in review/testimonial sections: ${reviewVideos.length}`)
    }

    // 3. YouTube / Vimeo iframes inside review sections
    const allIframes = Array.from(document.querySelectorAll('iframe'))
    const videoIframes = allIframes.filter(f => {
      const src = (f.src || f.getAttribute('data-src') || '').toLowerCase()
      return /youtube|vimeo|loom|wistia/.test(src) && isInsideReviewSection(f)
    })
    if (videoIframes.length > 0) {
      videoEvidence.push(`Video iframes (YouTube/Vimeo) in review sections: ${videoIframes.length}`)
    }

    // 4. Shopify preview_images (video thumbnails from UGC videos)
    const previewImgs = Array.from(document.querySelectorAll('img')).filter(img =>
      (img.src || '').includes('preview_images') && (img.src || '').includes('thumbnail')
    )
    if (previewImgs.length > 0) {
      videoEvidence.push(`Shopify UGC video thumbnails (preview_images): ${previewImgs.length}`)
    }

    // 5. Play button elements inside review/testimonial containers
    const playButtons = Array.from(document.querySelectorAll(
      '[class*="play-button"], [class*="play_button"], [class*="playbutton"], ' +
      '[class*="video-play"], [class*="play-icon"], button[aria-label*="play" i], ' +
      '[class*="ugc-video-play"]'
    )).filter(el => isInsideReviewSection(el))
    if (playButtons.length > 0) {
      videoEvidence.push(`Play buttons inside review/testimonial sections: ${playButtons.length}`)
    }

    // 6. Loox video widget
    if (document.querySelector('[class*="loox"][class*="video"], [id*="loox"][class*="video"], loox-widget')) {
      videoEvidence.push('Loox video review widget detected')
    }

    // 7. Swiper/carousel containing video content — either inside review section OR sibling of "customers are saying" type heading
    const swiperInReview = Array.from(document.querySelectorAll('[class*="swiper"], [class*="carousel"], [class*="slider"]'))
      .filter(el => {
        const hasVideo = !!el.querySelector('video')
        const hasUgc = !!el.querySelector('[class*="ugc-video"], [class*="ugc_video"], [class*="video-testimonial"], [class*="review-video"]')
        const hasVideoIframe = Array.from(el.querySelectorAll('iframe')).some(f => {
          const src = (f.src || f.getAttribute('data-src') || '').toLowerCase()
          return /youtube|vimeo|loom|wistia/.test(src)
        })
        if (!hasVideo && !hasUgc && !hasVideoIframe) return false
        if (isInsideReviewSection(el)) return true
        // Spacegoods pattern: swiper and "What over X customers are saying" heading are siblings in same parent
        const parent = el.parentElement
        if (parent) {
          const siblings = Array.from(parent.children)
          const hasSiblingHeading = siblings.some(sib => {
            if (sib === el) return false
            const cls = (sib.className && typeof sib.className === 'string' ? sib.className : '').toLowerCase()
            const id = (sib.id || '').toLowerCase()
            const text = (sib.textContent || '').toLowerCase().substring(0, 120)
            return /ugc|review|testimonial|customer|saying/i.test(cls + id) ||
              (/customer|review|testimonial|saying|what over/i.test(text) && sib.children.length < 15)
          })
          if (hasSiblingHeading) return true
        }
        return false
      })
    if (swiperInReview.length > 0) {
      videoEvidence.push(`Video carousel/swiper in customer section: ${swiperInReview.length}`)
    }

    // 8. Text-based detection: "video" or "customers are saying" near review headings
    const allSectionHeadings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5'))
    const videoHeadings = allSectionHeadings.filter(h => {
      const t = (h.textContent || '').toLowerCase()
      return /video\s*(testimonial|review|customer|from customer)|customer\s*(video|review.*video)/i.test(t) ||
        /what over.*customers?\s+are\s+saying|customers?\s+are\s+saying/i.test(t)
    })
    if (videoHeadings.length > 0) {
      videoEvidence.push(`Video testimonial headings: "${videoHeadings.map(h => h.textContent?.trim()).join('", "')}"`)
    }

    // ─────────────────────────────────────────────────────────────
    // CUSTOMER PHOTO DETECTION
    // ─────────────────────────────────────────────────────────────

    // 1. Loox review photos
    const looxPhotos = document.querySelectorAll('[class*="loox"] img, [id*="loox"] img')
    if (looxPhotos.length > 0) {
      photoEvidence.push(`Loox review photos: ${looxPhotos.length}`)
    }

    // 2. Yotpo customer photos
    const yotpoPhotos = document.querySelectorAll('[class*="yotpo"] img, [id*="yotpo"] img')
    if (yotpoPhotos.length > 0) {
      photoEvidence.push(`Yotpo review photos: ${yotpoPhotos.length}`)
    }

    // 3. Stamped.io photos
    const stampedPhotos = document.querySelectorAll('[class*="stamped"] img, [id*="stamped"] img')
    if (stampedPhotos.length > 0) {
      photoEvidence.push(`Stamped.io review photos: ${stampedPhotos.length}`)
    }

    // 4. Okendo photos
    const okendoPhotos = document.querySelectorAll('[class*="okendo"] img, [id*="okendo"] img')
    if (okendoPhotos.length > 0) {
      photoEvidence.push(`Okendo review photos: ${okendoPhotos.length}`)
    }

    // 5. Judge.me photos
    const judgePhotos = document.querySelectorAll('[class*="jdgm"] img, [id*="jdgm"] img')
    if (judgePhotos.length > 0) {
      photoEvidence.push(`Judge.me review photos: ${judgePhotos.length}`)
    }

    // 6. Shopify preview_images used as customer photo thumbnails
    const shopifyCustomerPhotos = Array.from(document.querySelectorAll('img')).filter(img =>
      (img.src || '').includes('preview_images')
    )
    if (shopifyCustomerPhotos.length > 0) {
      photoEvidence.push(`Shopify customer media thumbnails (preview_images): ${shopifyCustomerPhotos.length}`)
    }

    // 7. Images inside review/testimonial/UGC sections (>40px to exclude icons)
    // Excludes: star/rating images, product images, decorative icons
    const allImgs = Array.from(document.querySelectorAll('img'))
    const reviewSectionImgs = allImgs.filter(img => {
      const w = img.naturalWidth || img.width || 0
      const h = img.naturalHeight || img.height || 0
      const rect = img.getBoundingClientRect()
      const size = Math.max(w, h, rect.width, rect.height)
      if (size < 40) return false
      if (!isInsideReviewSection(img)) return false
      // Exclude star/rating icons, product thumbnails, and decorative images
      const src = (img.src || img.getAttribute('data-src') || '').toLowerCase()
      const alt = (img.alt || '').toLowerCase()
      const cls = (img.className && typeof img.className === 'string' ? img.className : '').toLowerCase()
      // Exclude SVG files — they are always icons/graphics, never customer photos
      if (src.endsWith('.svg') || src.includes('.svg?')) return false
      if (/star|rating|icon|logo|arrow|badge|check|tick|verified|sprite|banner|hero|product[-_]image|main[-_]image/i.test(src + alt + cls)) return false
      // Exclude images that are clearly product images (very large, in product gallery)
      const parentCls = (img.closest('[class*="product-image"], [class*="product_image"], [class*="gallery"], [class*="main-image"]') ? 'gallery' : '')
      if (parentCls === 'gallery') return false
      // Must look like a customer-uploaded photo: squarish and reasonably sized
      const aspect = Math.max(w, rect.width) / Math.max(1, Math.max(h, rect.height))
      const isSquarish = aspect >= 0.5 && aspect <= 2.0
      return isSquarish
    })
    if (reviewSectionImgs.length > 0) {
      photoEvidence.push(`Images inside review/testimonial sections: ${reviewSectionImgs.length}`)
    }

    // 8. Customer photo gallery sections (selfie-style galleries)
    const customerGallerySections = document.querySelectorAll(
      '[class*="customer-photo"], [class*="customer_photo"], ' +
      '[class*="customer-gallery"], [class*="customer_gallery"], ' +
      '[class*="biggest-fans"], [class*="biggest_fans"], ' +
      '[class*="fan-gallery"], [class*="photo-wall"]'
    )
    if (customerGallerySections.length > 0) {
      const imgs = Array.from(customerGallerySections).reduce((acc, sec) => acc + sec.querySelectorAll('img').length, 0)
      if (imgs > 0) {
        photoEvidence.push(`Customer photo gallery sections: ${customerGallerySections.length} sections, ${imgs} images`)
      }
    }

    // 9. Instagram profile pictures (review embeds)
    const instagramProfilePics = document.querySelectorAll('img.profile-picture, img[alt*="Instagram profile" i], img[alt*="profile picture" i]')
    if (instagramProfilePics.length > 0) {
      photoEvidence.push(`Instagram/review profile pictures: ${instagramProfilePics.length}`)
    }

    // 10. Sections with customer headings containing images
    const customerHeadings = Array.from(document.querySelectorAll('h1,h2,h3,h4')).filter(h => {
      const t = (h.textContent || '').toLowerCase()
      return /customers?\s*(are\s*saying|photos?|picture|gallery|fan|love|review)|on\s+the\s+gram|biggest\s+fan|real\s+customer/i.test(t)
    })
    for (const heading of customerHeadings) {
      const section = heading.closest('section, [class*="section"], [class*="block"]') || heading.parentElement
      if (section) {
        const imgs = section.querySelectorAll('img')
        const validImgs = Array.from(imgs).filter(img => {
          const rect = img.getBoundingClientRect()
          return Math.max(rect.width, rect.height) >= 60
        })
        if (validImgs.length > 0) {
          photoEvidence.push(`"${heading.textContent?.trim()}" section: ${validImgs.length} customer images`)
        }
      }
    }

    // 10b. "Reviews with images" / "5 star reviews" blocks (common in third-party widgets)
    // Some widgets do not expose review-specific classes but do expose strong headings + image rows.
    const imageReviewHeadings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,div,span,p'))
      .filter(el => {
        const t = (el.textContent || '').toLowerCase().replace(/\s+/g, ' ').trim()
        if (!t || t.length > 120) return false
        return (
          /reviews?\s+with\s+images?/.test(t) ||
          /thousands?\s+of\s+5\s*star\s+reviews?/.test(t) ||
          /5\s*star\s+reviews?/.test(t)
        )
      })
      .slice(0, 20)
    for (const heading of imageReviewHeadings) {
      const container =
        heading.closest('section, [class*="section"], [class*="block"], [class*="review"], [class*="widget"]') ||
        heading.parentElement
      if (!container) continue
      const imgs = Array.from(container.querySelectorAll('img')).filter(img => {
        const rect = img.getBoundingClientRect()
        const w = (img as HTMLImageElement).naturalWidth || rect.width
        const h = (img as HTMLImageElement).naturalHeight || rect.height
        return Math.max(w, h, rect.width, rect.height) >= 56
      })
      if (imgs.length >= 4) {
        const hText = (heading.textContent || '').trim().substring(0, 60)
        photoEvidence.push(`"${hText}" section shows customer image thumbnails: ${imgs.length}`)
      }
    }

    // 11. Trusted Shops widget (common European review platform)
    const trustedShopsEls = document.querySelectorAll(
      '[class*="trusted-shops"], [class*="trustedshops"], [id*="trusted-shops"], [id*="trustedshops"], ' +
      'ts-widget, ts-reviews, [data-trustbadge], [class*="ts-widget"], [class*="ts-review"]'
    )
    if (trustedShopsEls.length > 0) {
      photoEvidence.push(`Trusted Shops review widget detected: ${trustedShopsEls.length} element(s)`)
    }

    // 12. Generic verified review section: 3+ review cards with star ratings + reviewer names
    // Detects custom review implementations (not covered by named platforms)
    const verifiedBadges = Array.from(document.querySelectorAll(
      '[class*="verified"], [aria-label*="verified" i], [title*="verified" i], ' +
      '[class*="review-card"], [class*="review_card"], [class*="reviewcard"]'
    ))
    const reviewCardsWithNames = Array.from(document.querySelectorAll(
      '[class*="review"], [class*="testimonial"]'
    )).filter(el => {
      const text = (el.textContent || '').trim()
      // Must have some text content (review body) and be reasonably sized
      return text.length > 30 && el.querySelectorAll('*').length > 2
    })
    if (verifiedBadges.length >= 2 || reviewCardsWithNames.length >= 3) {
      const count = Math.max(verifiedBadges.length, reviewCardsWithNames.length)
      photoEvidence.push(`Verified customer review section: ${count} verified review cards detected`)
    }

    // 13. "Rated X.X / 5 based on N reviews" — strong signal of substantial customer reviews
    const bodyText = (document.body.innerText || '').toLowerCase()
    const ratedMatch = bodyText.match(/rated\s+[\d.]+\s*\/\s*5\s+based\s+on\s+([\d,]+)\s+reviews?/i)
    if (ratedMatch) {
      const reviewCount = parseInt((ratedMatch[1] || '0').replace(/,/g, ''), 10)
      if (reviewCount >= 5) {
        photoEvidence.push(`Verified reviews aggregate: "${ratedMatch[0].trim()}" (${reviewCount} customer reviews)`)
      }
    }
    // Also match "X reviews" or "X+ reviews" near a rating pattern
    const reviewCountMatch = bodyText.match(/(\d[\d,]*)\s*(?:verified\s+)?(?:customer\s+)?reviews?\b/)
    if (reviewCountMatch && !ratedMatch) {
      const count = parseInt((reviewCountMatch[1] || '0').replace(/,/g, ''), 10)
      if (count >= 10) {
        photoEvidence.push(`Customer review count detected: ${count} reviews`)
      }
    }

    // 14. Gallery images: lifestyle / in-use / contextual shots (alt, URL, parent class; Shopify 2.0 friendly)
    function collectProductGalleryImages(): HTMLImageElement[] {
      const seen = new Set<string>()
      const out: HTMLImageElement[] = []
      const add = (img: HTMLImageElement) => {
        if (isInsideReviewSection(img)) return
        const raw = (img.currentSrc || img.getAttribute('src') || '').trim()
        if (!raw || raw.startsWith('data:')) return
        try {
          const key = new URL(raw, window.location.href).pathname.split('?')[0] || raw
          if (seen.has(key)) return
          seen.add(key)
          out.push(img)
        } catch {
          if (!seen.has(raw)) {
            seen.add(raw)
            out.push(img)
          }
        }
      }
      const rootSelectors = [
        '[class*="product__media" i]',
        '[class*="product-media" i]',
        '[class*="product_gallery" i]',
        '[class*="product-gallery" i]',
        '[data-media-gallery]',
        '[id*="MediaGallery" i]',
        '[class*="media-gallery" i]',
        '[class*="product__column" i]',
        'main [class*="slideshow" i]',
        'main [class*="swiper" i]',
      ].join(', ')
      try {
        document.querySelectorAll(rootSelectors).forEach((root) => {
          if (!(root instanceof HTMLElement)) return
          if (isInsideReviewSection(root)) return
          root.querySelectorAll('img').forEach((n) => {
            if (n instanceof HTMLImageElement) add(n)
          })
        })
      } catch {
        /* invalid selector in edge engines */
      }
      if (out.length < 2) {
        document.querySelectorAll('[data-media-id] img, [class*="carousel" i] img').forEach((n) => {
          if (n instanceof HTMLImageElement) add(n)
        })
      }
      return out
    }

    const galleryImgs = collectProductGalleryImages()
    const lifestyleCombinedRe =
      /\b(model|lifestyle|in-use|in_use|usage|ugc|result|texture|before|after|skin|face|person|people|woman|man|hands?|holding|pour|pouring|blend|mixing|mix|drink|drinking|sip|mug|cup|glass|kitchen|table|desk|morning|evening|routine|daily|moment|prepare|preparing|enjoy|enjoying|scene|context|real\s*life|day\s*in|how-to|how_to|serving|wearing|apply|applying|using|showing|demonstrat)\b/i

    const lifestyleGalleryImgs = galleryImgs.filter((img) => {
      const alt = (img.alt || '').toLowerCase()
      const src = (img.src || img.currentSrc || '').toLowerCase()
      let parentCls = ''
      let p: Element | null = img.parentElement
      for (let depth = 0; p && depth < 4; depth += 1) {
        const c = (p as HTMLElement).className
        parentCls += ` ${typeof c === 'string' ? c : ''}`
        p = p.parentElement
      }
      parentCls = parentCls.toLowerCase()
      if (lifestyleCombinedRe.test(`${alt} ${src} ${parentCls}`)) return true
      if (/\b(lifestyle|in_use|in-use|ugc|usage|scene|pour|pouring|holding|hands|model|context|routine|morning|kitchen)\b/i.test(src))
        return true
      return false
    })
    if (lifestyleGalleryImgs.length > 0) {
      const alts = lifestyleGalleryImgs
        .slice(0, 3)
        .map((i) => (i.alt || '').trim() || '(no alt)')
        .join('", "')
      photoEvidence.push(`Lifestyle/model/results images in product gallery: ${lifestyleGalleryImgs.length} (e.g. "${alts}")`)
    }

    // ─────────────────────────────────────────────────────────────
    // BUILD RESULT
    // ─────────────────────────────────────────────────────────────
    // IMPORTANT: only concrete media evidence can mark video testimonials as found.
    // Text headings alone (e.g. "customers are saying") must not auto-pass.
    const hasLooxVideoWidget = !!document.querySelector(
      '[class*="loox"][class*="video"], [id*="loox"][class*="video"], loox-widget',
    )
    const videoFound =
      ugcVideoEls.length > 0 ||
      videosWithPreviewPoster.length > 0 ||
      reviewVideos.length > 0 ||
      videoIframes.length > 0 ||
      previewImgs.length > 0 ||
      playButtons.length > 0 ||
      hasLooxVideoWidget ||
      swiperInReview.length > 0
    const photoFound = photoEvidence.length > 0

    const videoCount =
      ugcVideoEls.length +
      videosWithPreviewPoster.length +
      reviewVideos.length +
      videoIframes.length +
      previewImgs.length +
      playButtons.length +
      swiperInReview.length
    const photoCount = looxPhotos.length + yotpoPhotos.length + stampedPhotos.length +
      okendoPhotos.length + judgePhotos.length + shopifyCustomerPhotos.length + reviewSectionImgs.length +
      trustedShopsEls.length + lifestyleGalleryImgs.length +
      (verifiedBadges.length >= 2 ? verifiedBadges.length : 0) +
      (reviewCardsWithNames.length >= 3 ? reviewCardsWithNames.length : 0)

    const summaryLines = [
      `--- CUSTOMER VIDEO TESTIMONIALS ---`,
      `Detected: ${videoFound ? 'YES' : 'NO'}`,
      `Count: ${videoCount}`,
      videoEvidence.length > 0 ? `Evidence: ${videoEvidence.join(' | ')}` : 'Evidence: none',
      ``,
      `--- CUSTOMER PHOTOS ---`,
      `Detected: ${photoFound ? 'YES' : 'NO'}`,
      `Count: ${photoCount}`,
      photoEvidence.length > 0 ? `Evidence: ${photoEvidence.join(' | ')}` : 'Evidence: none',
    ]

    return {
      videoFound,
      videoCount,
      videoEvidence,
      photoFound,
      photoCount,
      photoEvidence,
      summary: summaryLines.join('\n'),
    }
  })
}
