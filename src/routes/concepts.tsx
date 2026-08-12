import { createFileRoute } from '@tanstack/react-router'

import { getConceptReviewFn } from '../features/concepts/concepts.functions'
import { normalizeConceptLanguage } from '../features/concepts/concepts.schema'
import { ConceptReviewPage } from '../features/concepts/pages/concepts-page'

export const Route = createFileRoute('/concepts')({
  validateSearch: (search: Record<string, unknown>) => ({
    language: normalizeConceptLanguage(search.language),
  }),
  loaderDeps: ({ search }) => ({ language: search.language }),
  loader: async ({ deps }) => {
    return getConceptReviewFn({ data: deps.language })
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
