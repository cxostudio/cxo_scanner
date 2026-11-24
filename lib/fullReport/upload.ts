// The thank-you page part of the full report. Our scan can't place an order, so the buyer uploads
// screenshots of their order confirmation (and post-purchase offer, payment step if they have them).
// The checkpoints are the Airtable rows with Check method "Customer upload"; their rules stay in Airtable.
import { OpenRouter } from '@openrouter/sdk'
import { getConversionCheckpointRules, type ScanRule } from '@/lib/conversionCheckpoints/getCheckpointRules'
import { buildCheckpointPresentationMap } from '@/lib/conversionCheckpoints/checkpointPresentation'
import { V2_MODEL } from '@/lib/scanV2/judge'
import type { ScanResult } from '@/lib/report'

export const UPLOAD_METHOD = 'Customer upload'
/** Uploads per report: enough to fix a wrong screenshot, not an open AI endpoint. */
export const MAX_TRIES = 5
export const MAX_SHOTS = 4

export type UploadDevice = 'desktop' | 'mobile'
export type UploadShot = { file: string; device: UploadDevice }
export type UploadPin = { file: string; findingId: string; box: { x: number; y: number; w: number; h: number } }
export type UploadState = { at: string; shots: UploadShot[]; results: ScanResult[]; pins: UploadPin[] }

/** Live upload checkpoints, plus Drafts until REPORT_UPLOAD_DRAFTS=off (all 16 are Draft today). */
export function isUploadRule(r: ScanRule): boolean {
  if (r.method !== UPLOAD_METHOD) return false
  return r.status === 'Live' || (r.status === 'Draft' && process.env.REPORT_UPLOAD_DRAFTS !== 'off')
}

export async function uploadCheckpoints() {
  const cp = await getConversionCheckpointRules()
  if (!cp.ok) throw new Error('checkpoints unavailable')
  return { rules: cp.rules.filter(isUploadRule), presentation: buildCheckpointPresentationMap(cp.records) }
}

type Answer = 'pass' | 'fail' | 'na' | 'unknown'
export type UploadJudgement = { isOrderPage: boolean; verdicts: { id: string; answer: Answer; evidence: string }[] }

function ruleLine(r: ScanRule): string {
  return [
    `id: ${r.id}`,
    `question: ${r.question || r.title}`,
    r.pass ? `pass when: ${r.pass}` : '',
    r.fail ? `fail when: ${r.fail}` : '',
    r.na ? `not relevant when: ${r.na}` : '',
  ].filter(Boolean).join('\n')
}

/** One call: is this an order page at all, then every upload checkpoint against the screenshots. */
export async function judgeUpload(shots: { dataUrl: string; device: UploadDevice }[], rules: ScanRule[]): Promise<UploadJudgement> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set')
  const list = shots.map((s, i) => `${i + 1}: ${s.device}`).join(', ')
  const system =
    'You audit screenshots a store owner uploaded of what a shopper sees after paying: the order confirmation (thank-you) page, ' +
    'and possibly a post-purchase offer page and the payment step of checkout. ' +
    `Screenshots, in order: ${list}.\n` +
    'Step 1: say whether at least one screenshot shows an online store\'s order confirmation, post-purchase offer or checkout. ' +
    'A homepage, a product page, an email or anything else is not.\n' +
    'Step 2: answer every checkpoint from what is visible, following its rules exactly:\n' +
    '- "pass": the pass rule is met on a screenshot.\n' +
    '- "fail": the part is shown and the pass rule is not met.\n' +
    '- "na": the not-relevant rule applies.\n' +
    '- "unknown": the screenshots do not show the part needed (e.g. a payment-step checkpoint with no payment step uploaded).\n' +
    'evidence: one short sentence to the store owner on what you saw, plain words, no jargon.\n' +
    'Answer only JSON: {"isOrderPage":true|false,"verdicts":[{"id":"<checkpoint id>","answer":"pass|fail|na|unknown","evidence":"..."}]}'
  const user = `CHECKPOINTS\n\n${rules.map(ruleLine).join('\n\n')}`
  const client = new OpenRouter({ apiKey })
  const models = [V2_MODEL(), 'google/gemini-2.5-pro']
  let lastErr = ''
  for (const model of models) {
    try {
      const res = await client.chat.send({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: [{ type: 'text', text: user }, ...shots.map((s) => ({ type: 'image_url', imageUrl: { url: s.dataUrl } }))] },
        ],
        temperature: 0,
        maxTokens: 4000,
        stream: false,
        responseFormat: { type: 'json_object' },
      } as never)
      const content = (res as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content
      const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((p: { text?: string }) => p?.text || '').join('') : ''
      const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as { isOrderPage?: unknown; verdicts?: { id?: string; answer?: string; evidence?: string }[] }
      const byId = new Map((json.verdicts || []).filter((v) => v.id).map((v) => [v.id!, v]))
      const verdicts = rules.map((r) => {
        const v = byId.get(r.id)
        const answer = (['pass', 'fail', 'na', 'unknown'].includes(v?.answer || '') ? v!.answer : 'unknown') as Answer
        return { id: r.id, answer, evidence: (v?.evidence || 'We could not check this one on your screenshots.').slice(0, 400) }
      })
      return { isOrderPage: json.isOrderPage === true, verdicts }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e)
      console.warn('[upload judge]', model, lastErr)
    }
  }
  throw new Error(`upload judge failed: ${lastErr}`)
}

/** Verdicts as report rows (same shape as the scanned pages, so the report shows them the same way). */
export function toRows(j: UploadJudgement, rules: ScanRule[], presentation: Map<string, unknown>): ScanResult[] {
  const byId = new Map(rules.map((r) => [r.id, r]))
  return j.verdicts.map((v) => ({
    ruleId: v.id,
    ruleTitle: byId.get(v.id)?.title || v.id,
    passed: v.answer === 'pass' || v.answer === 'na',
    reason: v.evidence,
    status: v.answer,
    checkpoint: presentation.get(v.id) as ScanResult['checkpoint'],
  }))
}
