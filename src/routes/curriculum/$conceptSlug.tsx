import { createFileRoute } from '@tanstack/react-router'

import { getExplanationPreferencesFn } from '../../features/learners/learners.functions'
import { getCurriculumStepFn } from '../../features/curriculum/curriculum.functions'
import { CurriculumStepPage } from '../../features/curriculum/pages/curriculum-step-page'

export const Route = createFileRoute('/curriculum/$conceptSlug')({
  loader: async ({ params }) => {
    // The concept panel's "Explain it for me" popover (issue #12) reads
    // and changes the same learner-owned explanation preference `/practice`
    // does — loaded alongside the step so it's ready without an extra
    // round trip.
    const [step, explanationPreferences] = await Promise.all([
      getCurriculumStepFn({
        data: { language: 'rust', conceptSlug: params.conceptSlug },
      }),
      getExplanationPreferencesFn(),
    ])
    return { ...step, explanationPreferences }
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
