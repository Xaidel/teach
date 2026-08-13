import { z } from 'zod'

import {
  CONCEPT_DIFFICULTY_MAX,
  CONCEPT_DIFFICULTY_MIN,
  CONCEPT_EDGE_KINDS,
  CONCEPT_SLUG_PATTERN,
} from '#/lib/concept-graph'
import {
  EXPLANATION_DEPTH_MAX,
  EXPLANATION_DEPTH_MIN,
} from '#/lib/explanation-depth'
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
 * compares hint output against (ADR-0008, ADR-0012). `depth` and
 * `referenceFrame` are the learner's explanation preferences (issue #12,
 * PRD §12): they steer how the hint is phrased and never affect
 * `targetLevel` or which concept the hint targets — presentation only.
 */
export const GenerateHintInputSchema = z.object({
  language: z.enum(SANDBOX_LANGUAGES),
  exerciseTitle: z.string().min(1),
  exercisePrompt: z.string().min(1),
  sandboxResult: SandboxResultSchema,
  targetLevel: z.number().int().min(0).max(HINT_LADDER_MAX_LEVEL),
  priorHints: z.array(HintSchema),
  referenceSolution: z.string().min(1),
  depth: z.number().int().min(EXPLANATION_DEPTH_MIN).max(EXPLANATION_DEPTH_MAX),
  referenceFrame: z.string().optional(),
})

export type GenerateHintInput = z.infer<typeof GenerateHintInputSchema>

/**
 * Input to `explainConcept`: a concept at a presentation depth (SPEC stories
 * 11-12), optionally anchored to a reference frame.
 */
export const ExplainConceptInputSchema = z.object({
  language: z.string().min(1),
  concept: z.string().min(1),
  depth: z.number().int().min(EXPLANATION_DEPTH_MIN).max(EXPLANATION_DEPTH_MAX),
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
 * One concept in a drafted graph (ADR-0010): the dotted natural slug (e.g.
 * `rust.async.send`) and a 1-5 difficulty. Parsed strictly — the model's
 * structured output is untrusted input, and the slug shape is a DB-level
 * invariant.
 */
export const ConceptDraftSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .min(1)
      .regex(CONCEPT_SLUG_PATTERN, 'Concept slug must be dotted lowercase'),
    difficulty: z
      .number()
      .int()
      .min(CONCEPT_DIFFICULTY_MIN)
      .max(CONCEPT_DIFFICULTY_MAX),
  })
  .strict()

export type ConceptDraft = z.infer<typeof ConceptDraftSchema>

/**
 * One edge in a drafted graph, referencing concepts by slug (the model
 * cannot know persisted ids). `kind` discriminates prerequisite from
 * related (ADR-0010).
 */
export const ConceptEdgeDraftSchema = z
  .object({
    from: z
      .string()
      .trim()
      .min(1)
      .regex(CONCEPT_SLUG_PATTERN, 'Concept slug must be dotted lowercase'),
    to: z
      .string()
      .trim()
      .min(1)
      .regex(CONCEPT_SLUG_PATTERN, 'Concept slug must be dotted lowercase'),
    kind: z.enum(CONCEPT_EDGE_KINDS),
  })
  .strict()

export type ConceptEdgeDraft = z.infer<typeof ConceptEdgeDraftSchema>

/** Input to `draftConceptGraph`: the language to draft a broad graph for. */
export const DraftConceptGraphInputSchema = z.object({
  language: z.enum(SANDBOX_LANGUAGES),
})

export type DraftConceptGraphInput = z.infer<
  typeof DraftConceptGraphInputSchema
>

/**
 * Structured output of `draftConceptGraph`: a broad per-language set of
 * concepts and their prerequisite/related edges. `edges` defaults to empty
 * so a concepts-only draft stays valid. Parsed strictly as model output.
 */
export const DraftConceptGraphOutputSchema = z
  .object({
    concepts: z.array(ConceptDraftSchema).min(1),
    edges: z.array(ConceptEdgeDraftSchema).default([]),
  })
  .strict()

export type DraftConceptGraphOutput = z.infer<
  typeof DraftConceptGraphOutputSchema
