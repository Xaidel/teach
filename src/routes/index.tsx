import { createFileRoute, notFound } from '@tanstack/react-router'

import { getHardcodedExercisesFn } from '../features/exercise/exercise.functions'
import { ExercisePage } from '../features/exercise/pages/exercise-page'

export const Route = createFileRoute('/')({
  loader: async () => {
    const exercises = await getHardcodedExercisesFn()
    if (exercises.length === 0) {
      throw notFound()
    }
    return exercises
  },
  component: ExercisePage,
})
