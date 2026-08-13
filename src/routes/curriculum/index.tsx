import { createFileRoute } from '@tanstack/react-router'

import { getCurriculumFn } from '../../features/curriculum/curriculum.functions'
import { CurriculumPage } from '../../features/curriculum/pages/curriculum-page'

export const Route = createFileRoute('/curriculum/')({
  loader: async () => {
    // Issue #14 ships the Rust curriculum; Go/Python arrive with later
    // language tickets, when this loader will offer them too.
    return getCurriculumFn({ data: 'rust' })
  },
  head: () => ({
    meta: [
      {
        title: 'Class A — Structured Path — Teach',
      },
    ],
  }),
  component: CurriculumPage,
})
