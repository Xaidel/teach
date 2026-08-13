import { createFileRoute } from '@tanstack/react-router'

import { getExplanationAssessmentOverviewFn } from '../features/explanation-assessment/explanation-assessment.functions'
import { ExplanationAssessmentPage } from '../features/explanation-assessment/pages/explanation-assessment-page'
import type { ExplanationAssessmentOverview } from '../features/explanation-assessment/explanation-assessment.schema'

/** Loader data for the explanation-assessment route (issue #16). */
export type ExplanationAssessmentPageData = ExplanationAssessmentOverview

export const Route = createFileRoute('/explanation-assessment')({
  head: () => ({
    meta: [
      {
        title: 'Explanation Assessment — Teach',
      },
    ],
  }),
  loader: async () => getExplanationAssessmentOverviewFn(),
  component: () => {
    const overview: ExplanationAssessmentPageData = Route.useLoaderData()
    return <ExplanationAssessmentPage overview={overview} />
  },
})
