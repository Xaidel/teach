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

/**
 * The Class B runtime-gap case (ADR-0016): when a pasted snippet's
 * identified concept has no match in the existing Concept Graph, generation
 * is scoped to that one concept rather than a broad draft. `slug` is fixed
 * by the caller (never renamed by the model, so the resulting id is known
 * in advance); `description` is the short natural-language description the
 * concept was identified by, giving the model context to set a plausible
 * difficulty.
 */
export const ConceptGraphFocusSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .min(1)
      .regex(CONCEPT_SLUG_PATTERN, 'Concept slug must be dotted lowercase'),
    description: z.string().trim().min(1),
  })
  .strict()

export type ConceptGraphFocus = z.infer<typeof ConceptGraphFocusSchema>

/**
 * Input to `draftConceptGraph`: the language to draft a broad graph for, or
 * — when `focusConcept` is set — a single ad-hoc concept scoped to the
 * Class B runtime gap (ADR-0016) instead of a broad draft.
 */
export const DraftConceptGraphInputSchema = z.object({
  language: z.enum(SANDBOX_LANGUAGES),
  focusConcept: ConceptGraphFocusSchema.optional(),
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
 * `sprintScoped` targets a Class B Tactical Sprint exercise (SPEC stories
 * 6-7, ticket #13): scoped to a 5-10 minute estimate and a
 * signature-preserving constraint rather than the general 1-15 minute
 * range, so the sprint stays tactical rather than open-ended. The caller
 * (ticket #13's tactical-sprint feature) rejects a draft whose
 * `estimatedMinutes` falls outside 5-10 the same way an off-target
 * `targetConcepts` draft is rejected — this schema only carries the model
 * the instruction.
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
  sprintScoped: z.boolean().optional(),
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
 * undeclared bug must never ship) and, symmetrically, a non-adversarial
 * call whose output declares one (issue #117): defect presence must match
 * the requested mode, so a mode-'implement' row can never render as
 * adversarial. Parsed strictly: model output is
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

/**
 * Max pasted-snippet length accepted by `identifySnippetConcepts` (SPEC
 * stories 4-7, ticket #13): generous for a real AI-generated snippet a
 * learner doesn't understand, small enough to keep the identification
 * prompt bounded.
 */
export const SNIPPET_MAX_LENGTH = 20_000

/**
 * One concept identified in a pasted snippet (SPEC stories 4-5, ticket
 * #13): a dotted slug — matching an existing Concept Graph slug when the
 * model recognizes one from `knownConceptSlugs`, or a plausible new slug
 * otherwise — plus a short description. The caller resolves each slug
 * against the graph and ad-hoc drafts an unmatched one immediately
 * (ADR-0016's runtime-gap case), using `description` as that draft's
 * context; the model never decides graph membership itself. Parsed
 * strictly as model output.
 */
export const SnippetConceptSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .min(1)
      .regex(CONCEPT_SLUG_PATTERN, 'Concept slug must be dotted lowercase'),
    description: z.string().trim().min(1),
  })
  .strict()

export type SnippetConcept = z.infer<typeof SnippetConceptSchema>

/**
 * Input to `identifySnippetConcepts` (SPEC story 4, ticket #13): the
 * pasted snippet and its language, plus the language's current usable
 * Concept Graph slugs (ADR-0016) so the model prefers matching an existing
 * concept over minting a new one whenever the snippet genuinely exercises
 * it.
 */
export const IdentifySnippetConceptsInputSchema = z.object({
  language: z.enum(SANDBOX_LANGUAGES),
  snippet: z.string().trim().min(1).max(SNIPPET_MAX_LENGTH),
  knownConceptSlugs: z.array(z.string()),
})

export type IdentifySnippetConceptsInput = z.infer<
  typeof IdentifySnippetConceptsInputSchema
>

/**
 * Structured output of `identifySnippetConcepts`: every concept the
 * snippet genuinely depends on (SPEC story 4). At least one — a snippet
 * with no identifiable concept is not a valid Class B input, and the
 * caller (ticket #13's tactical-sprint feature) has nothing to compare
 * against the Learner Model without it. Parsed strictly as model output.
 */
export const IdentifySnippetConceptsOutputSchema = z
  .object({
    concepts: z.array(SnippetConceptSchema).min(1),
  })
  .strict()

export type IdentifySnippetConceptsOutput = z.infer<
  typeof IdentifySnippetConceptsOutputSchema
>

/**
 * Input to `analyzeMisconceptions` (SPEC story 45, issue #16): the concept
 * under assessment — identified by its dotted slug — its position in the
 * Concept Graph (`prerequisiteSlugs`/`relatedSlugs`, the graph's only
 * definition content), and the learner's free-form explanation in their own
 * words. The graph definition is passed explicitly so the model compares
 * against exactly the persisted graph, never against its own idea of the
 * concept (the same scoping rule as `generateExercise`'s caller-resolved
 * target concepts).
 */
export const AnalyzeMisconceptionsInputSchema = z.object({
  language: z.enum(SANDBOX_LANGUAGES),
  conceptSlug: z
    .string()
    .trim()
    .min(1)
    .regex(CONCEPT_SLUG_PATTERN, 'Concept slug must be dotted lowercase'),
  prerequisiteSlugs: z.array(z.string().trim().min(1)),
  relatedSlugs: z.array(z.string().trim().min(1)),
  learnerExplanation: z.string().trim().min(1),
})

export type AnalyzeMisconceptionsInput = z.infer<
  typeof AnalyzeMisconceptionsInputSchema
>

/**
 * One missing-concepts finding (SPEC story 45): a required sub-concept of
 * the assessed concept — the concept itself or one of its prerequisites —
 * that the explanation entirely omitted. `concept` names the omitted
 * sub-concept (a graph slug when it is one); `detail` says what aspect was
 * missing.
 */
export const MissingConceptFindingSchema = z
  .object({
    concept: z.string().trim().min(1),
    detail: z.string().trim().min(1),
  })
  .strict()

export type MissingConceptFinding = z.infer<typeof MissingConceptFindingSchema>

/** One incorrect-claim finding: a claim the explanation makes that contradicts what the concept means. */
export const IncorrectClaimFindingSchema = z
  .object({
    claim: z.string().trim().min(1),
    correction: z.string().trim().min(1),
  })
  .strict()

export type IncorrectClaimFinding = z.infer<typeof IncorrectClaimFindingSchema>

/**
 * One conflated-concepts finding: distinct concepts the explanation treats
 * as the same thing (e.g. borrowing and ownership, references and pointers).
 * `concepts` names the conflated pair/group; `detail` explains the
 * distinction the explanation blurred.
 */
export const ConflatedConceptsFindingSchema = z
  .object({
    concepts: z.array(z.string().trim().min(1)).min(2),
    detail: z.string().trim().min(1),
  })
  .strict()

export type ConflatedConceptsFinding = z.infer<
  typeof ConflatedConceptsFindingSchema
>

/**
 * Structured output of `analyzeMisconceptions` (SPEC story 45, issue #16):
 * missing/incorrect/conflated findings only — explicitly not a score, a
 * grade, or a pass/fail verdict (issue #23 contract: the accuracy score is
 * computed deterministically app-side from this output, never by the
 * model). All three arrays default to empty so a flawless explanation can
 * legitimately parse from an empty findings object. Parsed strictly: model
 * output is untrusted input.
 */
export const AnalyzeMisconceptionsOutputSchema = z
  .object({
    missing: z.array(MissingConceptFindingSchema).default([]),
    incorrect: z.array(IncorrectClaimFindingSchema).default([]),
    conflated: z.array(ConflatedConceptsFindingSchema).default([]),
  })
  .strict()

export type AnalyzeMisconceptionsOutput = z.infer<
  typeof AnalyzeMisconceptionsOutputSchema
>
