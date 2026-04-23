/**
 * Deterministic "footer newsletter" rule:
 * pass when a real footer contains a visible email signup field + submit control.
 */

import type { Page } from 'puppeteer-core'
import type { ScanRule, ScanResult } from '@/lib/scanner/types'

export type FooterNewsletterSnapshot = {
  footerRootFound: boolean
  footerRootSelector: string | null
  hasVisibleEmailInputInFooter: boolean
  hasVisibleSubmitControlInFooter: boolean
  newsletterKeywordInFooter: boolean
  hasFormPairInFooter: boolean
  matchedSignals: string[]
}

export function emptyFooterNewsletterSnapshot(): FooterNewsletterSnapshot {
  return {
    footerRootFound: false,
    footerRootSelector: null,
    hasVisibleEmailInputInFooter: false,
    hasVisibleSubmitControlInFooter: false,
    newsletterKeywordInFooter: false,
    hasFormPairInFooter: false,
    matchedSignals: [],
  }
}

export function isFooterNewsletterRule(rule: ScanRule): boolean {
  const t = `${rule.title} ${rule.description}`.toLowerCase()
  const mentionsFooter = t.includes('footer')
  const mentionsNewsletterIntent =
    t.includes('newsletter') ||
    t.includes('subscribe') ||
    t.includes('subscription') ||
    t.includes('mailing list') ||
    t.includes('email signup') ||
    t.includes('email sign-up') ||
    t.includes('email capture')
  return mentionsFooter && mentionsNewsletterIntent
}

export function evaluateFooterNewsletterRule(
  rule: ScanRule,
  snap: FooterNewsletterSnapshot,
): ScanResult | null {
  if (!isFooterNewsletterRule(rule)) return null

  if (snap.hasFormPairInFooter) {
    const extra = snap.matchedSignals.length ? ` (${snap.matchedSignals.join(', ')})` : ''
    return {
      ruleId: rule.id,
      ruleTitle: rule.title,
      passed: true,
      reason: `A visible newsletter signup form is present in the footer (email input + submit control)${extra}.`,
    }
  }

  // Return null when evidence is weak so AI can still use screenshot/context.
  return null
}

/** Runs in browser context; avoid external closures. */
export async function collectFooterNewsletterSnapshot(page: Page): Promise<FooterNewsletterSnapshot> {
  return page.evaluate(() => {
    const isVisible = (el: Element | null): el is HTMLElement => {
      if (!(el instanceof HTMLElement)) return false
      const style = window.getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
      const r = el.getBoundingClientRect()
      return r.width >= 8 && r.height >= 8
    }

    const FOOTER_SELECTORS = [
      'footer',
      '[role="contentinfo"]',
      '#shopify-section-footer',
      '[data-section-type="footer"]',
      '.site-footer',
      '#site-footer',
    ]

    let footerRoot: HTMLElement | null = null
    let footerRootSelector: string | null = null

    for (const sel of FOOTER_SELECTORS) {
      try {
        const el = document.querySelector(sel)
        if (isVisible(el)) {
          footerRoot = el
          footerRootSelector = sel
          break
        }
      } catch {
        /* ignore selector issues */
      }
    }

    if (!footerRoot) {
      const docH = document.documentElement.scrollHeight
      const candidates = document.querySelectorAll('[class*="footer" i],[id*="footer" i]')
      let best: HTMLElement | null = null
      let bestScore = 0
      candidates.forEach((el) => {
        if (!(el instanceof HTMLElement)) return
        const r = el.getBoundingClientRect()
        const top = r.top + window.scrollY
        if (top < docH * 0.35) return
        if (!isVisible(el)) return
        const score = r.width * r.height
        if (score > bestScore) {
          best = el
          bestScore = score
        }
      })
      if (best) {
        footerRoot = best
        footerRootSelector = 'heuristic-footer-class-or-id'
      }
    }

    if (!footerRoot) {
      return {
        footerRootFound: false,
        footerRootSelector: null,
        hasVisibleEmailInputInFooter: false,
        hasVisibleSubmitControlInFooter: false,
        newsletterKeywordInFooter: false,
        hasFormPairInFooter: false,
        matchedSignals: [],
      }
    }

    const rootText = (footerRoot.textContent || '').toLowerCase()
    const newsletterKeywordInFooter =
      rootText.includes('newsletter') ||
      rootText.includes('subscribe') ||
      rootText.includes('subscription') ||
      rootText.includes('mailing list') ||
      rootText.includes('join our')

    const emailInputs = Array.from(
      footerRoot.querySelectorAll(
        'input[type="email"], input[name*="email" i], input[id*="email" i], input[placeholder*="email" i]',
      ),
    ).filter((el) => isVisible(el))

    const allButtons = Array.from(
      footerRoot.querySelectorAll('button, input[type="submit"], input[type="button"]'),
    ).filter((el) => isVisible(el))

    const submitLikeInRoot = allButtons.filter((el) => {
      const text = (el.textContent || '').toLowerCase().trim()
      const type = (el.getAttribute('type') || '').toLowerCase()
      const aria = (el.getAttribute('aria-label') || '').toLowerCase()
      return (
        type === 'submit' ||
        text.includes('subscribe') ||
        text.includes('sign up') ||
        text.includes('signup') ||
        text.includes('join') ||
        aria.includes('subscribe') ||
        aria.includes('submit')
      )
    })

    let hasFormPairInFooter = false
    for (const input of emailInputs) {
      const form = input.closest('form')
      if (!form) continue
      const submitInsideForm = form.querySelector(
        'button[type="submit"], input[type="submit"], button:not([type]), input[type="button"]',
      )
      if (isVisible(submitInsideForm)) {
        hasFormPairInFooter = true
        break
      }
    }

    const hasVisibleEmailInputInFooter = emailInputs.length > 0
    const hasVisibleSubmitControlInFooter = submitLikeInRoot.length > 0 || allButtons.length > 0
    if (!hasFormPairInFooter && hasVisibleEmailInputInFooter && hasVisibleSubmitControlInFooter) {
      // Fallback for custom forms where button isn't semantically linked.
      hasFormPairInFooter = true
    }

    const matchedSignals: string[] = []
    if (hasVisibleEmailInputInFooter) matchedSignals.push('email-input')
    if (hasVisibleSubmitControlInFooter) matchedSignals.push('submit-control')
    if (newsletterKeywordInFooter) matchedSignals.push('newsletter-copy')

    return {
      footerRootFound: true,
      footerRootSelector,
      hasVisibleEmailInputInFooter,
      hasVisibleSubmitControlInFooter,
      newsletterKeywordInFooter,
      hasFormPairInFooter,
      matchedSignals,
    }
  })
}
