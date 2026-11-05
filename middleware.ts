import { NextRequest, NextResponse } from "next/server";

// CORS for the scan API. Pages are served through cxo.studio/scan/*, but scan calls go
// straight to this project (lib/base.ts), so the browser sees them as cross-origin.
// /api/leads handles its own CORS.
const ALLOWED = [/^https:\/\/(www\.)?cxo\.studio$/, /^https:\/\/cxo-studio-[a-z0-9-]+\.vercel\.app$/, /^http:\/\/localhost:\d+$/];

export function middleware(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin || !ALLOWED.some((r) => r.test(origin))) return NextResponse.next();
  const headers = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (req.method === "OPTIONS") return new NextResponse(null, { status: 204, headers });
  const res = NextResponse.next();
  Object.entries(headers).forEach(([k, v]) => res.headers.set(k, v));
  return res;
}

// matched against the path after the /scan base path
export const config = { matcher: ["/api/((?!leads).*)"] };
