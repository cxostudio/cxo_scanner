// One place for the "Book a call" link: cxo.studio/call (FR /fr/call), our page with the Cal.com
// calendar embedded (cxo-studio CallPage.astro). Its ?name, ?email, ?store and ?source pre-fill the
// booking and come back in the Cal.com webhook (app/api/cal/webhook), so every booking says where it came from.
export const CAL_URL = 'https://cal.com/louis-grommen/30min'

export type CallSource = 'free-scan' | 'report' | 'email-results' | 'email-call1' | 'email-call2' | 'reminder' | 'admin' | 'site'

export function callLink(opts: { source: CallSource; email?: string | null; name?: string | null; store?: string | null; locale?: string | null } = { source: 'site' }): string {
  const u = new URL(`https://cxo.studio${opts.locale === 'fr' ? '/fr' : ''}/call`)
  if (opts.name) u.searchParams.set('name', opts.name)
  if (opts.email) u.searchParams.set('email', opts.email)
  if (opts.store) u.searchParams.set('store', opts.store)
  u.searchParams.set('source', opts.source)
  return u.toString()
}