>

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
 * Structured diagnostics of one failed Pre-Flight run, fed into the next
 * generation attempt so retries are informed, not blind repeats (SPEC story
 * 32, PRD §5.2, issue #9). A structural mirror of the persisted
 * `PreFlightDiagnostics` shape (ADR-0010); defined here so the AI layer
 * stays self-contained — the model receives a serialized summary of the
 * previous failure, never a live reference to the persisted row.
 */
export const PreFlightDiagnosticsInputSchema = z.object({
  checks: z.array(
    z
      .object({
        name: z.enum([
          'reference_passes',
          'broken_state_fails',
          'failure_matches_concept',
        ]),
        passed: z.boolean(),
        detail: z.string().optional(),
      })
      .strict(),
  ),
  referenceResult: SandboxResultSchema,
  brokenResult: SandboxResultSchema,
})

export type PreFlightDiagnosticsInput = z.infer<
  typeof PreFlightDiagnosticsInputSchema
>

/**
 * The declared, intentional defect of an adversarial (debug-mode) exercise
 * (SPEC story 52, PRD §20, issue #11): the machine-readable "known defect"
 * of the adversarial contract — kind, what it is, where it lives, and the
 * expected behavior the fixed reference solution exhibits. It is a
 * generation-contract declaration, not a substitute for verification:
 * Pre-Flight validates behaviorally that the defect makes the broken state
 * fail and the reference passes. Parsed strictly as model output.
 */
export const ExerciseDefectSchema = z
  .object({
    kind: z.enum([
      'ownership',
      'lifetime',
      'race_condition',
      'broken_invariant',
      'error_handling',
      'api_misuse',
      'other',
    ]),
    description: z.string().trim().min(1),
    location: z.string().trim().min(1),
    expectedBehavior: z.string().trim().min(1),
  })
  .strict()

export type ExerciseDefect = z.infer<typeof ExerciseDefectSchema>

/**
 * Input to `generateExercise`: the language and the concept the exercise
 * must target, with the concept's persisted difficulty as a difficulty
 * anchor (SPEC story 29, PRD §13). The caller (Pre-Flight, ticket #8)
 * resolves the concept from the Concept Graph and passes it down; the
 * model never invents concepts outside the graph.
 *
 * `previousDiagnostics` carries the failed Pre-Flight run's structured
 * diagnostics into a retry (SPEC story 32, issue #9); it is absent on the
 * first attempt. `simplifiedConstraints` marks the circuit-breaker's
 * terminal fallback regeneration, which uses a reduced constraint set
 * rather than looping (SPEC story 34, PRD §5.2, issue #9).
 * `adversarial` targets an adversarial (debug-mode) exercise: starterCode
 * intentionally contains one known defect of a declared kind and the
 * learner is asked to find and fix it, gated by the same Pre-Flight
 * Validation as any other exercise (SPEC stories 51-52, PRD §20, issue
 * #11). When set, the generated output must carry a `defect` declaration.
 */
export const GenerateExerciseInputSchema = z.object({
  language: z.enum(SANDBOX_LANGUAGES),
  conceptSlug: z
    .string()
    .trim()
    .regex(CONCEPT_SLUG_PATTERN, 'Concept slug must be dotted lowercase'),
  conceptDifficulty: z
    .number()
    .int()
    .min(CONCEPT_DIFFICULTY_MIN)
    .max(CONCEPT_DIFFICULTY_MAX),
  previousDiagnostics: PreFlightDiagnosticsInputSchema.optional(),
  simplifiedConstraints: z.boolean().optional(),
  adversarial: z.boolean().optional(),
})

export type GenerateExerciseInput = z.infer<typeof GenerateExerciseInputSchema>

/**
 * Structured output of `generateExercise` (PRD §13's exercise YAML, SPEC
 * story 29): the learner-facing prompt and code, the Pre-Flight-verifiable
 * reference solution, the generated test harness, and the exercise's
 * metadata. `evaluation.tests` names one test function per named test —
 * the testSource file must define exactly those names, which is what lets
 * Pre-Flight check that the intended broken state fails on the target
 * concept's tests rather than incidentally (PRD §14). `defect` is the
 * declared intentional defect of an adversarial (debug-mode) generation
 * (SPEC stories 51-52, PRD §20, issue #11); it is optional in the schema
 * and required in practice for adversarial inputs — `generateExercise`
 * rejects an adversarial call whose output omits it (an invented,
 * undeclared bug must never ship). Parsed strictly: model output is
 * untrusted input.
 */
export const GeneratedExerciseSchema = z
  .object({
    title: z.string().trim().min(1),
    prompt: z.string().trim().min(1),
    starterCode: z.string().trim().min(1),
    referenceSolution: z.string().trim().min(1),
    testSource: z.string().trim().min(1),
    targetConcepts: z
      .array(
        z
          .string()
          .trim()
          .regex(CONCEPT_SLUG_PATTERN, 'Concept slug must be dotted lowercase'),
      )
      .min(1),
    prerequisites: z
      .array(
        z
          .string()
          .trim()
          .regex(CONCEPT_SLUG_PATTERN, 'Concept slug must be dotted lowercase'),
      )
      .default([]),
    difficulty: z
      .number()
      .int()
      .min(CONCEPT_DIFFICULTY_MIN)
      .max(CONCEPT_DIFFICULTY_MAX),
    estimatedMinutes: z.number().int().min(1),
    constraints: z.array(z.string().trim().min(1)),
    defect: ExerciseDefectSchema.optional(),
    evaluation: z
      .object({
        tests: z.array(z.string().trim().min(1)).min(1),
        rubric: EvaluationRubricSchema,
      })
      .strict(),
  })
  .strict()

export type GeneratedExercise = z.infer<typeof GeneratedExerciseSchema>

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
 * app-side, deterministically, from the criterion kinds (PRD §18), and the
 * refactor request is composed app-side from the violated criteria. The
 * model never writes free-text verdicts or summaries.
 * Parsed strictly: model output is untrusted input.
 */
export const ReviewSubmissionOutputSchema = z
  .object({
    required: z.array(CriterionVerdictSchema),
    prohibited: z.array(CriterionVerdictSchema),
    advisory: z.array(CriterionVerdictSchema),
  })
  .strict()

export type ReviewSubmissionOutput = z.infer<
  typeof ReviewSubmissionOutputSchema
>
