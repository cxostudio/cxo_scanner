/**
 * Product page tabs / accordions for extra detail (KEY ELEMENTS tab scan from Puppeteer).
 */

import type { ScanRule, ScanResult } from '@/lib/scanner/types'

export function isProductTabsAccordionRule(rule: ScanRule): boolean {
  const t = rule.title.toLowerCase()
  const d = rule.description.toLowerCase()
  const hay = `${t} ${d}`
  if (hay.includes('lazy') && hay.includes('tab')) return false
  return (
    (hay.includes('tab') && (hay.includes('product') || hay.includes('clickable') || hay.includes('detail'))) ||
    (hay.includes('accordion') && (hay.includes('product') || hay.includes('detail') || hay.includes('easy'))) ||
    (hay.includes('clickable tabs') || hay.includes('tabs for')) ||
    (d.includes('accordion') && d.includes('product')) ||
    (hay.includes('easy access') && (hay.includes('detail') || hay.includes('product'))) ||
    (hay.includes('product page') && hay.includes('tab'))
  )
}

export function evaluateProductTabsAccordionRule(rule: ScanRule, keyElementsString: string): ScanResult | null {
  if (!keyElementsString.includes('Tab/Accordion Status:')) return null

  if (/Tab\/Accordion Status:\s*PASS/i.test(keyElementsString)) {
    const types =
      keyElementsString.match(/Tabs\/Accordions Found:\s*(.+?)(?:\n|$)/i)?.[1]?.trim() || 'tabs/accordions'
    return {
      ruleId: rule.id,
      ruleTitle: rule.title,
      passed: true,
      reason: `The page organizes extra product information using tabs, accordions, or equivalent controls (${types.slice(0, 120)}).`,
    }
  }

  if (/Tab\/Accordion Status:\s*FAIL/i.test(keyElementsString)) {
    return {
      ruleId: rule.id,
      ruleTitle: rule.title,
      passed: false,
      reason:
        'No clickable tabs, accordions, or similar section controls were detected for product details (Description, Ingredients, Reviews, etc.).',
    }
  }

  return null
}
