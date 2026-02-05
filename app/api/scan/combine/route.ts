import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

interface ScanResult {
  ruleId: string
  ruleTitle: string
  passed: boolean
  reason: string
}

const CombineRequestSchema = z.object({
  results: z.array(z.object({
    ruleId: z.string(),
    ruleTitle: z.string(),
    passed: z.boolean(),
    reason: z.string(),
  })),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    // Validate request body
    const validationResult = CombineRequestSchema.safeParse(body)
    
    if (!validationResult.success) {
      const errors = validationResult.error.errors.map(err => `${err.path.join('.')}: ${err.message}`).join(', ')
      return NextResponse.json(
        { error: `Validation failed: ${errors}` },
        { status: 400 }
      )
    }

    const { results } = validationResult.data
    
    // Remove duplicates based on ruleId (keep first occurrence)
    const seenRuleIds = new Set<string>()
    const uniqueResults = results.filter(result => {
      if (seenRuleIds.has(result.ruleId)) {
        console.warn(`Duplicate result found for ruleId: ${result.ruleId}, removing duplicate`)
        return false
      }
      seenRuleIds.add(result.ruleId)
      return true
    })
    
    // Simply return the combined results (deduplicated)
    // This endpoint exists to fix Vercel 60-second timeout by ensuring
    // all batch results are combined in a final request
    return NextResponse.json({
      results: uniqueResults,
      total: uniqueResults.length,
      passed: uniqueResults.filter(r => r.passed).length,
      failed: uniqueResults.filter(r => !r.passed).length,
    })
  } catch (error) {
    console.error('Combine error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'An error occurred' },
      { status: 500 }
    )
  }
}

