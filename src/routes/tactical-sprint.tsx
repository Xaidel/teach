import { createFileRoute } from '@tanstack/react-router'

import { TacticalSprintPage } from '../features/tactical-sprint/pages/tactical-sprint-page'

export const Route = createFileRoute('/tactical-sprint')({
  head: () => ({
    meta: [
      {
        title: 'Tactical Sprint — Teach',
      },
    ],
  }),
  component: TacticalSprintPage,
})
