import { createFileRoute } from '@tanstack/react-router'

import { getCurriculumFn } from '../features/curriculum/curriculum.functions'
import { DashboardPage } from '../features/dashboard/pages/dashboard-page'

export const Route = createFileRoute('/')({
  loader: async () => {
    // Issue #14 ships the Rust curriculum; Go/Python arrive with later
    // language tickets, when the Dashboard's topic grid will offer them too.
    const curriculum = await getCurriculumFn({ data: 'rust' })
    return { curriculum }
  },
  head: () => ({
    meta: [{ title: 'Teach — Dashboard' }],
  }),
  component: DashboardPage,
})
