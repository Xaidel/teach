import { createFileRoute, notFound } from '@tanstack/react-router'

import { getHardcodedExerciseFn } from '../features/exercise/exercise.functions'
import { ExercisePage } from '../features/exercise/pages/exercise-page'

export const Route = createFileRoute('/')({
  loader: async () => {
    const exercise = await getHardcodedExerciseFn()
    if (!exercise) {
      throw notFound()
    }
    return exercise
  },
  component: ExercisePage,
})
