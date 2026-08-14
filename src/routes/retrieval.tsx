import { createFileRoute } from '@tanstack/react-router'

import { getRetrievalQueueFn } from '../features/retrieval/retrieval.functions'
import { RetrievalPage } from '../features/retrieval/pages/retrieval-page'
import type { RetrievalQueueView } from '../features/retrieval/retrieval.schema'

export const Route = createFileRoute('/retrieval')({
  head: () => ({
    meta: [{ title: 'Daily Review — Teach' }],
  }),
  loader: async () => getRetrievalQueueFn(),
  component: () => {
    const view: RetrievalQueueView = Route.useLoaderData()
    return <RetrievalPage view={view} />
  },
})
