import { createFileRoute } from '@tanstack/react-router'

import { getCurriculumStepFn } from '../../features/curriculum/curriculum.functions'
import { CurriculumStepPage } from '../../features/curriculum/pages/curriculum-step-page'

export const Route = createFileRoute('/curriculum/$conceptSlug')({
  loader: async ({ params }) => {
    return getCurriculumStepFn({
      data: { language: 'rust', conceptSlug: params.conceptSlug },
    })
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData
          ? `Step ${String(loaderData.position)} — ${loaderData.concept.slug} — Teach`
          : 'Class A step — Teach',
      },
    ],
  }),
  component: CurriculumStepPage,
})
