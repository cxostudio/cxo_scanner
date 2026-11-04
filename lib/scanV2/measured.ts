// Checkpoints that are facts, not opinions: measured in the page code so they never vary
// between runs. Each returns a verdict, or null to leave the call to the model
// (when the measurement is not conclusive).
import type { Evidence } from './capture'
import type { Verdict } from './judge'

type F = Record<string, any>
type Measure = (ev: Evidence, f: F) => Omit<Verdict, 'id'> | null

const SOCIAL = /instagram|facebook|tiktok|youtube|pinterest|linkedin|twitter|x\.com|threads/i
const SEARCH = /search|zoek|recherch|buscar|busca|suche|cerca|szukaj|sök|søg/i

export const MEASURED: Record<string, Measure> = {
  // Do you use pure black for text or backgrounds? (pass = no pure black)
  recSs12TogM60Mf6w: (_ev, f) => {
    const t = f.pureBlack?.textElements
    const b = f.pureBlack?.backgroundElements
    if (typeof t !== 'number') return null
    if (t >= 10 || b >= 3)
      return { answer: 'fail', evidence: `Pure black (#000000) is used on ${t} text elements${b ? ` and ${b} backgrounds` : ''}. A soft dark tone like #222 reads easier.` }
    if (t <= 3 && b <= 1) return { answer: 'pass', evidence: 'Text and backgrounds use softer dark tones, not pure black.' }
    return null
  },

  // Is lazy loading enabled for images and videos?
  rec3kmxGigBELSAlu: (_ev, f) => {
    const total = f.images?.total
    const lazy = f.images?.lazyLoaded
    if (typeof total !== 'number' || total < 5) return null
    const share = lazy / total
    if (share >= 0.3) return { answer: 'pass', evidence: `${lazy} of ${total} images load only when needed (lazy loading).` }
    return { answer: 'fail', evidence: `Only ${lazy} of ${total} images are lazy loaded, so the page downloads images shoppers may never see.` }
  },

  // Does the footer display social media links?
  recXqQmYLbyuIil2a: (_ev, f) => {
    if (!f.footer) return null
    const hosts = Array.from(new Set((f.footer.links as string[]).map((l) => (l.match(SOCIAL) || [])[0]).filter(Boolean))) as string[]
    if (hosts.length) return { answer: 'pass', evidence: `The footer links to ${hosts.map((h) => h[0].toUpperCase() + h.slice(1).toLowerCase()).join(', ')}.` }
    return null
  },

  // Is there a visible newsletter subscription form in the footer?
  recjK9IQ0T4rpu4iu: (_ev, f) => {
    if (!f.footer) return null
    if ((f.footer.inputs as string[]).some((i) => /^email|mail|newsletter|subscribe/i.test(i))) return { answer: 'pass', evidence: 'The footer has an email field to join the newsletter.' }
    return null
  },

  // Does the cart icon display the number of items currently in the cart?
  recdkYxD8QVU9j14p: (ev) => {
    const m = ev.cartTest?.match(/cart icon now shows "(\d+)"/)
    if (m && Number(m[1]) >= 1) return { answer: 'pass', evidence: `After adding a product, the cart icon shows "${m[1]}".` }
    return null
  },

  // Does the footer have a "Back to Top" button for easy navigation?
  recKjEZrP38rjqCoY: (_ev, f) => {
    if (f.backToTopControl === true) return { answer: 'pass', evidence: 'There is a back to top control at the bottom of the page.' }
    if (f.backToTopControl === false && f.footer) return { answer: 'fail', evidence: 'There is no back to top button, so long pages need a lot of scrolling back up.' }
    return null
  },

  // Is there a clear and accessible "Search" button or icon?
  recjEVPpCRkdi17EE: (_ev, f) => {
    const controls: string[] = f.header?.controls || []
    if (controls.some((c) => SEARCH.test(c))) return { answer: 'pass', evidence: 'The header has a search icon or field.' }
    return null
  },

  // Is the logo clickable and linked to the homepage?
  recYUxusypKnfViyM: (ev, f) => {
    const controls: string[] = f.header?.controls || []
    let origin = ''
    try {
      origin = new URL(ev.finalUrl).origin
    } catch {}
    const home = controls.find((c) => /logo/i.test(c) && (/ href=\/(\s|$)/.test(c) || / href=\/[a-z]{2}(-[a-z]{2})?\/?(\s|$)/i.test(c) || (origin && c.includes(` href=${origin}/ `)) || (origin && new RegExp(` href=${origin.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}/?(\\s|$)`).test(c))))
    if (home) return { answer: 'pass', evidence: 'The logo links back to the homepage.' }
    return null
  },
}
