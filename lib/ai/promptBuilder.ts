type BuildRulePromptArgs = {
  url: string
  contentForAI: string
  ruleId: string
  ruleTitle: string
  ruleDescription: string
  specialInstructions?: string
  ruleSpecificPrefix?: string
}

export function buildRulePrompt(args: BuildRulePromptArgs): string {
  const {
    url,
    contentForAI,
    ruleId,
    ruleTitle,
    ruleDescription,
    specialInstructions,
    ruleSpecificPrefix,
  } = args

  return `
You are a strict website UX rule checker.

You MUST respond with ONLY valid JSON in this exact shape:
{"passed": true|false, "reason": "single concise sentence"}

The "reason" must be plain, simple English for non-technical users.
If the rule is not relevant to this page type, set passed to true and briefly say it is not relevant.

No markdown. No extra keys.

URL: ${url}

Rule:
- id: ${ruleId}
- title: ${ruleTitle}
- description: ${ruleDescription}

${(specialInstructions || '').trim()}

${(ruleSpecificPrefix || '').trim()}

KEY ELEMENTS / PAGE CONTENT (may be incomplete; screenshot may be provided separately by the system):
${contentForAI}
`.trim()
}

