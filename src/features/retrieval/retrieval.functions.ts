import { createServerFn } from '@tanstack/react-start'

import { getCurrentLearnerId } from '#/features/learners/learners.server'

import { StartRetrievalReviewInputSchema } from './retrieval.schema'
import { getRetrievalQueue, startRetrievalReview } from './retrieval.server'

/**
 * The Retrieval Queue view for the current learner (issue #18 AC 1) —
 * every due/upcoming concept annotated with mastery, bucketed into High
 * Priority / Due / Upcoming (PRD §23.1). Read once per request.
 */
export const getRetrievalQueueFn = createServerFn({
  method: 'GET',
}).handler(async () => {
  const learnerId = await getCurrentLearnerId()
  return getRetrievalQueue(learnerId)
})

/**
 * Starts a Refresher Test on one due concept (issue #18 AC 3/4): resolves
 * (or generates) the exercise the review will use and registers it so the
 * submission path applies the review's pass/fail semantics. The learner
 * then solves the exercise through the ordinary practice flow.
 */
export const startRetrievalReviewFn = createServerFn({
  method: 'POST',
})
  .validator(StartRetrievalReviewInputSchema)
  .handler(async ({ data }) => {
    const learnerId = await getCurrentLearnerId()
    return startRetrievalReview({ conceptId: data.conceptId, learnerId })
  })
