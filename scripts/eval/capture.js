// Captures what a reviewer needs to judge each checkpoint by hand:
// desktop + mobile screenshots cut into viewport tiles, visible text, and DOM facts
// that screenshots cannot show (colours, lazy loading, alt text, schema, meta).
// Usage: node capture.js <outDir> [pageId...]
const { chromium } = require('playwright')
const fs = require('fs')
const path = require('path')

const pages = require('./pages.json')
const out = process.argv[2] || 'review'
const only = process.argv.slice(3)

const DEVICES = {
  desktop: { viewport: { width: 1440, height: 900 }, maxTiles: 6 },
  mobile: {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    maxTiles: 8,
  },
}

async function clean(page) {
  for (const sel of ['#onetrust-accept-btn-handler', 'button[id*="accept"]', 'button:has-text("Accept")', 'button:has-text("Accepteren")', 'button:has-text("Alles accepteren")', 'button:has-text("Accepter")', 'button:has-text("Tout accepter")', 'button:has-text("Aceptar")', '#didomi-notice-agree-button', '.cc-allow']) {
    try {
      const b = page.locator(sel).first()
      if (await b.isVisible({ timeout: 300 })) await b.click({ timeout: 1000 })
    } catch {}
  }
  await page.keyboard.press('Escape').catch(() => {})
  // Some themes scroll an inner wrapper instead of the document: unroll it so the page has its real height.
  await page.evaluate(() => {
    for (const el of [document.documentElement, document.body, ...document.querySelectorAll('body > *, body > * > *')]) {
      const s = getComputedStyle(el)
      if (el.scrollHeight > el.clientHeight + 50 && /(auto|scroll|hidden)/.test(s.overflowY)) {
        el.style.setProperty('overflow', 'visible', 'important')
        el.style.setProperty('height', 'auto', 'important')
        el.style.setProperty('max-height', 'none', 'important')
      }
    }
  }).catch(() => {})
  await page.addStyleTag({ content: `body [aria-modal="true"],body dialog[open],body div[class*="klaviyo"],body div[id*="klaviyo"],body [class*="popup-overlay"],body [class*="modal-backdrop"]{display:none!important} html,body{overflow:auto!important}` }).catch(() => {})
}

async function scroll(page) {
  await page.evaluate(async () => {
    for (let y = 0; y < Math.min(document.body.scrollHeight, 9000); y += 600) {
      window.scrollTo(0, y)
      await new Promise((r) => setTimeout(r, 120))
    }
    window.scrollTo(0, 0)
  })
  await page.waitForTimeout(800)
}

