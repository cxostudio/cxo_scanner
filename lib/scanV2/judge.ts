// Scan engine v2, step 2: a stronger model judges every checkpoint from the full evidence.
// Checkpoints go in fixed groups, in parallel, at temperature 0, and every answer must
// cite what was seen. "unknown" is allowed: we never guess.
import { OpenRouter } from '@openrouter/sdk'
import type { Evidence } from './capture'

export type Rule = { id: string; title: string; description: string }
export type Verdict = { id: string; answer: 'pass' | 'fail' | 'na' | 'unknown'; evidence: string }

export const V2_MODEL = () => process.env.SCAN_V2_MODEL || 'google/gemini-2.5-flash'
const GROUP_SIZE = 8

const SYSTEM = `You are a senior CRO (conversion rate optimisation) practitioner auditing one e-commerce product page.
You get screenshots of the page (desktop and mobile, top to bottom, plus the footer), the page text, text hidden inside closed tabs/accordions, and facts measured in the page code. Use all of it: the screenshots for what a shopper sees, the facts for things screenshots cannot show (colours, lazy loading, links, form inputs).

For each checkpoint, decide whether the page meets "what good looks like":
- "pass": the page clearly does it (in spirit; a reasonable practitioner would tick it).
- "fail": it clearly does not, or the element is missing where it should be.
- "na": the checkpoint does not make sense for this product (e.g. size guide for a coffee pack, before/after photos for a sofa). Use sparingly: missing-but-relevant is "fail".
- "unknown": the evidence genuinely cannot settle it. Never guess.

Rules:
- Answer polarity: "pass" always means the page meets what good looks like. For a negative question ("Do you use pure black for text or backgrounds?") pure black present means "fail".
- Judge the page as a shopper sees it. Header, navigation and footer count for checkpoints about them.
- Elements in the header are easy to miss in text: check the header screenshot and the measured header controls (icons without text, like a magnifier or bag icon, still count).
- A sale price or "save X%" is not a quantity discount. A quantity discount means the price per item drops when buying more.
- Labels: judge the main buttons of the page (add to cart, buy box), not navigation links.
- Write "evidence" for the store owner: one short, plain sentence naming what is (or is not) on their page and where. No screenshot numbers, no jargon, no em dashes.

Reply with JSON only: {"results":[{"id":"<checkpoint id>","answer":"pass|fail|na|unknown","evidence":"..."}]} with exactly one entry per checkpoint given.`

function evidenceText(ev: Evidence) {
  return [
    `PAGE: ${ev.finalUrl}`,
    `TITLE: ${ev.title}`,
    `MEASURED FACTS (desktop): ${JSON.stringify(ev.facts)}`,
    `MEASURED FACTS (mobile): ${JSON.stringify(ev.mobileFacts)}`,
    `CART TEST: ${ev.cartTest || 'not run'}${ev.cartHeader ? ' (see the image of the header after adding to cart)' : ''}`,
    `VISIBLE TEXT (desktop, top to bottom):\n${ev.text}`,
    ev.hiddenText ? `TEXT INSIDE CLOSED TABS / ACCORDIONS:\n${ev.hiddenText}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

function images(ev: Evidence) {
  const tiles = [...ev.desktopTiles, ...ev.mobileTiles, ...(ev.cartHeader ? [ev.cartHeader] : [])]
  return tiles.flatMap((t) => [
    { type: 'text' as const, text: `[${t.label}]` },
    { type: 'image_url' as const, imageUrl: { url: t.dataUrl } },
  ])
}

function parse(raw: unknown): Verdict[] {
  let s = ''
  if (typeof raw === 'string') s = raw
  else if (Array.isArray(raw)) s = raw.filter((p: any) => p?.type === 'text').map((p: any) => p.text).join('')
  s = s.replace(/^```(json)?/i, '').replace(/```$/, '').trim()
  const j = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1))
  return (j.results || []) as Verdict[]
}

async function judgeGroup(client: OpenRouter, ev: Evidence, group: Rule[], shared: { text: string; imgs: ReturnType<typeof images> }): Promise<Verdict[]> {
  const list = group
    .map((r) => `- id: ${r.id}\n  question: ${r.title}\n  what good looks like: ${r.description.replace(/\s+/g, ' ').slice(0, 900)}`)
    .join('\n')
  const content = [
    { type: 'text' as const, text: shared.text },
    ...shared.imgs,
    { type: 'text' as const, text: `CHECKPOINTS TO JUDGE (${group.length}):\n${list}\n\nReply with the JSON object only.` },
  ]
  let lastErr: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res: any = await client.chat.send({
        model: V2_MODEL(),
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: content as any },
        ],
        temperature: 0,
        topP: 0.1,
        seed: 42,
        maxTokens: 4000,
        stream: false,
        responseFormat: { type: 'json_object' },
      } as any)
      const verdicts = parse(res?.choices?.[0]?.message?.content)
      const byId = new Map(verdicts.map((v) => [v.id, v]))
      return group.map((r) => {
        const v = byId.get(r.id)
        const answer = v && ['pass', 'fail', 'na', 'unknown'].includes(String(v.answer).toLowerCase()) ? (String(v.answer).toLowerCase() as Verdict['answer']) : 'unknown'
        return { id: r.id, answer, evidence: (v?.evidence || 'We could not check this one.').replace(/\s*—\s*/g, ', ') }
      })
    } catch (e) {
      lastErr = e
    }
  }
  console.warn('[scanV2] group failed', lastErr)
  return group.map((r) => ({ id: r.id, answer: 'unknown', evidence: 'We could not check this one.' }))
}

export async function judge(ev: Evidence, rules: Rule[], apiKey: string): Promise<Verdict[]> {
  const client = new OpenRouter({ apiKey })
  const shared = { text: evidenceText(ev), imgs: images(ev) }
  const groups: Rule[][] = []
  for (let i = 0; i < rules.length; i += GROUP_SIZE) groups.push(rules.slice(i, i + GROUP_SIZE))
  const out = await Promise.all(groups.map((g) => judgeGroup(client, ev, g, shared)))
  return out.flat()
}
