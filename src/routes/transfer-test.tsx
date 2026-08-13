import { createFileRoute } from '@tanstack/react-router'

import { getTransferTestOverviewFn } from '../features/transfer-test/transfer-test.functions'
import { TransferTestPage } from '../features/transfer-test/pages/transfer-test-page'
import type { TransferTestOverview } from '../features/transfer-test/transfer-test.schema'

export const Route = createFileRoute('/transfer-test')({
  head: () => ({
    meta: [
      {
        title: 'Transfer Test — Teach',
      },
    ],
  }),
  loader: async () => getTransferTestOverviewFn(),
  component: () => {
    const overview: TransferTestOverview = Route.useLoaderData()
    return <TransferTestPage overview={overview} />
  },
})
