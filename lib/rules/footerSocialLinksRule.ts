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
    function classifySocialFromSignals(signals: string): string | null {
      const s = signals.toLowerCase()
      if (!s || s.startsWith('mailto:') || s.startsWith('tel:') || s.startsWith('javascript:')) return null
      if (/instagram\.com|instagr\.am|(?:^|[\/\-_?=&\s])instagram(?:$|[\/\-_?=&\s])/i.test(s)) return 'Instagram'
      if (/facebook\.com|fb\.com|fb\.me|(?:^|[\/\-_?=&\s])facebook(?:$|[\/\-_?=&\s])/i.test(s)) return 'Facebook'
      if (/twitter\.com|^https?:\/\/(www\.)?x\.com\/|(?:^|[\/\-_?=&\s])twitter(?:$|[\/\-_?=&\s])/i.test(s)) return 'X/Twitter'
      if (/linkedin\.com|(?:^|[\/\-_?=&\s])linkedin(?:$|[\/\-_?=&\s])/i.test(s)) return 'LinkedIn'
      if (/tiktok\.com|(?:^|[\/\-_?=&\s])tiktok(?:$|[\/\-_?=&\s])/i.test(s)) return 'TikTok'
      if (/pinterest\.com|pin\.it|(?:^|[\/\-_?=&\s])pinterest(?:$|[\/\-_?=&\s])/i.test(s)) return 'Pinterest'
      if (/youtube\.com|youtu\.be|(?:^|[\/\-_?=&\s])youtube(?:$|[\/\-_?=&\s])|(?:^|[\/\-_?=&\s])yt(?:$|[\/\-_?=&\s])/i.test(s)) return 'YouTube'
      if (/threads\.net|(?:^|[\/\-_?=&\s])threads(?:$|[\/\-_?=&\s])/i.test(s)) return 'Threads'
      if (/snapchat\.com|(?:^|[\/\-_?=&\s])snapchat(?:$|[\/\-_?=&\s])/i.test(s)) return 'Snapchat'
      // Intentional: Telegram/WhatsApp are support/contact channels, not social profile links for this rule.
      return null
    }

    function classifySocialFromElement(el: Element): string | null {
      const href = (el.getAttribute('href') || '').trim()
      const aria = (el.getAttribute('aria-label') || '').trim()
      const title = (el.getAttribute('title') || '').trim()
      const rel = (el.getAttribute('rel') || '').trim()
      const cls = (el.getAttribute('class') || '').trim()
      const id = (el.getAttribute('id') || '').trim()
      const text = (el.textContent || '').trim()
      const signals = [href, aria, title, rel, cls, id, text].filter(Boolean).join(' | ')
      return classifySocialFromSignals(signals)
    }

    function socialSignalsFromElement(el: Element): string {
      const href = (el.getAttribute('href') || '').trim()
      const aria = (el.getAttribute('aria-label') || '').trim()
      const title = (el.getAttribute('title') || '').trim()
      const rel = (el.getAttribute('rel') || '').trim()
      const cls = (el.getAttribute('class') || '').trim()
      const id = (el.getAttribute('id') || '').trim()
      const dataSocial = (el.getAttribute('data-social') || '').trim()
      const text = (el.textContent || '').trim()
      // Many storefront icon controls expose social provider only via SVG/link references.
      let svgHints = ''
      try {
        const svgRef = el.querySelector('use')?.getAttribute('href') || el.querySelector('use')?.getAttribute('xlink:href') || ''
        const svgTitle = el.querySelector('svg title')?.textContent || ''
        svgHints = `${svgRef} ${svgTitle}`.trim()
      } catch {
        /* ignore */
      }
      return [href, aria, title, rel, cls, id, dataSocial, text, svgHints]
        .filter(Boolean)
        .join(' | ')
    }

    function hostsFromRoot(root: Element | null): string[] {
      const hosts = new Set<string>()
      if (!root) return []
      root
        .querySelectorAll('a, button, [role="link"], [onclick], [data-social], [aria-label], [title]')
        .forEach((el) => {
        const tag = el.tagName.toLowerCase()
        const href = (el.getAttribute('href') || '').trim()
        const hasExplicitSocialAttr =
          /instagram|facebook|twitter|x|tiktok|linkedin|youtube|pinterest|threads|snapchat|telegram|whatsapp/i.test(
            `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.getAttribute('data-social') || ''}`,
          )
        // Guardrail: only treat as social when it's a real link or explicit social control.
        if (tag === 'a' && !href) return
        if (tag !== 'a' && !hasExplicitSocialAttr) return
        const c = classifySocialFromSignals(socialSignalsFromElement(el))
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
    document
      .querySelectorAll('a, button, [role="link"], [onclick], [data-social], [aria-label], [title]')
      .forEach((el) => {
      if (!(el instanceof HTMLElement)) return
      const tag = el.tagName.toLowerCase()
      const href = (el.getAttribute('href') || '').trim()
      const hasExplicitSocialAttr =
        /instagram|facebook|twitter|x|tiktok|linkedin|youtube|pinterest|threads|snapchat|telegram|whatsapp/i.test(
          `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.getAttribute('data-social') || ''}`,
        )
      if (tag === 'a' && !href) return
      if (tag !== 'a' && !hasExplicitSocialAttr) return
      const r = el.getBoundingClientRect()
      const centerY = r.top + window.scrollY + r.height / 2
      if (centerY < yCut) return
      const c = classifySocialFromSignals(socialSignalsFromElement(el))
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
