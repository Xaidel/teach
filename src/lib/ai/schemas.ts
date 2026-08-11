import { z } from 'zod'

import { HINT_LADDER_MAX_LEVEL } from '#/lib/hint-levels'
import { SandboxResultSchema } from '#/lib/sandbox/types'

/**
 * One Socratic hint at an escalation level (0: conceptual question through
 * HINT_LADDER_MAX_LEVEL: full solution, SPEC stories 22-23, issue #56). The
 * hint content is `content` per issue #23's contract (`{level, content}[]`).
 * Parsed strictly — the model's structured output is untrusted input.
 */
export const HintSchema = z
  .object({
    level: z.number().int().min(0).max(HINT_LADDER_MAX_LEVEL),
    content: z.string().trim().min(1),
  })
  .strict()

export type Hint = z.infer<typeof HintSchema>

/**
 * Input to `generateHint`: the exercise context plus the deterministic
 * Stage 1 failure diagnostics. `priorHints` carries every hint already served
 * in this attempt so escalating levels never repeat or contradict each other
 * (SPEC Implementation Decisions — AI Teacher Engine interface contract).
 */
export const GenerateHintInputSchema = z.object({
  language: z.string().min(1),
  exerciseTitle: z.string().min(1),
  exercisePrompt: z.string().min(1),
  sandboxResult: SandboxResultSchema,
  targetLevel: z.number().int().min(0).max(HINT_LADDER_MAX_LEVEL),
  priorHints: z.array(HintSchema),
})

export type GenerateHintInput = z.infer<typeof GenerateHintInputSchema>

/**
 * Input to `explainConcept`: a concept at a presentation depth (SPEC stories
 * 11-12), optionally anchored to a reference frame.
 */
export const ExplainConceptInputSchema = z.object({
  language: z.string().min(1),
  concept: z.string().min(1),
  depth: z.number().int().min(1).max(5),
  referenceFrame: z.string().optional(),
})

export type ExplainConceptInput = z.infer<typeof ExplainConceptInputSchema>

/** Structured output of `explainConcept`. Parsed strictly as model output. */
export const ExplainConceptOutputSchema = z
  .object({
    explanation: z.string().trim().min(1),
  })
  .strict()

export type ExplainConceptOutput = z.infer<typeof ExplainConceptOutputSchema>
