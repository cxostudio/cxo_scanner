import { NextRequest } from 'next/server'
import { analyzeWebsiteStream } from '@/lib/analyzeWebsiteStream'

/** Direct HTTP entry for `analyzeWebsiteStream` — NDJSON preview + quadrants (client cannot import server Puppeteer code). */
export const runtime = 'nodejs'
/** Puppeteer nav + scroll + quadrants can exceed 60s on heavy Shopify pages. */
export const maxDuration = 120

export async function POST(request: NextRequest) {
  return analyzeWebsiteStream(request)
}
