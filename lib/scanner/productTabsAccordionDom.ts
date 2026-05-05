/**
 * Browser-only: detect product PDP tabs / accordions / disclosures (passed to page.evaluate).
 * Keeps Shopify / headless patterns that the initial generic selector pass often misses until after scroll/hydrate.
 */

export type ProductTabsAccordionDomResult = {
  pass: boolean
  tabsFoundSummary: string
  totalSignals: number
}

export function snapshotProductTabsAccordionDom(): ProductTabsAccordionDomResult {
  const roots = Array.from(
    document.querySelectorAll('main, [role="main"], #MainContent, [id*="product" i]:not(header):not(footer)'),
  ) as HTMLElement[]

  const inProductChrome = (el: Element): boolean =>
    !!el.closest(
      'main, [role="main"], [id*="MainContent" i], [class*="product" i], [id*="Product" i], #MainContent',
    ) && !el.closest('header, [role="banner"], footer, [role="contentinfo"], nav[aria-label*="breadcrumb" i]')

  const labels = new Set<string>()
  let score = 0
  const parts: string[] = []

  const note = (msg: string, pts: number) => {
    score += pts
    parts.push(msg)
  }

  for (const root of roots.length ? roots : ([document.body] as HTMLElement[])) {
    const dets = Array.from(root.querySelectorAll(':scope details')).filter(inProductChrome)
    if (dets.length >= 1) note(`${dets.length}×<details>`, dets.length >= 2 ? 4 : 2)

    const sums = Array.from(root.querySelectorAll(':scope summary')).filter(inProductChrome)
    if (sums.length >= 2) note(`${sums.length}×summary`, 3)

    const acc = Array.from(root.querySelectorAll('[class*="accordion" i], [class*="Accordion" i]')).filter(
      inProductChrome,
    )
    if (acc.length >= 1) note(`${acc.length}×accordion class`, 3)

    const disc = Array.from(root.querySelectorAll('[class*="disclosure" i], [class*="Disclosure" i]')).filter(
      inProductChrome,
    )
    if (disc.length >= 1) note(`${disc.length}×disclosure class`, 2)

    const coll = Array.from(
      root.querySelectorAll(
        '[class*="collapsible" i], [class*="Collapsible" i], [data-collapsible], [data-accordion], [class*="faq" i][class*="item" i]',
      ),
    ).filter(inProductChrome)
    if (coll.length >= 1) note(`${coll.length}×collapsible/FAQ`, 2)

    const expanded = Array.from(
      root.querySelectorAll('[aria-expanded="true"], [aria-expanded="false"]'),
    ).filter((el) => inProductChrome(el) && (el.closest('details') || (el.matches('button, [role="button"]') && (el.textContent || '').trim().length < 140)))
    if (expanded.length >= 3) note(`${expanded.length}×aria-expanded controls`, 4)
    else if (expanded.length >= 2) note(`${expanded.length}×aria-expanded controls`, 2)

    root
      .querySelectorAll(':scope button, [role="button"], :scope summary, [role="tab"]')
      .forEach((el) => {
        if (!inProductChrome(el)) return
        const raw = (el.textContent || '').replace(/\s+/g, ' ').trim()
        const t = raw.toLowerCase()
        if (!t || t.length > 88) return
        const hit =
          /^(product details?|description|ingredients?(?:\s*[&+]?\s*nutrition)?|nutritional information|reviews?|shipping|delivery|returns?|specifications?|how to use|faq|benefits|features|warnings?|dosage)$/i.test(
            t,
          ) ||
          /\bshipping\b.*\breturns?\b|\bfaq\b|^what'?s\s+inside$/i.test(t) ||
          (t.includes('ingredient') && t.includes('nutrition')) ||
          (/^faq\b/i.test(t) && raw.length <= 120)
        if (hit) labels.add(raw.slice(0, 56))
      })
  }

  const roleTabs = Array.from(document.querySelectorAll('[role="tab"], [role="tablist"], [role="tabpanel"]')).filter(
    inProductChrome,
  )
  if (roleTabs.length >= 2) note(`${roleTabs.length}×ARIA tabs`, 4)

  if (labels.size >= 2) note(`${labels.size} labelled section controls (${Array.from(labels).slice(0, 4).join(' | ')})`, 5)
  else if (labels.size >= 1 && score >= 2) note(`${labels.size} labelled section controls`, 2)

  const hasDetailsInMain = !!document.querySelector('main details, [role="main"] details')
  const hasAccordionInMain = !!document.querySelector(
    'main [class*="accordion" i], [role="main"] [class*="accordion" i]',
  )

  const pass =
    score >= 4 ||
    labels.size >= 2 ||
    (labels.size >= 1 && (hasDetailsInMain || hasAccordionInMain)) ||
    (hasDetailsInMain && (score >= 2 || labels.size >= 1)) ||
    (hasAccordionInMain && score >= 2)

  const tabsFoundSummary = parts.length ? parts.join('; ') + (labels.size ? `; headings:${labels.size}` : '') : 'none'

  return {
    pass,
    tabsFoundSummary,
    totalSignals: score + labels.size * 2,
  }
}

