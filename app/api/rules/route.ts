import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { z } from 'zod'
import { getConversionCheckpointRules } from '@/lib/conversionCheckpoints/getCheckpointRules'

export const dynamic = 'force-dynamic'

const RuleSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().min(1),
})

const RulesArraySchema = z.array(RuleSchema)

const rulesFilePath = path.join(process.cwd(), 'data', 'predefined-rules.json')

// GET — rules from Airtable conversion-checkpoints (same source as /api/conversion-checkpoints)
export async function GET() {
  try {
    const result = await getConversionCheckpointRules()
    if (!result.ok) {
      return NextResponse.json(result.body, { status: result.status })
    }
    const validatedRules = RulesArraySchema.parse(result.rules)
    console.log('[api/rules] conversion-checkpoints count:', validatedRules.length)
    return NextResponse.json({ rules: validatedRules })
  } catch (error) {
    console.error('Error loading conversion-checkpoint rules:', error)

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid rules format from Airtable', details: error.errors },
        { status: 500 },
      )
    }

    return NextResponse.json({ error: 'Failed to load rules' }, { status: 500 })
  }
}

// POST - Write rules to JSON file
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    // Validate request body
    const validationResult = RulesArraySchema.safeParse(body.rules)
    
    if (!validationResult.success) {
      return NextResponse.json(
        { error: 'Invalid rules format', details: validationResult.error.errors },
        { status: 400 }
      )
    }
    
    const validatedRules = validationResult.data
    
    // Ensure data directory exists
    const dataDir = path.join(process.cwd(), 'data')
    try {
      await fs.access(dataDir)
    } catch {
      // Directory doesn't exist, create it
      await fs.mkdir(dataDir, { recursive: true })
    }
    
    // Write to file
    await fs.writeFile(
      rulesFilePath,
      JSON.stringify(validatedRules, null, 2),
      'utf8'
    )
    
    return NextResponse.json({ 
      success: true, 
      message: 'Rules saved successfully',
      count: validatedRules.length 
    })
  } catch (error) {
    console.error('Error writing rules:', error)
    return NextResponse.json(
      { error: 'Failed to save rules file' },
      { status: 500 }
    )
  }
}