import { createServerFn } from '@tanstack/react-start'

import { getCurrentLearnerId } from '../learners/learners.server'
import { GenerateExerciseForConceptInputSchema } from './exercise-generation.schema'
import { generateExerciseForConcept } from './exercise-generation.server'
import {
  RequestHintInputSchema,
  SubmitExerciseInputSchema,
} from './exercise.schema'
import {
  getAvailableExercises,
  requestHint,
  submitExercise,
} from './exercise.server'
import { getPreFlightAttemptAggregates } from './pre-flight-signals.server'

/**
 * Loads every exercise a learner may attempt — the hardcoded v1 seeds plus
 * every Pre-Flight-verified generated exercise — for the home route.
 */
export const getAvailableExercisesFn = createServerFn({
  method: 'GET',
}).handler(() => {
  return getAvailableExercises()
})

/**
 * Loads every concept's Pre-Flight attempt aggregate (SPEC story 35), so
 * the generation surface can surface repeated failures on a concept as a
 * quality signal.
 */
export const getPreFlightAggregatesFn = createServerFn({
  method: 'GET',
}).handler(() => {
  return getPreFlightAttemptAggregates()
})

/**
 * Generates an exercise for a Concept Graph concept and runs it through
 * the deterministic Pre-Flight Validation gate; only a verified exercise
 * is persisted and shown (issue #8).
 */
export const generateExerciseFn = createServerFn({ method: 'POST' })
  .validator(GenerateExerciseForConceptInputSchema)
  .handler(({ data }) => {
    return generateExerciseForConcept(data)
  })

/** Submits learner code for sandboxed evaluation, persisting the result. */
export const submitExerciseFn = createServerFn({ method: 'POST' })
  .validator(SubmitExerciseInputSchema)
  .handler(async ({ data }) => {
    const learnerId = await getCurrentLearnerId()
    return submitExercise({ ...data, learnerId })
  })

/** Serves the next allowed hint level for a persisted exercise attempt. */
export const requestHintFn = createServerFn({ method: 'POST' })
  .validator(RequestHintInputSchema)
  .handler(async ({ data }) => {
    const learnerId = await getCurrentLearnerId()
    return requestHint({ ...data, learnerId })
  })
