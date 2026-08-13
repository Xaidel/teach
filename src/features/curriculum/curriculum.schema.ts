import { z } from 'zod'

import { ExerciseGuidanceSchema } from '../exercise/exercise.schema'
import { ExerciseSchema } from '../exercise/exercise.schema'
import { CONCEPT_SLUG_PATTERN } from '#/lib/concept-graph'

/**
 * The languages the Class A curriculum is enabled for (issue #14). Rust
 * ships here; Go and Python arrive with later language tickets.
 */
export const CURRICULUM_LANGUAGES = ['rust'] as const

export type CurriculumLanguage = (typeof CURRICULUM_LANGUAGES)[number]

/** Narrowing guard for curriculum-language values from untrusted input. */
export function isCurriculumLanguage(
  value: string,
): value is CurriculumLanguage {
  return (CURRICULUM_LANGUAGES as readonly string[]).includes(value)
}

/**
 * A concept step's position in the Class A sequence (SPEC story 1): locked
 * when a prerequisite isn't Practiced yet, available when all prerequisites
 * are Practiced but the learner hasn't started, started after the first
 * attempt (mastery ≥ Introduced), complete at Practiced and above.
 */
export const CurriculumStepStatusSchema = z.enum([
  'locked',
  'available',
  'started',
  'complete',
])

export type CurriculumStepStatus = z.infer<typeof CurriculumStepStatusSchema>

/**
 * One Class A step in the curriculum sequence (SPEC story 1): the concept,
 * its position in the prerequisite-ordered sequence, the direct
 * prerequisites that gate it, the learner's current mastery of the concept,
 * and the derived status.
 */
export const CurriculumStepSchema = z.object({
  position: z.number().int().min(1),
  concept: z.object({
    id: z.string().min(1),
    slug: z.string().min(1),
    difficulty: z.number().int().min(1).max(5),
  }),
  prerequisites: z.array(
    z.object({ id: z.string().min(1), slug: z.string().min(1) }),
  ),
  mastery: z.enum([
    'unknown',
    'introduced',
    'practiced',
    'demonstrated',
    'retained',
  ]),
  status: CurriculumStepStatusSchema,
})

export type CurriculumStep = z.infer<typeof CurriculumStepSchema>

/** The full Class A sequence for one language, ordered by prerequisites. */
export const CurriculumSchema = z.object({
  language: z.enum(CURRICULUM_LANGUAGES),
  steps: z.array(CurriculumStepSchema),
})

export type Curriculum = z.infer<typeof CurriculumSchema>

/**
 * One step's detail view for the step page (SPEC story 2): the step itself
 * plus the verified exercises already banked for its guided and independent
 * slots (issue #14). A slot is null until its exercise is generated.
 */
export const CurriculumStepDetailSchema = CurriculumStepSchema.extend({
  language: z.enum(CURRICULUM_LANGUAGES),
  guidedExercise: ExerciseSchema.nullable(),
  independentExercise: ExerciseSchema.nullable(),
})

export type CurriculumStepDetail = z.infer<typeof CurriculumStepDetailSchema>

/** The generated lesson for one step (SPEC story 2): AI Teacher Engine
 * output, presented at the learner's explanation depth (issue #12). */
export const CurriculumLessonSchema = z.object({
  concept: z.string().min(1),
  explanation: z.string().min(1),
})

export type CurriculumLesson = z.infer<typeof CurriculumLessonSchema>

/** Input for loading the Class A sequence of one language. */
export const GetCurriculumInputSchema = z.enum(CURRICULUM_LANGUAGES)

/** Input for loading one step's detail view. */
export const GetCurriculumStepInputSchema = z.object({
  language: z.enum(CURRICULUM_LANGUAGES),
  conceptSlug: z
    .string()
    .trim()
    .min(1)
    .regex(CONCEPT_SLUG_PATTERN, 'Concept slug must be dotted lowercase'),
})

export type GetCurriculumStepInput = z.infer<
  typeof GetCurriculumStepInputSchema
>

/** Input for generating one step's guided or independent exercise. */
export const GenerateStepExerciseInputSchema = z.object({
  language: z.enum(CURRICULUM_LANGUAGES),
  conceptSlug: z
    .string()
    .trim()
    .min(1)
    .regex(CONCEPT_SLUG_PATTERN, 'Concept slug must be dotted lowercase'),
  guidance: ExerciseGuidanceSchema,
})

export type GenerateStepExerciseInput = z.infer<
  typeof GenerateStepExerciseInputSchema
>

/** Input for generating a step's lesson. */
export const GetLessonInputSchema = z.object({
  language: z.enum(CURRICULUM_LANGUAGES),
  conceptSlug: z
    .string()
    .trim()
    .min(1)
    .regex(CONCEPT_SLUG_PATTERN, 'Concept slug must be dotted lowercase'),
})

export type GetLessonInput = z.infer<typeof GetLessonInputSchema>

/** Stable public curriculum error codes. */
export type CurriculumErrorCode =
  'CURRICULUM_LOCKED' | 'CONCEPT_NOT_IN_CURRICULUM' | 'LESSON_GENERATION_FAILED'

const CURRICULUM_ERROR_MESSAGES: Record<CurriculumErrorCode, string> = {
  CURRICULUM_LOCKED:
    "This step's prerequisites are not all Practiced yet — complete the earlier steps first.",
  CONCEPT_NOT_IN_CURRICULUM:
    "The concept is not part of this language's curriculum.",
  LESSON_GENERATION_FAILED: 'The lesson could not be generated. Try again.',
}

/** Safe error surfaced by the curriculum server boundary. */
export class CurriculumError extends Error {
  readonly code: CurriculumErrorCode

  /** Creates a safe curriculum feature error. */
  constructor(code: CurriculumErrorCode) {
    super(CURRICULUM_ERROR_MESSAGES[code])
    this.name = 'CurriculumError'
    this.code = code
  }
}
