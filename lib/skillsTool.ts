import { tool } from '@openrouter/sdk'
import { readFileSync, existsSync } from 'fs'
import path from 'path'
import { z } from 'zod'

const SKILLS_DIR = path.join(process.cwd(), 'skills')

/**
 * Load a skill from project's skills folder to enhance model capabilities.
 * Skill file path: skills/<skillName>/SKILL.md
 * Note: SDK expects Zod v4; we use Zod v3, so tool config is asserted for compatibility.
 */
export const loadSkillTool = tool({
  name: 'load_skill',
  description: 'Load a skill (instructions/rules) from the project to enhance capabilities. Use when you need to apply the website rule-checker audit instructions.',

  inputSchema: z.object({
    skillName: z.string().describe('Name of the skill folder, e.g. my-skill'),
  }) as unknown as Parameters<typeof tool>[0]['inputSchema'],

  outputSchema: z.string() as unknown as Parameters<typeof tool>[0]['outputSchema'],

  nextTurnParams: {
    input: (params, context) => {
      const skillName = String(params?.skillName ?? '')
      const skillPath = path.join(SKILLS_DIR, skillName, 'SKILL.md')
      if (!existsSync(skillPath)) return context.input

      const skill = readFileSync(skillPath, 'utf-8')
      const currentInput = Array.isArray(context.input) ? context.input : [context.input]

      return [
        ...currentInput,
        { role: 'user' as const, content: `[Skill: ${skillName}]\n${skill}` },
      ] as typeof context.input
    },
  },

  execute: async (params) => `Loaded skill: ${String(params?.skillName ?? '')}`,
})
