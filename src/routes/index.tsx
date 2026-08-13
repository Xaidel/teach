import { createFileRoute } from '@tanstack/react-router'

import { getUsableConceptGraphFn } from '../features/concepts/concepts.functions'
import {
  getAvailableExercisesFn,
  getPreFlightAggregatesFn,
} from '../features/exercise/exercise.functions'
import { ExercisePage } from '../features/exercise/pages/exercise-page'
import { getExplanationPreferencesFn } from '../features/learners/learners.functions'

export const Route = createFileRoute('/')({
  // A Tactical Sprint hand-off (issue #13's "Go solve it" link) carries the
  // generated exercise's id so the practice page can scroll to and
  // highlight the exact one instead of the learner having to find it in an
  // ever-growing flat list. Purely a display concern — never affects the
  // loader's data.
  validateSearch: (search: Record<string, unknown>) => ({
    exerciseId:
      typeof search.exerciseId === 'string' ? search.exerciseId : undefined,
  }),
  loader: async () => {
    const [
      exercises,
      usableGraph,
      preFlightAggregates,
      explanationPreferences,
    ] = await Promise.all([
      getAvailableExercisesFn(),
      // Issue #8 ships Rust exercise generation; Go/Python arrive with
      // tickets #19/#20, when this loader will offer them too.
      getUsableConceptGraphFn({ data: 'rust' }),
      getPreFlightAggregatesFn(),
      // Issue #12: the learner's explanation depth/reference frame.
      getExplanationPreferencesFn(),
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
      explanationPreferences,
    }
  },
  component: ExercisePage,
})
