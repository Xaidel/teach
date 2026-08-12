import { z } from 'zod'

import { HINT_LADDER_MAX_LEVEL } from '#/lib/hint-levels'
import { SANDBOX_LANGUAGES, SandboxResultSchema } from '#/lib/sandbox/types'

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
 * `referenceSolution` is the Pre-Flight-verified solution the Prompt Shield
 * compares hint output against (ADR-0008, ADR-0012).
 */
export const GenerateHintInputSchema = z.object({
  language: z.enum(SANDBOX_LANGUAGES),
  exerciseTitle: z.string().min(1),
  exercisePrompt: z.string().min(1),
  sandboxResult: SandboxResultSchema,
  targetLevel: z.number().int().min(0).max(HINT_LADDER_MAX_LEVEL),
  priorHints: z.array(HintSchema),
  referenceSolution: z.string().min(1),
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

/**
 * The Stage 2 evaluation rubric of one exercise (ADR-0017, SPEC story 29):
 * the required/prohibited/advisory criteria generated alongside the
 * exercise, mirroring PRD §18's `review:` YAML. Only `required` and
 * `prohibited` criteria affect pass/fail (PRD §18); `advisory` is
 * informational and never blocks.
 */
export const EvaluationRubricSchema = z
  .object({
    required: z.array(z.string().trim().min(1)),
    prohibited: z.array(z.string().trim().min(1)),
    advisory: z.array(z.string().trim().min(1)),
  })
  .strict()

export type EvaluationRubric = z.infer<typeof EvaluationRubricSchema>

/**
 * Input to `reviewSubmission`: the exercise context, the code that already
 * passed the deterministic Stage 1 gate, and the exercise's evaluation
 * rubric. The rubric is passed explicitly so the model evaluates exactly
 * the generated criteria and never invents its own.
 */
export const ReviewSubmissionInputSchema = z.object({
  language: z.enum(SANDBOX_LANGUAGES),
  exerciseTitle: z.string().min(1),
  exercisePrompt: z.string().min(1),
  rubric: EvaluationRubricSchema,
  submissionCode: z.string().trim().min(1),
})

export type ReviewSubmissionInput = z.infer<typeof ReviewSubmissionInputSchema>

/**
 * One model verdict on one rubric criterion. For a `prohibited` criterion,
 * `violated` means the forbidden pattern is present; for a `required`
 * criterion it means the demanded pattern is absent.
 */
export const CriterionVerdictSchema = z
  .object({
    criterion: z.string().trim().min(1),
    verdict: z.enum(['satisfied', 'violated']),
    explanation: z.string().trim().min(1),
  })
  .strict()

export type CriterionVerdict = z.infer<typeof CriterionVerdictSchema>

/**
 * Structured output of `reviewSubmission`. The `required`/`prohibited`/
 * `advisory` arrays mirror the input rubric's lists entry-for-entry, so the
 * caller attaches pass/fail relevance by position without text matching.
 * The model only assesses each criterion — pass/fail is derived
 * app-side, deterministically, from the criterion kinds (PRD §18).
 * Parsed strictly: model output is untrusted input.
 */
export const ReviewSubmissionOutputSchema = z
  .object({
    overall: z.string().trim().min(1),
    required: z.array(CriterionVerdictSchema),
    prohibited: z.array(CriterionVerdictSchema),
    advisory: z.array(CriterionVerdictSchema),
  })
  .strict()

export type ReviewSubmissionOutput = z.infer<
  typeof ReviewSubmissionOutputSchema
>
