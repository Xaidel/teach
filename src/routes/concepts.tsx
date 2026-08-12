import { createFileRoute } from '@tanstack/react-router'

import { getConceptReviewFn } from '../features/concepts/concepts.functions'
import { normalizeConceptLanguage } from '../features/concepts/concepts.schema'
import { ConceptReviewPage } from '../features/concepts/pages/concepts-page'

export const Route = createFileRoute('/concepts')({
  validateSearch: (search: Record<string, unknown>) => ({
    language: normalizeConceptLanguage(search.language),
  }),
  loader: async ({ location }) => {
    const search = location.search as Record<string, unknown> | undefined
    return getConceptReviewFn({
      data: normalizeConceptLanguage(search?.language),
    })
  },
  head: () => ({
    meta: [
      {
        title: 'Concept Graph review — Teach',
      },
    ],
  }),
  component: ConceptReviewPage,
})
