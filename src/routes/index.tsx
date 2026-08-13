import { createFileRoute } from '@tanstack/react-router'

import { getUsableConceptGraphFn } from '../features/concepts/concepts.functions'
import {
  getAvailableExercisesFn,
  getPreFlightSignalsFn,
} from '../features/exercise/exercise.functions'
import { ExercisePage } from '../features/exercise/pages/exercise-page'

export const Route = createFileRoute('/')({
  loader: async () => {
    const [exercises, usableGraph, preFlightSignals] = await Promise.all([
      getAvailableExercisesFn(),
      // Issue #8 ships Rust exercise generation; Go/Python arrive with
      // tickets #19/#20, when this loader will offer them too.
      getUsableConceptGraphFn({ data: 'rust' }),
      getPreFlightSignalsFn(),
    ])
    const signalsByConceptId = new Map(
      preFlightSignals.map((signal) => [signal.conceptId, signal]),
    )
    return {
      exercises,
      generation: {
        language: 'rust',
        concepts: usableGraph.concepts.map((concept) => ({
          ...concept,
          preFlight: signalsByConceptId.get(concept.id) ?? null,
        })),
      },
    }
  },
  component: ExercisePage,
})
