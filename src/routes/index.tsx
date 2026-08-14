import { createFileRoute } from '@tanstack/react-router'

import { getUsableConceptGraphFn } from '../features/concepts/concepts.functions'
import {
  getAvailableExercisesFn,
  getPreFlightAggregatesFn,
} from '../features/exercise/exercise.functions'
import { ExercisePage } from '../features/exercise/pages/exercise-page'
import { getExplanationPreferencesFn } from '../features/learners/learners.functions'
// Issue #18: the route composes the compact Retrieval Queue dashboard
// section into the practice home. Composition belongs at the route seam —
// the `exercise` feature itself must not import `retrieval` (dependency
// rules: production imports stay acyclic).
import { RetrievalQueueCard } from '../features/retrieval/components/retrieval-queue-card'
import { getRetrievalQueueFn } from '../features/retrieval/retrieval.functions'
import type { RetrievalQueueView } from '../features/retrieval/retrieval.schema'

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
      retrievalQueue,
    ] = await Promise.all([
      getAvailableExercisesFn(),
      // Issue #8 ships Rust exercise generation; Go/Python arrive with
      // tickets #19/#20, when this loader will offer them too.
      getUsableConceptGraphFn({ data: 'rust' }),
      getPreFlightAggregatesFn(),
      // Issue #12: the learner's explanation depth/reference frame.
      getExplanationPreferencesFn(),
      // Issue #18: the compact Retrieval Queue section on the dashboard.
      getRetrievalQueueFn(),
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
      retrievalQueue,
    }
  },
  component: () => {
    const data: {
      retrievalQueue: RetrievalQueueView
    } = Route.useLoaderData()
    return (
      <ExercisePage
        retrievalQueueSection={
          <RetrievalQueueCard compact view={data.retrievalQueue} />
        }
      />
    )
  },
})
