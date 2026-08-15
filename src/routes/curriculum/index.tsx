import { createFileRoute } from '@tanstack/react-router'

import { getCurriculumFn } from '../../features/curriculum/curriculum.functions'
import { CurriculumPage } from '../../features/curriculum/pages/curriculum-page'

export const Route = createFileRoute('/curriculum/')({
  // A deep link (e.g. the Dashboard's "Resume") can carry the concept to
  // highlight as "you are here" on the graph. Purely a display concern —
  // never affects the loader's data.
  validateSearch: (search: Record<string, unknown>) => ({
    c: typeof search.c === 'string' ? search.c : undefined,
  }),
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
