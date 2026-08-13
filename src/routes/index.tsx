import { createFileRoute } from '@tanstack/react-router'

import { getUsableConceptGraphFn } from '../features/concepts/concepts.functions'
import {
  getAvailableExercisesFn,
  getPreFlightAggregatesFn,
} from '../features/exercise/exercise.functions'
import { ExercisePage } from '../features/exercise/pages/exercise-page'

export const Route = createFileRoute('/')({
  loader: async () => {
    const [exercises, usableGraph, preFlightAggregates] = await Promise.all([
      getAvailableExercisesFn(),
      // Issue #8 ships Rust exercise generation; Go/Python arrive with
      // tickets #19/#20, when this loader will offer them too.
      getUsableConceptGraphFn({ data: 'rust' }),
      getPreFlightAggregatesFn(),
    ])
    const aggregatesByConceptId = new Map(
      preFlightAggregates.map((aggregate) => [aggregate.conceptId, aggregate]),
    )
    return {
      exercises,
      generation: {
        language: 'rust',
        concepts: usableGraph.concepts.map((concept) => ({
          ...concept,
          preFlight: aggregatesByConceptId.get(concept.id) ?? null,
        })),
      },
    }
  },
  component: ExercisePage,
})
