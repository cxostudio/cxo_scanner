// Footer-only capture: last viewport of the page on desktop + footer text and links.
// Usage: node footer.js <outDir> [pageId...]
const { chromium } = require('playwright')
const fs = require('fs'), path = require('path')
const pages = require('./pages.json')
const out = process.argv[2] || 'review', only = process.argv.slice(3)
;(async () => {
  const b = await chromium.launch()
  for (const p of pages.filter((p) => p.id !== 'lugarde' && (!only.length || only.includes(p.id)))) {
    const page = await b.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' })
    try {
      await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: 45000 })
      await page.waitForTimeout(4000)
      await page.addStyleTag({ content: 'body [aria-modal="true"],body dialog[open],body div[class*="klaviyo"],body [class*="popup-overlay"],body [class*="modal-backdrop"],#onetrust-consent-sdk{display:none!important}' }).catch(() => {})
      await page.evaluate(async () => { for (let i = 0; i < 6; i++) { window.scrollTo(0, 1e6); await new Promise((r) => setTimeout(r, 700)) } })
      await page.waitForTimeout(1000)
      await page.screenshot({ path: path.join(out, p.id, 'desktop-footer.png') })
      const f = await page.evaluate(() => {
        const el = document.querySelector('footer') || [...document.querySelectorAll('[class*="footer" i],[id*="footer" i]')].pop()
        if (!el) return { found: false }
        return { found: true, text: el.innerText.replace(/\n{2,}/g, '\n').slice(0, 5000), links: [...el.querySelectorAll('a')].map((a) => (a.innerText.trim() || a.getAttribute('aria-label') || '') + ' -> ' + a.href).slice(0, 120), inputs: [...el.querySelectorAll('input')].map((i) => i.type + ':' + (i.placeholder || i.name)) }
      })
      f.backToTop = await page.evaluate(() => !![...document.querySelectorAll('a,button')].find((e) => /back to top|scroll to top|naar boven|haut de page|volver arriba/i.test(e.innerText + ' ' + (e.getAttribute('aria-label') || '')) || /top/.test(e.getAttribute('href') || '') && e.getAttribute('href').startsWith('#')))
      fs.writeFileSync(path.join(out, p.id, 'footer.json'), JSON.stringify(f, null, 2))
      console.log(p.id, f.found ? 'ok' : 'no footer element')
    } catch (e) { console.log(p.id, 'ERR', String(e).slice(0, 120)) }
    await page.close()
  }
  await b.close()
})()
