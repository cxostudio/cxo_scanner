import { NextResponse } from 'next/server'

/** Which optional integrations are configured on this deployment. Booleans only, never values. */
export async function GET() {
  return NextResponse.json({
    browserbaseKey: Boolean(process.env.BROWSERBASE_API_KEY),
    browserbaseProject: Boolean(process.env.BROWSERBASE_PROJECT_ID),
    env: process.env.VERCEL_ENV || 'local',
  })
}
