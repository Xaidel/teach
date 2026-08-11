import { createServerFn } from '@tanstack/react-start'

import { getCurrentLearnerId } from '../learners/learners.server'
import {
  RequestHintInputSchema,
  SubmitExerciseInputSchema,
} from './exercise.schema'
import {
  getHardcodedExercises,
  requestHint,
  submitExercise,
} from './exercise.server'

/** Loads the hardcoded v1 exercises (one per sandbox language) for the home route. */
export const getHardcodedExercisesFn = createServerFn({
  method: 'GET',
}).handler(() => {
  return getHardcodedExercises()
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
