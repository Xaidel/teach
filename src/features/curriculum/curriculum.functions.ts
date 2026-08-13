import { createServerFn } from '@tanstack/react-start'

import { getCurrentLearnerId } from '../learners/learners.server'
import {
  GenerateStepExerciseInputSchema,
  GetCurriculumInputSchema,
  GetCurriculumStepInputSchema,
  GetLessonInputSchema,
} from './curriculum.schema'
import {
  generateCurriculumLesson,
  generateStepExercise,
  getCurriculum,
  getCurriculumStepDetail,
} from './curriculum.server'

/** Loads the Class A curriculum sequence for one language (SPEC story 1). */
export const getCurriculumFn = createServerFn({ method: 'GET' })
  .validator(GetCurriculumInputSchema)
  .handler(async ({ data }) => {
    const learnerId = await getCurrentLearnerId()
    return getCurriculum(learnerId, data)
  })

/** Loads one step's detail view: the step, its mastery, and both slots. */
export const getCurriculumStepFn = createServerFn({ method: 'GET' })
  .validator(GetCurriculumStepInputSchema)
  .handler(async ({ data }) => {
    const learnerId = await getCurrentLearnerId()
    return getCurriculumStepDetail({ learnerId, ...data })
  })

/**
 * Generates one step's guided or independent exercise (SPEC story 2),
 * gated server-side by the no-skip-ahead rule (AC 4).
 */
export const generateStepExerciseFn = createServerFn({ method: 'POST' })
  .validator(GenerateStepExerciseInputSchema)
  .handler(async ({ data }) => {
    const learnerId = await getCurrentLearnerId()
    return generateStepExercise({ learnerId, ...data })
  })

/**
 * Generates the step's lesson at the learner's explanation depth (SPEC
 * story 2, issue #12), gated by the same no-skip-ahead rule.
 */
export const generateLessonFn = createServerFn({ method: 'POST' })
  .validator(GetLessonInputSchema)
  .handler(async ({ data }) => {
    const learnerId = await getCurrentLearnerId()
    return generateCurriculumLesson({ learnerId, ...data })
  })
