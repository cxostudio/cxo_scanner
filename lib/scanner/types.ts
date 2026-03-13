/**
 * Types for the website rule scanner.
 * Used to freeze a consistent snapshot of the page for rule evaluation.
 */

export interface LazyLoadingResult {
  detected: boolean
  lazyLoadedCount: number
  totalMediaCount: number
  examples: string[]
  summary: string
}

export interface KeyElementsData {
  buttons: string
  headings: string
  breadcrumbs: string
  colorInfo: string[]
  tabsInfo: string[]
  lazyLoadingSummary: string
  fullKeyElementsString: string
}

export interface PageSnapshot {
  /** Visible text (body), trimmed for AI */
  visibleText: string
  /** Full visible text for heuristics */
  fullVisibleText: string
  /** Structured KEY ELEMENTS string for AI */
  keyElements: string
  /** Lazy loading detection result */
  lazyLoading: LazyLoadingResult
  /** Selected variant from DOM */
  selectedVariant: string | null
  /** Quantity/discount context */
  quantityDiscount: {
    foundPatterns: string[]
    tieredPricing: boolean
    percentDiscount: boolean
    priceDrop: boolean
    hasAnyDiscount: boolean
  }
  /** Shipping/delivery context near CTA */
  shippingTime: {
    ctaFound: boolean
    ctaText: string
    ctaVisibleWithoutScrolling: boolean
    shippingInfoNearCTA: string
    hasCountdown: boolean
    hasDeliveryDate: boolean
    shippingText: string
    allRequirementsMet: boolean
  } | null
  /** Trust badges near CTA */
  trustBadges: {
    ctaFound: boolean
    ctaText: string
    trustBadgesNearCTA: string[]
    trustBadgesCount: number
    within50px: boolean
    visibleWithoutScrolling: boolean
    trustBadgesInfo: string
  } | null
  /** CTA context string */
  ctaContext: string
  /** Sticky Add to Cart context across desktop and mobile */
  stickyCTA: {
    desktopSticky: boolean
    mobileSticky: boolean
    desktopEvidence: string
    mobileEvidence: string
    anySticky: boolean
  } | null
}

export interface ScanRule {
  id: string
  title: string
  description: string
}

export interface ScanResult {
  ruleId: string
  ruleTitle: string
  passed: boolean
  reason: string
}