/** Server-side heuristic when Puppeteer succeeds but PDP DOM snippet is stale or tab lines were dropped. */
export function detectTabsAccordionFromHtml(html: string): ProductTabsAccordionDomResult {
  const chunk = (html || '').slice(0, 400_000)
  const lc = chunk.toLowerCase()
  let score = 0
  const parts: string[] = []

  const add = (msg: string, pts: number) => {
    score += pts
    parts.push(msg)
  }

  const detailsCount = (chunk.match(/<details\b/gi) || []).length
  if (detailsCount >= 2) add(`${detailsCount}×<details> in HTML`, 4)
  else if (detailsCount >= 1) add(`${detailsCount}×<details> in HTML`, 2)

  if (/<summary\b/i.test(chunk) && detailsCount >= 1) add('summary paired with details', 2)

  if (/\baccordion\b/i.test(chunk) || /class="[^"]*accordion/i.test(chunk)) add('accordion class in HTML', 3)
  if (/\bdisclosure\b/i.test(chunk) || /class="[^"]*disclosure/i.test(chunk)) add('disclosure class in HTML', 2)
  if (/\bcollapsible\b/i.test(chunk) || /data-collapsible/i.test(chunk) || /data-accordion/i.test(chunk))
    add('collapsible/data-accordion in HTML', 2)

  const ariaExpanded = (chunk.match(/aria-expanded="/gi) || []).length
  if (ariaExpanded >= 6) add(`${ariaExpanded} aria-expanded in HTML`, 4)
  else if (ariaExpanded >= 3) add(`${ariaExpanded} aria-expanded in HTML`, 2)

  const tabRoles = (chunk.match(/role="tab(list|panel)?"/gi) || []).length
  if (tabRoles >= 2) add(`${tabRoles} ARIA tab roles in HTML`, 4)

  const uniqueLabels = new Set<string>()
  const labelPairs: readonly [RegExp, string][] = [
    [ />\s*product details?\s*</i, 'product-details' ],
    [ />\s*description\s*</i, 'description' ],
    [ />\s*ingredients?\s*</i, 'ingredients' ],
    [ />\s*nutrition(al)?(?:\s+information)?\s*</i, 'nutrition' ],
    [ />\s*shipping\b/i, 'shipping' ],
    [ />\s*delivery\b/i, 'delivery' ],
    [ />\s*returns?\s*</i, 'returns' ],
    [ />\s*faq\b/i, 'faq' ],
    [ />\s*specifications?\s*</i, 'specifications' ],
    [ />\s*how to use\s*</i, 'how-to-use' ],
    [ />\s*what'?s\s+inside\s*</i, 'whats-inside' ],
    [ />\s*benefits\s*</i, 'benefits' ],
    [ />\s*reviews?\s*</i, 'reviews' ],
  ]
  for (const [re, id] of labelPairs) {
    if (re.test(chunk)) uniqueLabels.add(id)
  }
  const labelScore = uniqueLabels.size >= 2 ? 5 : uniqueLabels.size === 1 ? 2 : 0
  if (labelScore) add(`${uniqueLabels.size} product-section label(s) in HTML`, labelScore)

  const pass =
    score >= 4 ||
    uniqueLabels.size >= 2 ||
    (uniqueLabels.size >= 1 && (detailsCount >= 1 || /\baccordion\b/i.test(lc))) ||
    (detailsCount >= 1 && score >= 2)

  const tabsFoundSummary = parts.length
    ? parts.join('; ') + (uniqueLabels.size ? `; labelMatches:${uniqueLabels.size}` : '')
    : 'none'

  return {
    pass,
    tabsFoundSummary,
    totalSignals: score + uniqueLabels.size * 2,
  }
}

export function formatProductTabsAccordionDomBlock(
  r: ProductTabsAccordionDomResult,
  source: 'dom-rescan' | 'html-fallback' = 'dom-rescan',
): string {
  const header =
    source === 'html-fallback'
      ? '--- PRODUCT TABS / ACCORDION (HTML FALLBACK) ---'
      : '--- PRODUCT TABS / ACCORDION (DOM RE-SCAN) ---'
  return [
    header,
    `Tabs/Accordions Found (scoped): ${r.tabsFoundSummary}`,
    `Scoped signal score: ${r.totalSignals}`,
    r.pass
      ? 'Tab/Accordion Status: PASS - Product detail sections use tabs, accordions, details, or equivalent controls.'
      : 'Tab/Accordion Status: FAIL - No reliable product-detail tabs or accordions detected in main content.',
  ].join('\n')
}
