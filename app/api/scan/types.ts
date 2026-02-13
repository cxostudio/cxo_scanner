// Types and Zod schemas for scan API
import { z } from 'zod'

export interface Rule {
  id: string
  title: string
  description: string
}

export interface ScanResult {
  ruleId: string
  ruleTitle: string
  passed: boolean
  reason: string
}

// Zod schemas for validation
export const RuleSchema = z.object({
  id: z.string().min(1, 'Rule ID is required'),
  title: z.string().min(1, 'Rule title is required').max(200, 'Rule title must be less than 200 characters'),
  description: z.string().min(1, 'Rule description is required').max(5000, 'Rule description must be less than 5000 characters'),
})

export const ScanRequestSchema = z.object({
  url: z.string()
    .min(1, 'URL is required')
    .url('Invalid URL format')
    .refine((url) => {
      try {
        const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`)
        return ['http:', 'https:'].includes(urlObj.protocol)
      } catch {
        return false
      }
    }, 'URL must be a valid HTTP or HTTPS URL'),
  rules: z.array(RuleSchema)
    .min(1, 'At least one rule is required')
    .max(100, 'Maximum 100 rules allowed per scan'),
  captureScreenshot: z.boolean().optional().default(true),
})

export type ScanRequestData = z.infer<typeof ScanRequestSchema>
