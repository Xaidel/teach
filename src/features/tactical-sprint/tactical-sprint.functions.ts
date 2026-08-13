import { createServerFn } from '@tanstack/react-start'

import { getCurrentLearnerId } from '#/features/learners/learners.server'

import { StartTacticalSprintInputSchema } from './tactical-sprint.schema'
import { runTacticalSprint } from './tactical-sprint.server'

/**
 * Runs one Tactical Sprint (Class B, ticket #13): identifies the concepts a
 * pasted snippet depends on, targets the learner's weakest one, and
 * generates a Pre-Flight-verified 5-10 minute exercise for it. The learner
 * is resolved once here and threaded down (ADR-0014).
 */
export const startTacticalSprintFn = createServerFn({ method: 'POST' })
  .validator(StartTacticalSprintInputSchema)
  .handler(async ({ data }) => {
    const learnerId = await getCurrentLearnerId()
    return runTacticalSprint({ ...data, learnerId })
  })
