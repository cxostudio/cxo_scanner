// Adds one product to the cart (Shopify /cart/add.js) then screenshots the header, desktop + mobile.
const { chromium } = require('playwright')
const fs = require('fs'), path = require('path')
const pages = require('./pages.json')
;(async () => {
  const b = await chromium.launch()
  for (const p of pages.filter((p) => p.id !== 'lugarde')) {
    const res = { }
    for (const [dev, opts] of [['desktop', { viewport: { width: 1440, height: 900 } }], ['mobile', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' }]]) {
      const ctx = await b.newContext({ ...opts, locale: 'en-US' })
      const page = await ctx.newPage()
      try {
        await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: 45000 })
        await page.waitForTimeout(2500)
        const added = await page.evaluate(async () => {
          const u = new URL(location.href)
          const r = await fetch(u.pathname.replace(/\/$/, '') + '.js')
          if (!r.ok) return 'not shopify ' + r.status
          const prod = await r.json()
          const v = prod.variants.find((v) => v.available) || prod.variants[0]
          const a = await fetch('/cart/add.js', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [{ id: v.id, quantity: 1 }] }) })
          const c = await (await fetch('/cart.js')).json()
          return 'add ' + a.status + ', cart items ' + c.item_count
        })
        res[dev] = added
        await page.reload({ waitUntil: 'domcontentloaded' })
        await page.waitForTimeout(3500)
        await page.addStyleTag({ content: 'body [aria-modal="true"],body dialog[open],body div[class*="klaviyo"],#onetrust-consent-sdk,body [class*="popup-overlay"]{display:none!important}' }).catch(() => {})
        await page.screenshot({ path: path.join('review', p.id, `${dev}-cart-header.png`), clip: { x: 0, y: 0, width: opts.viewport.width, height: 220 } })
      } catch (e) { res[dev] = 'ERR ' + String(e).slice(0, 100) }
      await ctx.close()
    }
    fs.writeFileSync(path.join('review', p.id, 'cart.json'), JSON.stringify(res))
    console.log(p.id, JSON.stringify(res))
  }
  await b.close()
})()