async function facts(page) {
  return page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect()
      const s = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
    }
    const imgs = [...document.images]
    const colors = {}
    let pureBlackText = 0, pureBlackBg = 0
    for (const el of document.querySelectorAll('body *')) {
      if (!vis(el)) continue
      const s = getComputedStyle(el)
      if (s.color === 'rgb(0, 0, 0)' && el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) pureBlackText++
      if (s.backgroundColor === 'rgb(0, 0, 0)') pureBlackBg++
      if (el.matches('button, a[class*="btn"], [type="submit"]')) colors[s.backgroundColor] = (colors[s.backgroundColor] || 0) + 1
    }
    const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => {
      try { const j = JSON.parse(s.textContent); return [].concat(j).map((x) => x['@type'] || (x['@graph'] || []).map((g) => g['@type'])).flat() } catch { return ['(invalid)'] }
    }).flat()
    const buttons = [...document.querySelectorAll('button, a[role="button"], input[type="submit"], a[class*="btn"], a[class*="button"]')].filter(vis).map((b) => (b.innerText || b.value || b.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ')).filter(Boolean)
    const inputs = [...document.querySelectorAll('input, select')].filter(vis).map((i) => ({ type: i.type || i.tagName.toLowerCase(), name: i.name, checked: i.checked || undefined, label: i.labels?.[0]?.innerText?.trim().slice(0, 40) }))
    const fonts = {}
    for (const el of document.querySelectorAll('h1,h2,h3,p,button,a,span,li')) if (vis(el)) { const f = getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, ''); fonts[f] = (fonts[f] || 0) + 1 }
    const footer = document.querySelector('footer')
    return {
      title: document.title,
      lang: document.documentElement.lang,
      metaDescription: document.querySelector('meta[name="description"]')?.content,
      viewportMeta: document.querySelector('meta[name="viewport"]')?.content,
      h1: [...document.querySelectorAll('h1')].map((h) => h.innerText.trim()).slice(0, 3),
      images: {
        total: imgs.length,
        loadingLazy: imgs.filter((i) => i.loading === 'lazy').length,
        dataSrcLazy: imgs.filter((i) => i.dataset.src || i.className.includes('lazy')).length,
        missingAlt: imgs.filter((i) => !i.hasAttribute('alt')).length,
        emptyAlt: imgs.filter((i) => i.getAttribute('alt') === '').length,
        webpOrAvif: imgs.filter((i) => /\.(webp|avif)|format=(webp|avif)|fm=(webp|avif)/i.test(i.currentSrc || i.src)).length,
        withSrcset: imgs.filter((i) => i.srcset).length,
      },
      videos: [...document.querySelectorAll('video, iframe[src*="youtube"], iframe[src*="vimeo"]')].map((v) => ({ tag: v.tagName, preload: v.preload, loading: v.getAttribute('loading'), autoplay: v.autoplay })),
      pureBlack: { textElements: pureBlackText, backgroundElements: pureBlackBg },
      buttonBackgrounds: colors,
      fonts,
      structuredDataTypes: ld,
      buttons: [...new Set(buttons)].slice(0, 80),
      formInputs: inputs.slice(0, 40),
      footerLinks: footer ? [...footer.querySelectorAll('a')].map((a) => (a.innerText.trim() || a.getAttribute('aria-label') || '') + ' -> ' + a.href).slice(0, 80) : [],
      socialLinks: [...document.querySelectorAll('a[href]')].map((a) => a.href).filter((h) => /instagram|facebook|tiktok|youtube|pinterest|linkedin|twitter|x\.com/.test(h)).slice(0, 20),
      breadcrumb: document.querySelector('nav[aria-label*="read" i], [class*="breadcrumb"]')?.innerText?.trim().replace(/\s+/g, ' '),
      scripts: [...document.scripts].map((s) => s.src).filter(Boolean).map((s) => new URL(s).hostname).filter((v, i, a) => a.indexOf(v) === i),
      pageHeight: document.body.scrollHeight,
    }
  })
}

;(async () => {
  const browser = await chromium.launch()
  for (const p of pages.filter((p) => !only.length || only.includes(p.id))) {
    const dir = path.join(out, p.id)
    fs.mkdirSync(dir, { recursive: true })
    const info = { id: p.id, url: p.url }
    for (const [name, d] of Object.entries(DEVICES)) {
      const { maxTiles, ...ctxOpts } = d
      const ctx = await browser.newContext({ ...ctxOpts, locale: 'en-US' })
      const page = await ctx.newPage()
      const t0 = Date.now()
      try {
        await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: 45000 })
        await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {})
        await clean(page)
        await scroll(page)
        await clean(page)
        info[name] = { loadMs: Date.now() - t0, facts: await facts(page) }
        if (name === 'desktop') fs.writeFileSync(path.join(dir, 'text.txt'), (await page.innerText('body')).replace(/\n{3,}/g, '\n\n').slice(0, 40000))
        const h = Math.min(Math.max(d.viewport.height, await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, document.scrollingElement?.scrollHeight || 0))), d.viewport.height * maxTiles)
        await page.setViewportSize({ width: d.viewport.width, height: h }).catch(() => {})
        await page.waitForTimeout(600)
        const full = path.join(dir, `${name}-full.png`)
        await page.screenshot({ path: full, clip: { x: 0, y: 0, width: d.viewport.width, height: h } })
        // tiles of one viewport each, so text stays readable
        for (let i = 0; i * d.viewport.height < h; i++) {
          const th = Math.min(d.viewport.height, h - i * d.viewport.height)
          await page.screenshot({ path: path.join(dir, `${name}-${String(i + 1).padStart(2, '0')}.png`), clip: { x: 0, y: i * d.viewport.height, width: d.viewport.width, height: th } })
        }
        fs.unlinkSync(full)
      } catch (e) {
        info[name] = { error: String(e).slice(0, 300) }
      }
      await ctx.close()
    }
    fs.writeFileSync(path.join(dir, 'facts.json'), JSON.stringify(info, null, 2))
    console.log(p.id, info.desktop?.error ? 'desktop ERR' : 'ok', info.mobile?.error ? 'mobile ERR' : 'ok')
  }
  await browser.close()
})()
