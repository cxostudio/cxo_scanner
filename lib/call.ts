// One place for the "Book a call" link (Cal.com, 30 minutes with Louis). Public link, no secret.
// Cal.com pre-fills name and email from the URL, and hands metadata[...] back in its webhook
// (app/api/cal/webhook), so every booking says where it came from.
export const CAL_URL = 'https://cal.com/louis-grommen/30min'

export type CallSource = 'free-scan' | 'report' | 'email-results' | 'email-call1' | 'email-call2' | 'reminder' | 'admin' | 'site'

export function callLink(opts: { source: CallSource; email?: string | null; name?: string | null; store?: string | null } = { source: 'site' }): string {
  const u = new URL(CAL_URL)
  if (opts.name) u.searchParams.set('name', opts.name)
  if (opts.email) u.searchParams.set('email', opts.email)
  u.searchParams.set('metadata[source]', opts.source)
  if (opts.store) u.searchParams.set('metadata[store]', opts.store)
  return u.toString()
}
