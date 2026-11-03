// Paths for an app that lives under /scan (next.config.js basePath).
// next/router and <Link> add the prefix themselves; raw fetch() and <img src> do not.
export const BASE = "/scan";

/** public/ file, e.g. asset("/check.png") → "/scan/check.png" */
export const asset = (p: string) => `${BASE}${p}`;

// Where the API lives. On the scanner's own hosts (audit.cxo.studio, Vercel previews,
// localhost) it is same-origin. Everywhere else the page is served through the cxo.studio
// proxy, which cuts requests at 120s while a scan batch may need 300s, so API calls go
// straight to the scanner project (CORS: middleware.ts).
// Production: the scanner's own domain. Preview builds point at their own branch URL, so
// the website preview (/start → /scan/run) talks to the scanner preview it is wired to.
export const SCANNER_ORIGIN =
  process.env.NEXT_PUBLIC_VERCEL_ENV === "preview" && process.env.NEXT_PUBLIC_VERCEL_BRANCH_URL
    ? `https://${process.env.NEXT_PUBLIC_VERCEL_BRANCH_URL}`
    : "https://audit.cxo.studio";
const isScannerHost = (h: string) =>
  h === "audit.cxo.studio" || h === "scan.cxo.studio" || h.includes("cxo-scanner") || h.startsWith("localhost") || h.startsWith("127.");

/** api("/scan") → "/scan/api/scan" or "https://audit.cxo.studio/scan/api/scan" */
export function api(p: string) {
  const origin = typeof window !== "undefined" && !isScannerHost(window.location.hostname) ? SCANNER_ORIGIN : "";
  return `${origin}${BASE}/api${p}`;
}

/** Where visitors start: the questions live on the main site. */
export const START_URL = "https://cxo.studio/start";
