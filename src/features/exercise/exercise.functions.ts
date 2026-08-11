import { createServerFn } from '@tanstack/react-start'

import { getCurrentLearnerId } from '../learners/learners.server'
import { SubmitExerciseInputSchema } from './exercise.schema'
import { getHardcodedExercises, submitExercise } from './exercise.server'

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
