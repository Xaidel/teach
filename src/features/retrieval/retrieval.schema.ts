import { z } from 'zod'

import type { MasteryState } from '#/lib/mastery-states'

/**
 * One Retrieval Queue entry as the learner sees it (SPEC story 47, PRD
 * §23.1, issue #18): the stored queue row annotated with the concept's
 * graph data and current mastery state, bucketed by the view. `dueAt` is
 * an ISO string (server-function serialization); `status` is derived from
 * the stored columns only — `due_at`, `priority_score` — keeping the view
 * the flat materialized read ADR-0010 chose: a row whose score carries the
 * remediation boost (its last retrieval failed, `isRetrievalRemediationScore`)
 * and that is already due is High Priority; a due row is Due; everything
 * else is Upcoming.
 */
export type RetrievalQueueEntry = {
  conceptId: string
  slug: string
  difficulty: number
  masteryState: MasteryState
  scheduleStage: number
  /** The interval label for the entry's stage (e.g. "3 days"). */
  intervalLabel: string
  dueAt: string
  priorityScore: number
  status: 'high-priority' | 'due' | 'upcoming'
  /** True when the entry's last recorded retrieval failed (remediation). */
  remediation: boolean
}

/**
 * The Retrieval Queue view (issue #18 AC 1): every queue row for the
 * learner split into PRD §23.1's three buckets — High Priority (failed
 * previous review, due), Due, and Upcoming — each ordered by priority
 * (descending) then due time (ascending). `dueCount` is the number of
 * entries ready to review now, for compact surfaces.
 */
export type RetrievalQueueView = {
  highPriority: RetrievalQueueEntry[]
  due: RetrievalQueueEntry[]
  upcoming: RetrievalQueueEntry[]
  dueCount: number
}

/**
 * A started Refresher Test (issue #18, AC 3/4): the ordinary verified
 * exercise the learner solves through the practice flow. `reused` tells
 * the caller whether this is a freshly generated exercise or one picked
 * from the concept's existing verified set.
 */
export type RetrievalTestView = {
  exerciseId: string
  slug: string
  title: string
  conceptSlug: string
  reused: boolean
}

/** Validated input for starting a Refresher Test on one due concept. */
export const StartRetrievalReviewInputSchema = z.object({
  conceptId: z.uuid(),
})

export type StartRetrievalReviewInput = z.infer<
  typeof StartRetrievalReviewInputSchema
>

/**
 * The full server-side input to start a Refresher Test: the validated
 * client input plus the session-resolved learner (issue #18 AC 3). A named
 * type keeps the server boundary honest instead of an anonymous
 * spread-and-merge.
 */
export type StartRetrievalReviewCommand = StartRetrievalReviewInput & {
  learnerId: string
}

/** The failure codes the retrieval feature's server surface can raise. */
export type RetrievalErrorCode =
  'CONCEPT_NOT_FOUND' | 'CONCEPT_NOT_DUE' | 'REFRESHER_GENERATION_FAILED'

export const RETRIEVAL_ERROR_MESSAGES: Record<RetrievalErrorCode, string> = {
  CONCEPT_NOT_FOUND: 'No concept found for that id.',
  CONCEPT_NOT_DUE: 'That concept is not due for a Refresher Test yet.',
  REFRESHER_GENERATION_FAILED:
    'The Refresher Test exercise could not be generated. Try again.',
}

/** Typed error for the retrieval feature, carrying a stable code. */
export class RetrievalError extends Error {
  readonly code: RetrievalErrorCode

  constructor(code: RetrievalErrorCode) {
    super(RETRIEVAL_ERROR_MESSAGES[code])
    this.name = 'RetrievalError'
    this.code = code
  }
}
