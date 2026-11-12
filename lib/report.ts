// How the results page turns raw checkpoint results into a report: areas, score, effort,
// and who gets offered a call. Checkpoint metadata comes from Airtable (Priority Level,
// Difficulty Level, Target Performance Metrics) via lib/conversionCheckpoints.

export type ScanResult = {
  ruleId: string
  ruleTitle: string
  passed: boolean
  reason: string
  /** engine v2: 'na' (not relevant, counts as passed) and 'unknown' (couldn't check, left out of the score) */
  status?: 'pass' | 'fail' | 'na' | 'unknown'
  /** Shopify does it by default: counted as passed, shown as one grouped line */
  coveredByShopify?: boolean
  /** shown in the free scan (Airtable "Free scan"); the others are counted and locked */
  freeScan?: boolean
  checkpoint?: {
    requiredActions: string
    justificationsBenefits: string
    examples: Array<{ url: string; filename: string; thumbnailUrl: string }>
    priority?: string
    difficulty?: string
    metrics?: string[]
  }
}

export type Lever = 'addtocart' | 'conversion' | 'order' | 'experience'

/** The four areas a product page is scored on, named after the number each one moves. */
export const LEVERS: { id: Lever; label: string; short: string; moves: string }[] = [
  { id: 'addtocart', label: 'Add to cart', short: 'Add to cart', moves: 'add-to-cart rate' },
  { id: 'conversion', label: 'Trust and conversion', short: 'Trust', moves: 'conversion rate' },
  { id: 'order', label: 'Order value', short: 'Order value', moves: 'average order value' },
  { id: 'experience', label: 'Navigation and experience', short: 'Navigation', moves: 'pages per session' },
]

const METRIC_TO_LEVER: Record<string, Lever> = {
  'Add-to-Cart Rate': 'addtocart',
  'Conversion Rate (CVR)': 'conversion',
  'Checkout Completion Rate': 'conversion',
  CTR: 'conversion',
  'Form Submission Rate': 'conversion',
  'Average Order Value (AOV)': 'order',
  'Page Views Per Session': 'experience',
  'Accessibility Score': 'experience',
  'Page Load Speed': 'experience',
  'Mobile Usability Score': 'experience',
  'SEO Rankings': 'experience',
}

/** A checkpoint's area: its first target metric that maps to one (AOV wins, it is the rarest lever). */
export function lever(r: ScanResult): Lever {
  const metrics = r.checkpoint?.metrics ?? []
  if (metrics.includes('Average Order Value (AOV)')) return 'order'
  for (const m of metrics) if (METRIC_TO_LEVER[m]) return METRIC_TO_LEVER[m]
  return 'addtocart'
}

/** 0-100. High-priority checks count double. */
export function scoreOf(results: ScanResult[]): number {
  let got = 0
  let max = 0
  for (const r of results) {
    const w = r.checkpoint?.priority === 'High' ? 2 : 1
    max += w
    if (r.passed) got += w
  }
  return max ? Math.round((got / max) * 100) : 0
}

export function effortLabel(r: ScanResult): string {
  switch (r.checkpoint?.difficulty) {
    case 'Easy':
      return 'Easy fix'
    case 'Moderate':
      return 'Some work'
    case 'Difficult':
      return 'Bigger project'
    default:
      return 'To fix'
  }
}

/**
 * Who is offered a CRO Audit call. Under €10k a month, a 10% conversion lift is worth
 * well under €1,000 a month, so the €2,490 audit would not pay for itself: those stores
 * get the checklist instead. Unknown revenue (a direct link) keeps the call.
 */
export const LOW_REVENUE = 'Under €10,000 / month'
export const isQualified = (revenueBand: string) => revenueBand !== LOW_REVENUE
