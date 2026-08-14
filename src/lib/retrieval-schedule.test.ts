import { describe, expect, it } from 'vitest'

import {
  RETRIEVAL_FAILURE_STAGE,
  RETRIEVAL_REMEDIATION_PRIORITY_BOOST,
  RETRIEVAL_SCHEDULE_DAYS,
  RETRIEVAL_STAGE_MAX,
  computeRetrievalPriorityScore,
  isRetrievalRemediationScore,
  retrievalNextStage,
  retrievalStageDelayMs,
} from './retrieval-schedule'

describe('retrieval-schedule', () => {
  describe('retrievalStageDelayMs', () => {
    it('maps stage 0-4 onto the fixed 24h/3d/7d/21d/60d schedule', () => {
      const hourMs = 60 * 60 * 1000
      const dayMs = 24 * hourMs
      expect(RETRIEVAL_SCHEDULE_DAYS).toEqual([1, 3, 7, 21, 60])
      expect(retrievalStageDelayMs(0)).toBe(dayMs)
      expect(retrievalStageDelayMs(1)).toBe(3 * dayMs)
      expect(retrievalStageDelayMs(2)).toBe(7 * dayMs)
      expect(retrievalStageDelayMs(3)).toBe(21 * dayMs)
      expect(retrievalStageDelayMs(4)).toBe(60 * dayMs)
    })

    it('throws for a stage outside 0-4', () => {
      expect(() => retrievalStageDelayMs(-1)).toThrow(/out of range/)
      expect(() => retrievalStageDelayMs(5)).toThrow(/out of range/)
    })
  })

  describe('retrievalNextStage', () => {
    it('advances one stage up to the final 60-day stage', () => {
      expect(retrievalNextStage(0)).toBe(1)
      expect(retrievalNextStage(1)).toBe(2)
      expect(retrievalNextStage(2)).toBe(3)
      expect(retrievalNextStage(3)).toBe(4)
    })

    it('caps at the final stage — success at 60d stays at 60d', () => {
      expect(retrievalNextStage(RETRIEVAL_STAGE_MAX)).toBe(RETRIEVAL_STAGE_MAX)
      expect(retrievalNextStage(4)).toBe(4)
    })
  })

  describe('computeRetrievalPriorityScore', () => {
    const now = new Date('2026-08-14T12:00:00Z')

    it('scores a fresh row by difficulty alone (no overdue, no failure)', () => {
      const score = computeRetrievalPriorityScore({
        dueAt: null,
        now,
        difficulty: 3,
        failedLastReview: false,
      })
      expect(score).toBe(30)
    })

    it('weighs recency by overdue hours', () => {
      const dueAt = new Date(now.getTime() - 2 * 60 * 60 * 1000)
      const score = computeRetrievalPriorityScore({
        dueAt,
        now,
        difficulty: 1,
        failedLastReview: false,
      })
      expect(score).toBe(4 + 10)
    })

    it('ignores lead time — a row not yet due scores no recency term', () => {
      const dueAt = new Date(now.getTime() + 24 * 60 * 60 * 1000)
      const score = computeRetrievalPriorityScore({
        dueAt,
        now,
        difficulty: 5,
        failedLastReview: false,
      })
      expect(score).toBe(50)
    })

    it('adds the remediation boost on a failed retrieval', () => {
      const score = computeRetrievalPriorityScore({
        dueAt: null,
        now,
        difficulty: 2,
        failedLastReview: true,
      })
      expect(score).toBe(RETRIEVAL_REMEDIATION_PRIORITY_BOOST + 20)
    })

    it('never lets the boost be overtaken by recency terms', () => {
      // A year of overdue time plus a max-difficulty concept stays well
      // below the remediation boost.
      const dueAt = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
      const score = computeRetrievalPriorityScore({
        dueAt,
        now,
        difficulty: 5,
        failedLastReview: false,
      })
      expect(score).toBeLessThan(RETRIEVAL_REMEDIATION_PRIORITY_BOOST)
    })
  })

  describe('isRetrievalRemediationScore', () => {
    it('is true exactly at or above the boost threshold', () => {
      expect(
        isRetrievalRemediationScore(RETRIEVAL_REMEDIATION_PRIORITY_BOOST),
      ).toBe(true)
      expect(
        isRetrievalRemediationScore(RETRIEVAL_REMEDIATION_PRIORITY_BOOST - 1),
      ).toBe(false)
      expect(isRetrievalRemediationScore(0)).toBe(false)
    })
  })

  describe('RETRIEVAL_FAILURE_STAGE', () => {
    it('resets a failed retrieval to the shortest interval (stage 0)', () => {
      expect(RETRIEVAL_FAILURE_STAGE).toBe(0)
    })
  })
})
