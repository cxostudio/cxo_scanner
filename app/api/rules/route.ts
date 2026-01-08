import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import { z } from 'zod'

const RuleSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().min(1),
})

const RulesArraySchema = z.array(RuleSchema)

// Path to the predefined rules JSON file
const rulesFilePath = path.join(process.cwd(), 'data', 'predefined-rules.json')

// GET - Read rules from JSON file
export async function GET() {
  try {
    const fileContents = await fs.readFile(rulesFilePath, 'utf8')
    const rules = JSON.parse(fileContents)
    
    // Validate with Zod
    const validatedRules = RulesArraySchema.parse(rules)
    
    return NextResponse.json({ rules: validatedRules })
  } catch (error) {
    console.error('Error reading rules:', error)
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid rules format in JSON file', details: error.errors },
        { status: 500 }
      )
    }
    
    // If file doesn't exist, return empty array
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return NextResponse.json({ rules: [] })
    }
    
    return NextResponse.json(
      { error: 'Failed to read rules file' },
      { status: 500 }
    )
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

