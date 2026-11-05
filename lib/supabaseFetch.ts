// Next.js keeps a data cache for fetch() calls on the server, POST requests included when the
// route itself is a GET (a page, a GET route handler, a cron). Supabase calls must always hit
// Supabase: a cached answer means stale lab labels, or a keep-alive that never pings.
export const noStoreFetch: typeof fetch = (input, init) => fetch(input, { ...init, cache: 'no-store' })
