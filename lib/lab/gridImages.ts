// Which screenshots of a lab scan show a checkpoint: the same choice the labelling page makes
// (checkout, cart, gallery, mobile menu, mobile or desktop), up to three images.
import type { LabCheckpoint } from './store'

const CART = 'recdyiscpsbfrbbha'
const CHECKOUT = 'recokhtzh3nxsqnmb'
type Tab = 'desktop' | 'mobile' | 'menu' | 'gallery' | 'cart' | 'checkout'

export const tabOf = (label: string): Tab =>
  /CHECKOUT/.test(label) ? 'checkout' : /^gallery overview/.test(label) ? 'gallery' : /MENU opened/.test(label) ? 'menu' : /cart (view|page)|CART PAGE|cart drawer|header AFTER|EMPTY cart/i.test(label) ? 'cart' : /^mobile/i.test(label) ? 'mobile' : 'desktop'

export function tabFor(cp: LabCheckpoint, labels: string[]): Tab {
  const types = (cp.pageTypeIds || []).map((x) => x.toLowerCase())
  if (types.includes(CHECKOUT)) return 'checkout'
  if (types.includes(CART) || cp.area === 'Cart drawer') return 'cart'
  if (cp.area === 'Gallery' && labels.some((l) => tabOf(l) === 'gallery')) return 'gallery'
  if (/menu|navigation/i.test(cp.title) && /mobile/i.test(`${cp.title} ${cp.device}`)) return 'menu'
  if (cp.device === 'Mobile only') return 'mobile'
  return 'desktop'
}

/** Indexes of the images to show: those the scanner said it saw the answer in, else the checkpoint's tab. */
export function pickImages(cp: LabCheckpoint, labels: string[], seen?: string[]): number[] {
  if (seen?.length) {
    const hit = labels.map((l, i) => (seen.some((s) => l.includes(s) || s.includes(l)) ? i : -1)).filter((i) => i >= 0)
    if (hit.length) return hit.slice(0, 3)
  }
  const tab = tabFor(cp, labels)
  const idx = labels.map((l, i) => (tabOf(l) === tab ? i : -1)).filter((i) => i >= 0)
  if (tab === 'cart') idx.sort((a, b) => rank(labels[a]) - rank(labels[b]))
  return idx.slice(0, 3)
}
const rank = (label: string) => (/EMPTY cart/.test(label) ? 0 : /cart view/i.test(label) ? 1 : /CART PAGE/.test(label) ? 2 : 3)
