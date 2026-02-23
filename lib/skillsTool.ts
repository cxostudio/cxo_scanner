import { tool } from '@openrouter/sdk'
import { readFileSync, existsSync } from 'fs'
import path from 'path'
import { z } from 'zod'

const SKILLS_DIR = path.join(process.cwd(), 'skills')

/**
 * Load a skill from project's skills folder to enhance model capabilities.
 * Skill file path: skills/<skillName>/SKILL.md
 */
export const loadSkillTool = tool({
  name: 'load_skill',
  description: 'Load a skill (instructions/rules) from the project to enhance capabilities. Use when you need to apply the website rule-checker audit instructions.',

  inputSchema: z.object({
    skillName: z.string().describe('Name of the skill folder, e.g. my-skill'),
  }),

  outputSchema: z.string(),

  nextTurnParams: {
    input: (params, context) => {
      const skillPath = path.join(SKILLS_DIR, params.skillName, 'SKILL.md')
      if (!existsSync(skillPath)) return context.input

      const skill = readFileSync(skillPath, 'utf-8')
      const currentInput = Array.isArray(context.input) ? context.input : [context.input]

      return [
        ...currentInput,
        {
          role: 'user' as const,
          content: `[Skill: ${params.skillName}]\n${skill}`,
        },
      ]
    },
  },

  execute: async (params) => `Loaded skill: ${params.skillName}`,
})
