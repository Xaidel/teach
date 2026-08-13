import { createServerFn } from '@tanstack/react-start'

import { getCurrentLearnerId } from '#/features/learners/learners.server'

import { GenerateTransferTestInputSchema } from './transfer-test.schema'
import {
  generateTransferTestExercise,
  getTransferTestOverview,
} from './transfer-test.server'

/**
 * The concepts a learner can currently take a Transfer Test on (SPEC story
 * 46, issue #17): the usable Concept Graph concepts at Practiced, annotated
 * with whether each already has a passed Transfer Test. The learner is
 * resolved once here and threaded down (ADR-0014).
 */
export const getTransferTestOverviewFn = createServerFn({
  method: 'GET',
}).handler(async () => {
  const learnerId = await getCurrentLearnerId()
  return getTransferTestOverview(learnerId)
})

/**
 * Generates (or reuses) a Transfer Test exercise for an already-Practiced
 * concept (SPEC story 46, ADR-0015, ADR-0010, issue #17) — a debug-mode
 * exercise through the same generation + Pre-Flight pipeline as any other
 * exercise. The learner is resolved once here and threaded down (ADR-0014).
 */
export const generateTransferTestExerciseFn = createServerFn({
  method: 'POST',
})
  .validator(GenerateTransferTestInputSchema)
  .handler(async ({ data }) => {
    const learnerId = await getCurrentLearnerId()
    return generateTransferTestExercise({ ...data, learnerId })
  })
