import { createServerFn } from '@tanstack/react-start'

import { getCurrentLearnerId } from '#/features/learners/learners.server'

import { SubmitExplanationAssessmentInputSchema } from './explanation-assessment.schema'
import {
  getExplanationAssessmentOverview,
  submitExplanationAssessment,
} from './explanation-assessment.server'

/**
 * The concepts a learner can currently be explained on (SPEC story 44,
 * issue #16): the usable Concept Graph concepts at Practiced, annotated
 * with whether each already has a passed assessment. The learner is
 * resolved once here and threaded down (ADR-0014).
 */
export const getExplanationAssessmentOverviewFn = createServerFn({
  method: 'GET',
}).handler(async () => {
  const learnerId = await getCurrentLearnerId()
  return getExplanationAssessmentOverview(learnerId)
})

/**
 * Submits one Explanation Assessment (SPEC stories 44-45, issue #16): the
 * learner's explanation of a Practiced concept is compared against the
 * Concept Graph, scored deterministically app-side, and recorded in the
 * Learner Model — promoting the concept only once a passed Transfer Test
 * is also recorded (ADR-0015). The learner is resolved once here and
 * threaded down (ADR-0014).
 */
export const submitExplanationAssessmentFn = createServerFn({ method: 'POST' })
  .validator(SubmitExplanationAssessmentInputSchema)
  .handler(async ({ data }) => {
    const learnerId = await getCurrentLearnerId()
    return submitExplanationAssessment({ ...data, learnerId })
  })
