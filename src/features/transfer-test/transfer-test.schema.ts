import { z } from 'zod'

import type { SandboxLanguage } from '#/lib/sandbox/types'

/**
 * One concept eligible for the Practiced → Demonstrated gate's Transfer
 * Test half (ADR-0015, issue #17): the concept's identity plus whether the
 * learner already has a passed Transfer Test recorded for it — so the UI
 * can show what remains on the way to Demonstrated.
 */
export type TransferTestEligibleConcept = {
  conceptId: string
  slug: string
  difficulty: number
  hasPassedTest: boolean
}

/**
 * The overview of concepts a learner can take a Transfer Test on (ADR-0015:
 * eligible as soon as a concept reaches Practiced, no exercise-count
 * threshold). The language is the same 'rust' scope as the practice list
 * (issue #8's language until tickets #19/#20 land).
 */
export type TransferTestOverview = {
  language: SandboxLanguage
  concepts: TransferTestEligibleConcept[]
}

/**
 * Input to generating a Transfer Test exercise: the already-Practiced
 * concept to test transfer on.
 */
export const GenerateTransferTestInputSchema = z.object({
  conceptId: z.uuid(),
})

export type GenerateTransferTestInput = z.infer<
  typeof GenerateTransferTestInputSchema
>

/**
 * The generated (or reused) Transfer Test exercise (issue #17): just enough
 * for the UI to hand the learner off to it in the practice list — the
 * exercise itself is solved through the ordinary practice submission flow
 * (ADR-0010: a Transfer Test is "a structurally different exercise" on the
 * concept, not a separate submission surface). `reused` is true when a
 * Transfer Test was already generated for this learner+concept and this
 * call returned the existing instance rather than generating a new one.
 */
export type TransferTestExerciseView = {
  exerciseId: string
  slug: string
  title: string
  conceptSlug: string
  reused: boolean
}

/** Stable public transfer-test error codes. */
export type TransferTestErrorCode =
  | 'CONCEPT_NOT_FOUND'
  | 'CONCEPT_NOT_ELIGIBLE'
  | 'TRANSFER_TEST_GENERATION_FAILED'

const TRANSFER_TEST_ERROR_MESSAGES: Record<TransferTestErrorCode, string> = {
  CONCEPT_NOT_FOUND: 'Concept not found.',
  CONCEPT_NOT_ELIGIBLE: 'This concept is not eligible for a Transfer Test yet.',
  TRANSFER_TEST_GENERATION_FAILED:
    'The Transfer Test exercise could not be generated. Try again.',
}

/** Safe error surfaced by the transfer-test server boundary. */
export class TransferTestError extends Error {
  readonly code: TransferTestErrorCode

  /** Creates a safe transfer-test feature error. */
  constructor(code: TransferTestErrorCode) {
    super(TRANSFER_TEST_ERROR_MESSAGES[code])
    this.name = 'TransferTestError'
    this.code = code
  }
}
