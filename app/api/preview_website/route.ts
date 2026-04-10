import { NextRequest } from 'next/server'
import { analyzeWebsiteStream } from '@/lib/analyzeWebsiteStream'

/** Direct HTTP entry for `analyzeWebsiteStream` — NDJSON preview + quadrants (client cannot import server Puppeteer code). */
export async function POST(request: NextRequest) {
  return analyzeWebsiteStream(request)
}
