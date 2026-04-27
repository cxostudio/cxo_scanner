/**
 * Deterministic "footer customer support" rule:
 * pass when the footer (or typical floating chat launcher) shows clear support paths.
 */

import type { Page } from 'puppeteer-core'
import type { ScanRule, ScanResult } from '@/lib/scanner/types'

export type FooterCustomerSupportSnapshot = {
  footerRootFound: boolean
  footerRootSelector: string | null
  /** Distinct kind keys gathered from footer links / copy, e.g. help-center, contact */
  kinds: string[]
  matchedLabels: string[]
  hasFloatingChatLauncher: boolean
}

export function emptyFooterCustomerSupportSnapshot(): FooterCustomerSupportSnapshot {
  return {
    footerRootFound: false,
    footerRootSelector: null,
    kinds: [],
    matchedLabels: [],
    hasFloatingChatLauncher: false,
  }
}

export function isFooterCustomerSupportRule(rule: ScanRule): boolean {
  const t = `${rule.title} ${rule.description}`.toLowerCase()
  if (!t.includes('footer')) return false
  return (
    t.includes('customer support') ||
    t.includes('support option') ||
    t.includes('help center') ||
    t.includes('live chat') ||
    (t.includes('support') && (t.includes('link') || t.includes('chat') || t.includes('help')))
  )
}

function passesFromSnapshot(snap: FooterCustomerSupportSnapshot): boolean {
  const k = new Set(snap.kinds)
  const strong =
    k.has('help-center') ||
    k.has('contact') ||
    k.has('faq') ||
    k.has('live-chat') ||
    k.has('customer-care')
  if (strong) return true
  if (snap.hasFloatingChatLauncher && k.size >= 1) return true
  if (snap.hasFloatingChatLauncher && snap.footerRootFound) return true
  const medium = ['shipping', 'returns', 'subscription-help', 'review-help', 'support-link']
  let mediumHits = 0
  for (const m of medium) {
    if (k.has(m)) mediumHits += 1
  }
  if (mediumHits >= 2) return true
  return false
}

export function evaluateFooterCustomerSupportRule(
  rule: ScanRule,
  snap: FooterCustomerSupportSnapshot,
): ScanResult | null {
  if (!isFooterCustomerSupportRule(rule)) return null

  if (passesFromSnapshot(snap)) {
    const bits = [...new Set([...snap.matchedLabels.slice(0, 5), ...(snap.hasFloatingChatLauncher ? ['floating chat'] : [])])].filter(Boolean)
    const detail = bits.length ? ` (${bits.join(', ')})` : ''
    return {
      ruleId: rule.id,
      ruleTitle: rule.title,
      passed: true,
      reason: `Customer support paths are present in the footer area${detail}.`,
    }
  }

  return null
}

