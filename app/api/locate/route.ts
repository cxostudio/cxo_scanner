import { NextRequest, NextResponse } from 'next/server'
import { OpenRouter } from '@openrouter/sdk'
import { launchPuppeteerBrowser } from '@/lib/puppeteer/launchPuppeteer'

/**
 * POST /api/locate: pins scan findings on the page.
 *
 * Runs after the scan, separately from the scan engine (app/api/scan), so it can't change a
 * single pass/fail. One page load, one AI call:
 *   1. open the page at 1440px, close the cookie banner, capture the top of the page
 *   2. list the visible elements with their position (buttons, title, price, reviews, images…)
 *   3. ask the model which listed element each finding is about, or where its fix belongs
 *      (e.g. "no trust badges near the button" → the Add to cart button)
 * The pins are element boxes on that same screenshot, so they always line up.
 */

export const runtime = 'nodejs'
export const maxDuration = 120

const WIDTH = 1440
const MAX_HEIGHT = 2600 // top of the page: where product-page findings live
const MAX_ELEMENTS = 140

type Box = { x: number; y: number; w: number; h: number }
type Candidate = { id: string; kind: string; text: string; box: Box }
type Finding = { id: string; title: string; reason?: string }

const CONSENT_WORDS = ['accept', 'allow all', 'agree', 'aceptar', 'accepter', 'tout accepter', 'akzeptieren', 'accetta', 'aceitar', 'ok', 'got it', 'alle akzeptieren', 'accepteren']

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { url?: string; findings?: Finding[] }
  const raw = typeof body.url === 'string' ? body.url.trim() : ''
  const findings = (Array.isArray(body.findings) ? body.findings : [])
    .filter((f) => f && typeof f.id === 'string' && typeof f.title === 'string')
    .slice(0, 30)
  if (!raw || !findings.length) return NextResponse.json({ error: 'url and findings are required' }, { status: 400 })
  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`

  let browser: Awaited<ReturnType<typeof launchPuppeteerBrowser>> | null = null
  try {
    browser = await launchPuppeteerBrowser({ windowSizeArg: `--window-size=${WIDTH},900` })
    const page = await browser.newPage()
    await page.setViewport({ width: WIDTH, height: 900, deviceScaleFactor: 1 })
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    )
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 45_000 })
    } catch {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    }
    await new Promise((r) => setTimeout(r, 800))

    // close the cookie banner so it doesn't cover the page we pin on
    await page
      .evaluate((words: string[]) => {
        const els = Array.from(document.querySelectorAll<HTMLElement>('button, a, [role="button"], input[type="button"], input[type="submit"]'))
        const hit = els.find((el) => {
          const t = (el.innerText || (el as HTMLInputElement).value || '').trim().toLowerCase()
          const r = el.getBoundingClientRect()
          return t.length > 0 && t.length < 30 && r.width > 0 && r.height > 0 && words.some((w) => t === w || t.startsWith(w + ' ') || t.includes(w))
        })
        hit?.click()
      }, CONSENT_WORDS)
      .catch(() => undefined)
    await new Promise((r) => setTimeout(r, 700))

    // newsletter popups and chat bubbles: Escape, then hide anything fixed that covers the page,
    // and undo the scroll lock popups put on <html>/<body>
    await page.keyboard.press('Escape').catch(() => undefined)
    await page
      .evaluate(() => {
        const vw = window.innerWidth
        const vh = window.innerHeight
        for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
          const st = getComputedStyle(el)
          if (st.position !== 'fixed' && st.position !== 'sticky') continue
          const r = el.getBoundingClientRect()
          const big = r.width * r.height > vw * vh * 0.25
          const z = parseInt(st.zIndex || '0', 10)
          const isHeader = r.top <= 1 && r.height < 160
          if ((big && !isHeader) || (st.position === 'fixed' && z > 1000 && !isHeader && r.height < vh * 0.5 && r.top > vh * 0.5)) {
            el.style.setProperty('display', 'none', 'important')
          }
        }
        for (const el of [document.documentElement, document.body]) {
          el.style.setProperty('overflow', 'visible', 'important')
          el.style.setProperty('height', 'auto', 'important')
          el.style.setProperty('position', 'static', 'important')
        }
      })
      .catch(() => undefined)
    await new Promise((r) => setTimeout(r, 300))

    // nudge lazy images into place, then back to the top
    await page.evaluate(async (h: number) => {
      for (let y = 0; y < h; y += 700) {
        window.scrollTo(0, y)
        await new Promise((r) => setTimeout(r, 120))
      }
      window.scrollTo(0, 0)
    }, MAX_HEIGHT)
    await new Promise((r) => setTimeout(r, 400))

    const { candidates, height } = await page.evaluate(
      (maxH: number, maxN: number) => {
        const out: { id: string; kind: string; text: string; box: { x: number; y: number; w: number; h: number } }[] = []
        const seen = new Set<Element>()
        const rule = (sel: string, kind: string) => ({ sel, kind })
        const rules = [
          rule('h1', 'title'),
          rule('h2, h3', 'heading'),
          rule('button, [role="button"], input[type="submit"], a[class*="btn"], a[class*="button"]', 'button'),
          rule('[class*="price" i], [data-price]', 'price'),
          rule('[class*="review" i], [class*="rating" i], [class*="star" i], [class*="yotpo" i], [class*="judge" i], [class*="okendo" i]', 'reviews'),
          rule('[class*="badge" i], [class*="trust" i], [class*="guarantee" i], [class*="payment" i]', 'trust'),
          rule('[class*="shipping" i], [class*="delivery" i], [class*="announcement" i]', 'shipping'),
          rule('[class*="breadcrumb" i], nav[aria-label*="bread" i]', 'breadcrumb'),
          rule('select, [class*="swatch" i], [class*="variant" i], fieldset, [class*="option" i]', 'variants'),
          rule('[class*="tab" i], details, [class*="accordion" i], [class*="collapsible" i]', 'tabs'),
          rule('[class*="gallery" i], [class*="media" i], [class*="slider" i]', 'gallery'),
          rule('img, video', 'image'),
          rule('header, nav', 'navigation'),
          rule('[class*="upsell" i], [class*="recommend" i], [class*="related" i], [class*="bundle" i]', 'upsell'),
          rule('[class*="description" i], [class*="benefit" i], [class*="feature" i], ul', 'content'),
          rule('form, input[type="email"]', 'form'),
        ]
        for (const { sel, kind } of rules) {
          for (const el of Array.from(document.querySelectorAll(sel))) {
            if (out.length >= maxN) break
            if (seen.has(el)) continue
            const r = el.getBoundingClientRect()
            const y = r.top + window.scrollY
            const st = getComputedStyle(el)
            if (r.width < 24 || r.height < 12 || y > maxH || r.width > window.innerWidth * 0.98 && r.height > 600) continue
            if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) continue
            if (kind === 'image' && (r.width < 120 || r.height < 120)) continue
            seen.add(el)
            const text = ((el as HTMLElement).innerText || el.getAttribute('alt') || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 60)
            out.push({ id: `e${out.length + 1}`, kind, text, box: { x: Math.round(r.left + window.scrollX), y: Math.round(y), w: Math.round(r.width), h: Math.round(r.height) } })
          }
        }
        return { candidates: out, height: Math.min(maxH, Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)) }
      },
      MAX_HEIGHT,
      MAX_ELEMENTS,
    )

    const shot = await page.screenshot({ type: 'jpeg', quality: 72, clip: { x: 0, y: 0, width: WIDTH, height }, captureBeyondViewport: true })
    const screenshot = `data:image/jpeg;base64,${Buffer.from(shot).toString('base64')}`

    const debug: string[] = [`${candidates.length} elements`]
    const pins = await matchFindings(findings, candidates as Candidate[], screenshot, debug)
    const withDebug = request.nextUrl.searchParams.get('debug') === '1'
    return NextResponse.json({ screenshot, width: WIDTH, height, pins, ...(withDebug ? { debug, candidates } : {}) })
  } catch (error) {
    console.error('/api/locate error:', error)
    return NextResponse.json({ error: 'Could not place the findings on the page' }, { status: 500 })
  } finally {
    if (browser) await browser.close().catch(() => undefined)
  }
}

/** One AI call: finding → element id. Unknown ids and low-confidence matches are dropped. */
async function matchFindings(findings: Finding[], candidates: Candidate[], screenshot: string, debug: string[] = []) {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey || !candidates.length) {
    debug.push(apiKey ? 'no elements' : 'no OPENROUTER_API_KEY')
    return []
  }
  const list = candidates.map((c) => `${c.id} | ${c.kind} | "${c.text}" | x${c.box.x} y${c.box.y} ${c.box.w}x${c.box.h}`).join('\n')
  const asked = findings.map((f) => `${f.id} | ${f.title}${f.reason ? ` | what we saw: ${f.reason.slice(0, 220)}` : ''}`).join('\n')
  const system =
    'You place conversion-audit findings on a screenshot of an e-commerce product page. ' +
    'You get the page screenshot, a list of page elements (id | kind | text | position in px on the screenshot) and a list of findings. ' +
    'For each finding, pick the ONE element the finding is about. If something is missing, pick the element where it should be added ' +
    '(e.g. missing trust badges or free-shipping message → the main add-to-cart button; missing benefits → the product title; missing reviews near title → the product title). ' +
    'Prefer elements in the main product area over header or footer. If no listed element fits (the finding is about another page or something not in the screenshot), use null. ' +
    'Answer only JSON: {"pins":[{"finding":"<finding id>","element":"<element id or null>","confidence":0-1}]}'
  try {
    const openRouter = new OpenRouter({ apiKey })
    const res = await openRouter.chat.send({
      model: process.env.OPENROUTER_LOCATE_MODEL || process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash-lite',
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            { type: 'text', text: `ELEMENTS\n${list}\n\nFINDINGS\n${asked}` },
            { type: 'image_url', imageUrl: { url: screenshot } },
          ],
        },
      ],
      temperature: 0,
      maxTokens: 1500,
      stream: false,
      responseFormat: { type: 'json_object' },
    } as never)
    const content = (res as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content
    const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((p: { text?: string }) => p?.text || '').join('') : ''
    debug.push(`ai: ${text.slice(0, 600)}`)
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as { pins?: { finding?: string; element?: string | null; confidence?: number }[] }
    const byId = new Map(candidates.map((c) => [c.id, c]))
    const ids = new Set(findings.map((f) => f.id))
    return (json.pins ?? [])
      .filter((p) => p.finding && ids.has(p.finding) && p.element && byId.has(p.element) && (p.confidence ?? 1) >= 0.4)
      .map((p) => ({ findingId: p.finding as string, box: byId.get(p.element as string)!.box }))
  } catch (e) {
    console.error('[locate] matching failed:', e)
    debug.push(`ai error: ${e instanceof Error ? e.message : String(e)}`)
    return []
  }
}
