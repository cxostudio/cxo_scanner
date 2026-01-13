import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { promises as fs } from 'fs'
import path from 'path'

const trainingDataPath = path.join(process.cwd(), 'data', 'training-data.json')
const fineTuneJobsPath = path.join(process.cwd(), 'data', 'fine-tune-jobs.json')

// Get OpenAI client (supports both OpenAI and OpenRouter keys if OpenAI format)
function getOpenAIClient() {
  let apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    const openRouterKey = process.env.OPENROUTER_API_KEY
    if (openRouterKey && !openRouterKey.startsWith('sk-or-v1')) {
      apiKey = openRouterKey
    }
  }
  
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured. Note: OpenRouter keys (sk-or-v1-...) cannot be used for fine-tuning.')
  }
  return new OpenAI({ apiKey })
}

// Convert training data to OpenAI fine-tuning format
function convertToOpenAIFormat(trainingData: any[]) {
  return trainingData.map(example => ({
    messages: [
      {
        role: 'system',
        content: 'You are an expert website analyzer. Analyze websites based on rules and determine if they pass or fail. Provide detailed explanations in Hindi/English mix.'
      },
      {
        role: 'user',
        content: `URL: ${example.url}\n\nWebsite Content: ${example.websiteContent}\n\nRule: ${example.rule.title}\nDescription: ${example.rule.description}\n\nAnalyze if this rule is met.`
      },
      {
        role: 'assistant',
        content: `Passed: ${example.expectedResult.passed}\nReason: ${example.expectedResult.reason}`
      }
    ]
  }))
}

// POST - Start fine-tuning job
export async function POST(request: NextRequest) {
  try {
    const openai = getOpenAIClient()

    // Read training data
    let trainingData: any[] = []
    try {
      await fs.access(trainingDataPath)
      const fileContents = await fs.readFile(trainingDataPath, 'utf8')
      trainingData = JSON.parse(fileContents)
    } catch (error) {
      return NextResponse.json(
        { error: 'No training data found. Please add training examples first.' },
        { status: 400 }
      )
    }

    if (trainingData.length < 1) {
      return NextResponse.json(
        { error: 'Need at least 1 training example to start fine-tuning. Current count: ' + trainingData.length },
        { status: 400 }
      )
    }

    // Convert to OpenAI format
    const formattedData = convertToOpenAIFormat(trainingData)

    // Create JSONL file (OpenAI fine-tuning format)
    const jsonlContent = formattedData.map(item => JSON.stringify(item)).join('\n')
    const jsonlPath = path.join(process.cwd(), 'data', 'training-data.jsonl')
    await fs.writeFile(jsonlPath, jsonlContent, 'utf8')

    // Upload file to OpenAI
    const fileBuffer = await fs.readFile(jsonlPath)
    const fileBlob = new Blob([fileBuffer], { type: 'application/jsonl' })
    const file = await openai.files.create({
      file: fileBlob as any,
      purpose: 'fine-tune',
    })

    console.log('File uploaded:', file.id)

    // Start fine-tuning job
    // Note: gpt-4o-mini-search-preview is NOT available for fine-tuning
    // Using gpt-4o-mini instead (which is supported for fine-tuning)
    const fineTuneJob = await openai.fineTuning.jobs.create({
      training_file: file.id,
      model: 'gpt-4o-mini', // Supported model for fine-tuning
      hyperparameters: {
        n_epochs: 3,
      },
    })

    console.log('Fine-tuning job started:', fineTuneJob.id)

    // Save job info
    let jobs: any[] = []
    try {
      await fs.access(fineTuneJobsPath)
      const jobsContent = await fs.readFile(fineTuneJobsPath, 'utf8')
      jobs = JSON.parse(jobsContent)
    } catch {
      jobs = []
    }

    jobs.push({
      id: fineTuneJob.id,
      status: fineTuneJob.status,
      model: fineTuneJob.model,
      createdAt: new Date().toISOString(),
      trainingFileId: file.id,
      trainingExamplesCount: trainingData.length,
    })

    await fs.writeFile(
      fineTuneJobsPath,
      JSON.stringify(jobs, null, 2),
      'utf8'
    )

    return NextResponse.json({
      success: true,
      message: 'Fine-tuning job started successfully',
      jobId: fineTuneJob.id,
      status: fineTuneJob.status,
      trainingExamples: trainingData.length,
    })
  } catch (error) {
    console.error('Error starting fine-tuning:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start fine-tuning' },
      { status: 500 }
    )
  }
}

// GET - List all fine-tuning jobs
export async function GET() {
  try {
    let jobs: any[] = []
    try {
      await fs.access(fineTuneJobsPath)
      const jobsContent = await fs.readFile(fineTuneJobsPath, 'utf8')
      jobs = JSON.parse(jobsContent)
    } catch {
      jobs = []
    }

    // If OpenAI API key is available, fetch latest status for each job
    try {
      const openai = getOpenAIClient()
      for (let i = 0; i < jobs.length; i++) {
        try {
          const job = await openai.fineTuning.jobs.retrieve(jobs[i].id)
          jobs[i].status = job.status
          jobs[i].fineTunedModel = job.fine_tuned_model || null
          jobs[i].updatedAt = new Date().toISOString()
        } catch (err) {
          console.error(`Error fetching job ${jobs[i].id}:`, err)
        }
      }
    } catch (err) {
      // API key not configured, that's okay
    }

    return NextResponse.json({ jobs })
  } catch (error) {
    console.error('Error listing fine-tuning jobs:', error)
    return NextResponse.json(
      { error: 'Failed to list fine-tuning jobs' },
      { status: 500 }
    )
  }
}

