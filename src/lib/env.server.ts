import 'dotenv/config'

import { z } from 'zod'

const EnvSchema = z.object({
  DATABASE_URL: z.string().trim().min(1, 'DATABASE_URL is required.'),
  AI_API_KEY: z.string().trim().min(1, 'AI_API_KEY is required.'),
  AI_API_BASE_URL: z.url('AI_API_BASE_URL must be a URL.').trim(),
  AI_MODEL: z.string().trim().min(1, 'AI_MODEL is required.'),
  AI_RESPONSE_FORMAT: z
    .enum(['json_schema', 'json_object'])
    .default('json_schema'),
})

/** Validated application environment values. */
export const env = EnvSchema.parse(process.env)
