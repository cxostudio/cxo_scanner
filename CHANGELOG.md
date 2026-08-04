# Changelog

All notable changes to the CXO Scanner are recorded here.

This file is maintained by hand — when a feature or fix is finished, add an entry
under **Unreleased**. Group changes under `Added`, `Changed`, `Fixed`, `Removed`,
or `Security`. Newest section goes on top.

**Commit references.** Every entry carries the short commit hash it landed in,
written as `` `abc1234` `` at the end of the line. When a whole block of changes
shipped in one commit, the hash goes on a `Commit:` line under the heading instead
of on each bullet. Entries that are written before the work is committed use
`pending` — replace it with the real hash once the commit exists. Never guess a
hash; an entry with no commit yet says `pending`.

---

## [Unreleased]

### Changed — dependency upgrades (branch: `package_updates`, 2026-08-04)

**Commit:** `a063e03`

Major-version moves:

| Package | From | To |
| --- | --- | --- |
| `next` | 14.2.5 | 15.5.22 |
| `react` / `react-dom` | ^18.3.1 | ^19.2.8 |
| `zod` | ^3.25.76 | ^4.4.3 |
| `typescript` | ^5.5.3 | ^6.0.3 |
| `lucide-react` | ^0.562.0 | ^1.28.0 |
| `eslint-config-next` | 14.2.5 | 15.5.22 |
| `@types/node` | ^20.14.10 | ^24.13.3 |
| `@types/react` | ^18.3.3 | ^19.2.18 |
| `@types/react-dom` | ^18.3.0 | ^19.2.4 |

Minor / patch moves:

| Package | From | To |
| --- | --- | --- |
| `@sparticuz/chromium` | ^141.0.0 | ^148.0.0 |
| `puppeteer` / `puppeteer-core` | ^24.40.0 | ^24.43.1 |
| `@supabase/supabase-js` | ^2.110.8 | ^2.112.0 |
| `@openrouter/sdk` | ^0.3.12 | ^0.3.16 |
| `framer-motion` | ^12.38.0 | ^12.43.0 |
| `react-toastify` | ^11.0.5 | ^11.1.0 |
| `tailwindcss` / `@tailwindcss/postcss` | ^4.1.18 | ^4.3.3 |
| `postcss` | ^8.5.6 | ^8.5.25 |
| `autoprefixer` | ^10.4.23 | ^10.5.4 |

Unchanged: `@emailjs/browser`, `react-markdown`, `eslint`.

### Removed — unused dependencies

**Commit:** `pending`

Dropped nine packages that were no longer imported anywhere:

- `@ai-sdk/openai`, `ai`, `openai` — superseded by `@openrouter/sdk` for all AI evaluation
- `flowbite`, `flowbite-react` — UI components no longer used
- `puppeteer-extra`, `puppeteer-extra-plugin-stealth` — stealth plugins removed from the scan path
- `tesseract.js` — OCR path removed
- `node-fetch` — native `fetch` used instead

### Changed — code updates required by the upgrades

**Commit:** `pending`

- **`next.config.js`**: renamed `experimental.serverComponentsExternalPackages` to the
  now-stable `serverExternalPackages` (Next 15 promoted the key out of `experimental`).
  Dropped `tesseract.js` from the list along with the package. `puppeteer`,
  `puppeteer-core`, and `@sparticuz/chromium` must stay listed or serverless
  bundling breaks.
- **Zod v4 compatibility**: switched every import from `zod` to `zod/v3` in
  `lib/skillsTool.ts`, `app/api/rules/route.ts`, `app/api/scan/route.ts`,
  `app/api/scan/combine/route.ts`, `app/page.tsx`, and `app/scanner/page.tsx`.
  This uses the v3 compatibility layer shipped inside zod v4 — the schemas
  themselves have not been migrated to the v4 API yet.
- **`css.d.ts`** (new): declares `*.css` modules. TypeScript 6 requires an explicit
  declaration for side-effect CSS imports such as `import './globals.css'` in
  `app/layout.tsx`.
- **`.eslintrc.json`** (new): extends `next/core-web-vitals` and turns off
  `@next/next/no-img-element`.
- **Escaped apostrophes** in `app/page.tsx` and `app/scanner/page.tsx` — replaced
  literal `'` with `&apos;` in JSX copy to satisfy `react/no-unescaped-entities`.
- **`.gitignore`**: added `.playwright-mcp`, `.agents/`, `.claude/`, `CLAUDE.md`,
  `package-lock.json`, and `skills-lock.json`.

### Verification

**Commit:** `pending`

- `npm run build` passes on Next 15.5.22 / React 19.2.8 / zod 4.4.3 — compiles and
  type-checks clean across all 16 routes.
- `puppeteer-core` 24.43.1 bundles Chrome 148.0.7778.97 and `@sparticuz/chromium`
  is 148.0.0 — versions aligned, which is the pairing that breaks serverless
  Puppeteer when it drifts.
- No `cookies()` / `headers()` / `draftMode()` or page-level `params` /
  `searchParams` usage, so Next 15's async-request-API change does not apply.
- No `defaultProps`, `propTypes`, or legacy `ReactDOM.render` / `findDOMNode`
  remaining, so React 19's removals do not apply.
- Not yet verified: the Puppeteer scan path at runtime, either locally or on a
  Vercel preview. The build does not launch Chromium.

### Notes / follow-ups

- `package-lock.json` was added to `.gitignore`, but the file is still tracked, so
  the entry has no effect and the lockfile still commits normally. The line is
  misleading and should be removed rather than acted on.
- The `zod/v3` imports are a compatibility shim, not a migration. A real move to the
  v4 API is still outstanding.
- `CLAUDE.md` describes `serverComponentsExternalPackages`; that note is now stale
  against Next 15. The file is untracked, so it does not reach other clones.
