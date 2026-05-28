export type RatingNearTitleSignals = {
  scoreNearTitle: boolean
  reviewCountNearTitle: boolean
}

export function hasRatingScoreSignal(text: string): boolean {
  const t = text.toLowerCase()
  return (
    /\b[1-5](?:\.\d)?\s*(?:out of\s*5|\/\s*5|stars?)\b/i.test(t) ||
    /[★☆⭐✩✭]/.test(t)
  )
}

export function hasReviewCountSignal(text: string): boolean {
  return /\b\d[\d,.]*\s*(?:k)?\s+(?:reviews?|ratings?)\b/i.test(text)
}

export function isStrictNearTitleRatingPass(signals: RatingNearTitleSignals): boolean {
  return signals.scoreNearTitle && signals.reviewCountNearTitle
}

export function extractNearTitleRatingSignalsFromKeyElements(keyElements: string): RatingNearTitleSignals {
  const scoreLine = keyElements.match(/Rating score near title:\s*(YES|NO)/i)?.[1]?.toUpperCase() || null
  const countLine = keyElements.match(/Review count near title:\s*(YES|NO)/i)?.[1]?.toUpperCase() || null

  return {
    scoreNearTitle: scoreLine === 'YES',
    reviewCountNearTitle: countLine === 'YES',
  }
}
