import { createServerFn } from '@tanstack/react-start'

import { getCurrentLearnerId } from '../learners/learners.server'
import { SubmitExerciseInputSchema } from './exercise.schema'
import { getHardcodedExercise, submitExercise } from './exercise.server'

/** Loads the single hardcoded v1 exercise for the walking-skeleton route. */
export const getHardcodedExerciseFn = createServerFn({ method: 'GET' }).handler(
  () => {
    return getHardcodedExercise()
  },
)

/** Submits learner code for sandboxed evaluation, persisting the result. */
export const submitExerciseFn = createServerFn({ method: 'POST' })
  .validator(SubmitExerciseInputSchema)
  .handler(async ({ data }) => {
    const learnerId = await getCurrentLearnerId()
    return submitExercise({ ...data, learnerId })
  })
