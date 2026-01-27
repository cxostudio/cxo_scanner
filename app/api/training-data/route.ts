import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'

const trainingDataPath = path.join(process.cwd(), 'data', 'training-data.json')
const fineTuneJobsPath = path.join(process.cwd(), 'data', 'fine-tune-jobs.json')

// POST - Save training data from scan results
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { url, websiteContent, rule, result } = body

    if (!url || !websiteContent || !rule || !result) {
      return NextResponse.json(
        { error: 'Missing required fields: url, websiteContent, rule, result' },
        { status: 400 }
      )
    }

    // Ensure data directory exists
    const dataDir = path.join(process.cwd(), 'data')
    try {
      await fs.access(dataDir)
    } catch {
      await fs.mkdir(dataDir, { recursive: true })
    }

    // Read existing training data
    let existingData: any[] = []
    try {
      await fs.access(trainingDataPath)
      const fileContents = await fs.readFile(trainingDataPath, 'utf8')
      existingData = JSON.parse(fileContents)
    } catch {
      existingData = []
    }

    // Add new training example
    const trainingExample = {
      url,
      websiteContent: websiteContent.substring(0, 2000), // Limit content size
      rule: {
        id: rule.id,
        title: rule.title,
        description: rule.description,
      },
      expectedResult: {
        passed: result.passed,
        reason: result.reason,
      },
      timestamp: new Date().toISOString(),
    }

    existingData.push(trainingExample)

    // Save updated training data
    await fs.writeFile(
      trainingDataPath,
      JSON.stringify(existingData, null, 2),
      'utf8'
    )

    // Fine-tuning code commented out - training data will be saved but fine-tuning won't trigger automatically
    // Automatically trigger fine-tuning if we have 1+ examples
    // let trainingStarted = false
    // if (existingData.length >= 1) {
    //   try {
    //     const OpenAI = (await import('openai')).default
    //     let apiKey = process.env.OPENAI_API_KEY
    //     if (!apiKey) {
    //       const openRouterKey = process.env.OPENROUTER_API_KEY
    //       if (openRouterKey && !openRouterKey.startsWith('sk-or-v1')) {
    //         apiKey = openRouterKey
    //       }
    //     }
    //     
    //     if (apiKey) {
    //       const openai = new OpenAI({ apiKey })
    //       
    //       // Convert to OpenAI format
    //       const convertToOpenAIFormat = (data: any[]) => {
    //         return data.map(example => ({
    //           messages: [
    //             {
    //               role: 'system',
    //               content: 'You are an expert website analyzer. Analyze websites based on rules and determine if they pass or fail. Provide detailed explanations in Hindi/English mix.'
    //             },
    //             {
    //               role: 'user',
    //               content: `URL: ${example.url}\n\nWebsite Content: ${example.websiteContent}\n\nRule: ${example.rule.title}\nDescription: ${example.rule.description}\n\nAnalyze if this rule is met.`
    //             },
    //             {
    //               role: 'assistant',
    //               content: `Passed: ${example.expectedResult.passed}\nReason: ${example.expectedResult.reason}`
    //             }
    //           ]
    //         }))
    //       }
    //       
    //       const formattedData = convertToOpenAIFormat(existingData)
    //       const jsonlContent = formattedData.map(item => JSON.stringify(item)).join('\n')
    //       const jsonlPath = path.join(process.cwd(), 'data', 'training-data.jsonl')
    //       await fs.writeFile(jsonlPath, jsonlContent, 'utf8')
    //       
    //       // Upload file to OpenAI
    //       const fileBuffer = await fs.readFile(jsonlPath)
    //       const file = await openai.files.create({
    //         file: new File([fileBuffer], 'training-data.jsonl', { type: 'application/jsonl' }),
    //         purpose: 'fine-tune',
    //       })
    //       
    //       // Start fine-tuning job
    //       // Note: gpt-4o-mini-search-preview is NOT available for fine-tuning
    //       // Using gpt-4o-mini instead (which is supported for fine-tuning)
    //       const fineTuneJob = await openai.fineTuning.jobs.create({
    //         training_file: file.id,
    //         model: 'gpt-4o-mini', // Supported model for fine-tuning
    //         hyperparameters: { n_epochs: 3 },
    //       })
    //       
    //       // Save job info
    //       let jobs: any[] = []
    //       try {
    //         await fs.access(fineTuneJobsPath)
    //         const jobsContent = await fs.readFile(fineTuneJobsPath, 'utf8')
    //         jobs = JSON.parse(jobsContent)
    //       } catch {
    //         jobs = []
    //       }
    //       
    //       jobs.push({
    //         id: fineTuneJob.id,
    //         status: fineTuneJob.status,
    //         model: fineTuneJob.model,
    //         createdAt: new Date().toISOString(),
    //         trainingFileId: file.id,
    //         trainingExamplesCount: existingData.length,
    //       })
    //       
    //       await fs.writeFile(
    //         fineTuneJobsPath,
    //         JSON.stringify(jobs, null, 2),
    //         'utf8'
    //       )
    //       
    //       trainingStarted = true
    //       console.log('Training automatically started:', fineTuneJob.id)
    //     }
    //   } catch (trainingError) {
    //     console.error('Error starting automatic training:', trainingError)
    //   }
    // }
    const trainingStarted = false

    return NextResponse.json({
      success: true,
      message: `Training example added. Total examples: ${existingData.length}${trainingStarted ? '. Fine-tuning started automatically!' : ''}`,
      count: existingData.length,
      trainingStarted,
    })
  } catch (error) {
    console.error('Error saving training data:', error)
    return NextResponse.json(
      { error: 'Failed to save training data' },
      { status: 500 }
    )
  }
}

// GET - Get all training data
export async function GET() {
  try {
    let trainingData: any[] = []
    try {
      await fs.access(trainingDataPath)
      const fileContents = await fs.readFile(trainingDataPath, 'utf8')
      trainingData = JSON.parse(fileContents)
    } catch {
      trainingData = []
    }

    return NextResponse.json({
      count: trainingData.length,
      data: trainingData,
    })
  } catch (error) {
    console.error('Error reading training data:', error)
    return NextResponse.json(
      { error: 'Failed to read training data' },
      { status: 500 }
    )
  }
}

// DELETE - Clear all training data
export async function DELETE() {
  try {
    try {
      await fs.unlink(trainingDataPath)
    } catch {
      // File doesn't exist, that's okay
    }

    return NextResponse.json({
      success: true,
      message: 'All training data cleared',
    })
  } catch (error) {
    console.error('Error clearing training data:', error)
    return NextResponse.json(
      { error: 'Failed to clear training data' },
      { status: 500 }
    )
  }
}

