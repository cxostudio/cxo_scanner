// OpenRouter AI service for scanning
import { OpenRouter } from '@openrouter/sdk'
import { Rule, ScanResult } from './types'

export interface AIServiceConfig {
  apiKey: string
}

export function createAIService(config: AIServiceConfig) {
  return new OpenRouter({ apiKey: config.apiKey })
}

export async function scanWithAI(
  openRouter: OpenRouter,
  rule: Rule,
  context: {
    url: string
    visibleText: string
    keyElements: string
    screenshotDataUrl: string | null
  }
): Promise<ScanResult> {
  const { url, visibleText, keyElements, screenshotDataUrl } = context

  const messages: any[] = [
    {
      role: 'system',
      content: `You are a precise website analyzer. Analyze the provided website content and screenshot against the given rule.

Respond ONLY with a JSON object in this exact format:
{
  "passed": true/false,
  "reason": "Detailed explanation of why it passed or failed"
}

Be thorough but concise. If the rule requires visual elements, check the screenshot carefully.`,
    },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Rule to check: "${rule.title}"
Description: ${rule.description}

Website URL: ${url}

Page Content Preview:
${visibleText.slice(0, 8000)}

Key Elements Found:
${keyElements}

Analyze if this website meets the rule requirements. Return only the JSON response.`,
        },
        ...(screenshotDataUrl
          ? [
            {
              type: 'image_url',
              image_url: { url: screenshotDataUrl },
            },
          ]
          : []),
      ],
    },
  ]

  const chatCompletion = await openRouter.chat.send({
    model: 'google/gemini-2.0-flash-001',
    messages,
    temperature: 0.1,
    maxTokens: 1000,
  })

  // Extract response text from various possible structures
  let responseText = ''
  if ((chatCompletion as any)?.choices?.[0]?.message?.content) {
    responseText = (chatCompletion as any).choices[0].message.content
  } else if ((chatCompletion as any)?.message?.content) {
    responseText = (chatCompletion as any).message.content
  } else {
    responseText = String(chatCompletion)
  }

  // Extract JSON from response
  const jsonMatch = responseText.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error('Invalid AI response format')
  }

  const result = JSON.parse(jsonMatch[0])

  return {
    ruleId: rule.id,
    ruleTitle: rule.title,
    passed: result.passed ?? false,
    reason: result.reason || 'No reason provided',
  }
}