/** Runs in browser context; avoid external closures. */
export async function collectFooterCustomerSupportSnapshot(page: Page): Promise<FooterCustomerSupportSnapshot> {
  return page.evaluate(() => {
    const isRenderable = (el: Element | null): el is HTMLElement => {
      if (!(el instanceof HTMLElement)) return false
      const style = window.getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') return false
      const r = el.getBoundingClientRect()
      return r.width >= 8 && r.height >= 8
    }

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
        if (isRenderable(el)) {
          footerRoot = el
          footerRootSelector = sel
          break
        }
      } catch {
        /* ignore */
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
        if (!isRenderable(el)) return
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

    const kinds = new Set<string>()
    const matchedLabels: string[] = []

    const pushKind = (kind: string, label: string) => {
      if (kinds.has(kind)) return
      kinds.add(kind)
      const t = label.replace(/\s+/g, ' ').trim()
      if (t && matchedLabels.length < 12) matchedLabels.push(t.slice(0, 80))
    }

    const classify = (label: string, href: string): string | null => {
      const l = label.replace(/\s+/g, ' ').trim().toLowerCase()
      const h = href.trim().toLowerCase()
      if (/\bhelp\s*center\b|helpcentre|\/help\b|help-center|pages\/help/i.test(l) || /\/help|help-center|help_center|zendesk|intercom|freshdesk/i.test(h)) {
        return 'help-center'
      }
      if (/\bcontact(\s+us)?\b|^contact$/i.test(l) || /\/contact|pages\/contact|mailto:/i.test(h)) {
        return 'contact'
      }
      if (/\bfaqs?\b|\bquestions\b/i.test(l) || /\/faq|\/faqs/i.test(h)) {
        return 'faq'
      }
      if (/\blive\s*chat\b|\bchat\s+with\b|\bonline\s*chat\b/i.test(l) || /\/chat\b|livechat|live-chat/i.test(h)) {
        return 'live-chat'
      }
      if (/\bcustomer\s*(service|support|care)\b/i.test(l)) {
        return 'customer-care'
      }
      if (/\bshipping\b/i.test(l) || /\/policies\/shipping|\/shipping/i.test(h)) {
        return 'shipping'
      }
      if (/\breturns?\b|\brefunds?\b/i.test(l) || /\/policies\/refund|\/returns/i.test(h)) {
        return 'returns'
      }
      if (/\bmanage\s+subscription\b/i.test(l) || (/\bmanage\b/i.test(l) && /\bsubscription\b/i.test(l))) {
        return 'subscription-help'
      }
      if (/\bsubmit\s+review\b|\bwrite\s+a\s+review\b/i.test(l)) {
        return 'review-help'
      }
      if (l === 'support' || /\bsupport\s+home\b/i.test(l)) {
        return 'support-link'
      }
      return null
    }

    if (footerRoot) {
      footerRoot.querySelectorAll('a[href]').forEach((a) => {
        if (!(a instanceof HTMLAnchorElement)) return
        if (!isRenderable(a)) return
        const label = (a.innerText || a.textContent || '').trim()
        const href = a.getAttribute('href') || ''
        const kind = classify(label, href)
        if (kind) pushKind(kind, label || href)
      })
    }

    let hasFloatingChatLauncher = false
    const vw = window.innerWidth
    const vh = window.innerHeight
    const selectors = [
      '[class*="intercom" i]',
      '[id*="intercom" i]',
      '[class*="zendesk" i]',
      '[class*="drift" i]',
      '[class*="tidio" i]',
      '[class*="crisp" i]',
      '[class*="gorgias" i]',
      '[data-testid*="chat" i]',
      '[aria-label*="chat" i]',
      '[aria-label*="message" i]',
    ]
    for (const sel of selectors) {
      try {
        document.querySelectorAll(sel).forEach((el) => {
          if (!(el instanceof HTMLElement)) return
          if (!isVisible(el)) return
          const r = el.getBoundingClientRect()
          if (r.top > vh * 0.45 && r.left > vw * 0.55) hasFloatingChatLauncher = true
        })
      } catch {
        /* ignore */
      }
    }
    if (!hasFloatingChatLauncher) {
      document.querySelectorAll('button, a[role="button"], [role="button"]').forEach((el) => {
        if (!(el instanceof HTMLElement)) return
        if (!isVisible(el)) return
        const r = el.getBoundingClientRect()
        if (r.top <= vh * 0.45 || r.left <= vw * 0.55) return
        if (r.width < 24 || r.height < 24 || r.width > 140 || r.height > 140) return
        const blob =
          `${el.getAttribute('aria-label') || ''} ${el.className || ''} ${el.id || ''} ${el.title || ''}`.toLowerCase()
        if (
          /\bchat\b|\bmessaging\b|open\s+chat|messenger|message\s+us|need\s+help|intercom|zendesk|tidio|drift|crisp|gorgias|shopify.*inbox|inbox|customer\s+chat/i.test(
            blob,
          )
        ) {
          hasFloatingChatLauncher = true
        }
      })
    }

    return {
      footerRootFound: !!footerRoot,
      footerRootSelector,
      kinds: Array.from(kinds),
      matchedLabels,
      hasFloatingChatLauncher,
    }
  })
}
