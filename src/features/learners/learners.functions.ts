import { createServerFn } from '@tanstack/react-start'

import { UpdateExplanationPreferencesInputSchema } from './learners.schema'
import {
  getCurrentLearnerId,
  getExplanationPreferences,
  updateExplanationPreferences,
} from './learners.server'

/** Loads the current learner's explanation depth and reference frame. */
export const getExplanationPreferencesFn = createServerFn({
  method: 'GET',
}).handler(async () => {
  const learnerId = await getCurrentLearnerId()
  return getExplanationPreferences(learnerId)
})

/**
 * Sets/changes the current learner's explanation depth and/or reference
 * frame (issue #12). Either field may be sent alone; an omitted field is
 * left unchanged.
 */
export const updateExplanationPreferencesFn = createServerFn({
  method: 'POST',
})
  .validator(UpdateExplanationPreferencesInputSchema)
  .handler(async ({ data }) => {
    const learnerId = await getCurrentLearnerId()
    return updateExplanationPreferences(learnerId, data)
  })
