// Pins placed by looking at a screenshot, for what DOM matching can't reach: the cart and checkout
// (only kept as images from the scan) and findings about something missing ("no press logos"), which
// get a pin where the fix belongs. Gemini returns boxes as box_2d [ymin, xmin, ymax, xmax] in 0-1000.
import { OpenRouter } from '@openrouter/sdk'

export type VisionFinding = { id: string; title: string; reason?: string }
/** box in fractions of the image (0-1) */
export type VisionPin = { findingId: string; image: number; box: { x: number; y: number; w: number; h: number } }

export async function visionPins(images: string[], findings: VisionFinding[], what: string, device: 'desktop' | 'mobile'): Promise<VisionPin[]> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey || !images.length || !findings.length) return []
  const system =
    `You place conversion-audit findings on screenshots of an online store's ${what}, seen on ${device === 'mobile' ? 'a phone' : 'a desktop screen'}. ` +
    `There are ${images.length} screenshot${images.length > 1 ? 's, numbered 1 to ' + images.length + ' in the order given' : ''}. ` +
    'For each finding, mark the area of the screenshot the finding is about. If something is missing, mark the area where it should be added ' +
    '(e.g. no shipping cost in the cart → the subtotal or the checkout button; no trust badges → just under the pay button). ' +
    'Keep boxes tight around one element or block, never the whole screen. If the finding cannot be placed on these screenshots, leave it out: fewer, correct pins beat vague ones. ' +
    'Answer only JSON: {"pins":[{"finding":"<finding id>","image":<screenshot number>,"box_2d":[ymin,xmin,ymax,xmax]}]} with coordinates from 0 to 1000.'
  const asked = findings.map((f) => `${f.id} | ${f.title}${f.reason ? ` | what we saw: ${f.reason.slice(0, 220)}` : ''}`).join('\n')
  const openRouter = new OpenRouter({ apiKey })
  const models = [process.env.OPENROUTER_VISION_PIN_MODEL || 'google/gemini-2.5-flash', 'google/gemini-2.5-pro']
  for (const model of models) {
    try {
      const res = await openRouter.chat.send({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: [{ type: 'text', text: `FINDINGS\n${asked}` }, ...images.map((url) => ({ type: 'image_url', imageUrl: { url } }))] },
        ],
        temperature: 0,
        maxTokens: 2000,
        stream: false,
        responseFormat: { type: 'json_object' },
      } as never)
      const content = (res as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content
      const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((p: { text?: string }) => p?.text || '').join('') : ''
      const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as { pins?: { finding?: string; image?: number; box_2d?: number[] }[] }
      const ids = new Set(findings.map((f) => f.id))
      const seen = new Set<string>()
      const out: VisionPin[] = []
      for (const p of json.pins || []) {
        const b = p.box_2d
        if (!p.finding || !ids.has(p.finding) || seen.has(p.finding) || !Array.isArray(b) || b.length !== 4) continue
        const [y0, x0, y1, x1] = b.map((v) => Math.min(1000, Math.max(0, Number(v) || 0)) / 1000)
        const w = x1 - x0, h = y1 - y0
        // drop nonsense: empty boxes, or a box that is most of the screenshot
        if (w <= 0.01 || h <= 0.003 || w * h > 0.6) continue
        const image = Math.min(images.length, Math.max(1, Math.round(Number(p.image) || 1))) - 1
        seen.add(p.finding)
        out.push({ findingId: p.finding, image, box: { x: x0, y: y0, w, h } })
      }
      return out
    } catch (e) {
      console.warn('[visionPins]', model, e instanceof Error ? e.message : e)
    }
  }
  return []
}
