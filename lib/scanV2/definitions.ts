// CXO Studio's checkpoint definitions: when a checkpoint passes, fails or is not relevant,
// per niche and device. Draft v1, under review in the "checkpoint definitions" Google Sheet;
// once approved they move to Airtable fields and this file is generated from there.
import drafts from './definitions.draft.json'

export type Definition = {
  id: string
  q: string
  rec: string
  new_q: string
  area: string
  device: 'Both' | 'Desktop' | 'Mobile'
  method: string
  pass: string
  fail: string
  na: string
  niche: string
}

const BY_ID = new Map((drafts as Definition[]).map((d) => [d.id, d]))

export const definitionFor = (id: string): Definition | undefined => BY_ID.get(id)
