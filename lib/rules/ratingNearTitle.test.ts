import { describe, expect, it } from 'vitest'
import {
  extractNearTitleRatingSignalsFromKeyElements,
  hasRatingScoreSignal,
  hasReviewCountSignal,
  isStrictNearTitleRatingPass,
} from './ratingNearTitle'

describe('ratingNearTitle strict logic', () => {
  it('passes only when score and review count are both near title', () => {
    const signals = extractNearTitleRatingSignalsFromKeyElements(`
--- PRODUCT RATING DOM CHECK ---
Rating found near title: YES
Rating score near title: YES
Review count near title: YES
`)
    expect(isStrictNearTitleRatingPass(signals)).toBe(true)
  })

  it('fails when score is present but review count is missing', () => {
    const signals = extractNearTitleRatingSignalsFromKeyElements(`
--- PRODUCT RATING DOM CHECK ---
Rating found near title: NO
Rating score near title: YES
Review count near title: NO
`)
    expect(isStrictNearTitleRatingPass(signals)).toBe(false)
  })

  it('detects score/count from text independently', () => {
    expect(hasRatingScoreSignal('Excellent 4.5 out of 5 ★★★★★')).toBe(true)
    expect(hasReviewCountSignal('Rated 4.6 / 5 based on 1123 reviews')).toBe(true)
    expect(hasReviewCountSignal('Excellent 4.5 out of 5')).toBe(false)
  })

  it('models SkinLovers fail scenario (count away from title)', () => {
    const nearTitleWindow = 'Caudalie Vinoperfect Brightening Dark Spot Serum 30ml Add to cart'
    const lowerSection = 'Rated 4.6 / 5 based on 1123 reviews'
    expect(hasRatingScoreSignal(nearTitleWindow)).toBe(false)
    expect(hasReviewCountSignal(nearTitleWindow)).toBe(false)
    expect(hasReviewCountSignal(lowerSection)).toBe(true)
  })
})
