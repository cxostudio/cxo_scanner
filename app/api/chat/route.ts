import { NextRequest, NextResponse } from 'next/server'
import { OpenRouter } from '@openrouter/sdk'
import { loadSkillTool } from '@/lib/skillsTool'

/**
 * Chat API that uses callModel with the load_skill tool.
 * When the model determines it needs the rule-checker instructions, it can call load_skill('my-skill')
 * and the skill content will be injected into the conversation.
 *
 * POST body: { "message": "Load my custom skill and help me evaluate a rule..." }
 */
export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OPENROUTER_API_KEY is not set in .env.local' },
        { status: 500 }
      )
    }

    const body = await request.json()
    const message = typeof body?.message === 'string' ? body.message : 'Load the rule-checker skill (my-skill) and help me with a website audit task.'

    const openRouter = new OpenRouter({ apiKey })

    const result = await openRouter.callModel({
      model: process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash-lite',
      input: [{ role: 'user', content: message }],
      tools: [loadSkillTool],
      reasoning: { effort: 'medium' },
      maxTokens: 1024,
    })

    const responseText = await result.getText()
    return NextResponse.json({ response: responseText })
  } catch (error) {
    console.error('Chat API error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Chat request failed' },
      { status: 500 }
    )
  }
}
