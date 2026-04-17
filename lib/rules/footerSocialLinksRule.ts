/**
 * Deterministic "footer social links" rule: scan the real footer DOM (and a
 * bottom-of-page link band) so storefronts like Shopify pass when icons sit in
 * #shopify-section-footer / contentinfo, even if KEY ELEMENTS truncates links.
 */

import type { Page } from 'puppeteer-core'
import type { ScanRule, ScanResult } from '@/lib/scanner/types'

export type FooterSocialSnapshot = {
  footerRootFound: boolean
  footerRootSelector: string | null
  socialHostsInFooterRoot: string[]
  socialHostsInLowerBand: string[]
}

export function emptyFooterSocialSnapshot(): FooterSocialSnapshot {
  return {
    footerRootFound: false,
    footerRootSelector: null,
    socialHostsInFooterRoot: [],
    socialHostsInLowerBand: [],
  }
}

export function isFooterSocialLinksRule(rule: ScanRule): boolean {
  if (rule.id === 'recXqQmYLbyuIil2a') return true
  const t = `${rule.title} ${rule.description}`.toLowerCase()
  return (
    (t.includes('footer') && (t.includes('social') || t.includes('instagram') || t.includes('facebook'))) ||
    (t.includes('social') && t.includes('media') && t.includes('link'))
  )
}

export function evaluateFooterSocialLinksRule(
  rule: ScanRule,
  snap: FooterSocialSnapshot,
): ScanResult | null {
  if (!isFooterSocialLinksRule(rule)) return null

  const root = [...new Set(snap.socialHostsInFooterRoot)]
  const band = [...new Set(snap.socialHostsInLowerBand)]
  const combined = [...new Set([...root, ...band])]

  if (combined.length > 0) {
    const where =
      root.length > 0
        ? 'the footer'
        : 'the bottom section of the page (footer area)'
    const list = combined.slice(0, 6).join(', ')
    return {
      ruleId: rule.id,
      ruleTitle: rule.title,
      passed: true,
      reason: `Social profile links are present in ${where} (${list}).`,
    }
  }

  if (snap.footerRootFound) {
    return {
      ruleId: rule.id,
      ruleTitle: rule.title,
      passed: false,
      reason:
        'A footer section was found, but there are no clear links to major social profiles (Instagram, Facebook, X/Twitter, TikTok, LinkedIn, YouTube, etc.) in that area.',
    }
  }

  return null
}

/** Runs in the browser — keep self-contained (no outer closures). */
export async function collectFooterSocialSnapshot(page: Page): Promise<FooterSocialSnapshot> {
  return page.evaluate(() => {
    function classifySocial(href: string): string | null {
      const h = href.trim().toLowerCase()
      if (!h || h.startsWith('mailto:') || h.startsWith('tel:') || h.startsWith('javascript:')) {
        return null
      }
      if (/instagram\.com|instagr\.am/i.test(h)) return 'Instagram'
      if (/facebook\.com|fb\.com|fb\.me/i.test(h)) return 'Facebook'
      if (/twitter\.com|^https?:\/\/(www\.)?x\.com\//i.test(h)) return 'X/Twitter'
      if (/linkedin\.com/i.test(h)) return 'LinkedIn'
      if (/tiktok\.com/i.test(h)) return 'TikTok'
      if (/pinterest\.com|pin\.it/i.test(h)) return 'Pinterest'
      if (/youtube\.com|youtu\.be/i.test(h)) return 'YouTube'
      if (/threads\.net/i.test(h)) return 'Threads'
      if (/snapchat\.com/i.test(h)) return 'Snapchat'
      if (/t\.me\//i.test(h)) return 'Telegram'
      if (/wa\.me|api\.whatsapp\.com|whatsapp\.com/i.test(h)) return 'WhatsApp'
      return null
    }

    function hostsFromRoot(root: Element | null): string[] {
      const hosts = new Set<string>()
      if (!root) return []
      root.querySelectorAll('a[href]').forEach((a) => {
        const href = a.getAttribute('href') || ''
        const c = classifySocial(href)
        if (c) hosts.add(c)
      })
      return Array.from(hosts)
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
        if (el instanceof HTMLElement) {
          const r = el.getBoundingClientRect()
          if (r.height >= 24 && r.width >= 50) {
            footerRoot = el
            footerRootSelector = sel
            break
          }
        }
      } catch {
        /* invalid selector */
      }
    }

    if (!footerRoot) {
      const candidates = document.querySelectorAll('[class*="footer" i],[id*="footer" i]')
      let best: HTMLElement | null = null
      let bestScore = 0
      const docH = document.documentElement.scrollHeight
      candidates.forEach((el) => {
        if (!(el instanceof HTMLElement)) return
        const r = el.getBoundingClientRect()
        const top = r.top + window.scrollY
        if (top < docH * 0.35) return
        const score = r.height * r.width
        if (score > bestScore && r.height > 40 && r.width > 80) {
          bestScore = score
          best = el
        }
      })
      if (best) {
        footerRoot = best
        footerRootSelector = 'heuristic-footer-class-or-id'
      }
    }

    const socialHostsInFooterRoot = hostsFromRoot(footerRoot)

    const docH = document.documentElement.scrollHeight
    const yCut = docH * 0.68
    const bandHosts = new Set<string>()
    document.querySelectorAll('a[href]').forEach((a) => {
      if (!(a instanceof HTMLElement)) return
      const r = a.getBoundingClientRect()
      const centerY = r.top + window.scrollY + r.height / 2
      if (centerY < yCut) return
      const href = a.getAttribute('href') || ''
      const c = classifySocial(href)
      if (c) bandHosts.add(c)
    })

    return {
      footerRootFound: !!footerRoot,
      footerRootSelector,
      socialHostsInFooterRoot,
      socialHostsInLowerBand: Array.from(bandHosts),
    }
  })
}
