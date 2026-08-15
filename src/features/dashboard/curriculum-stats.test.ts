import { describe, expect, it } from 'vitest'

import type { CurriculumStep } from '#/features/curriculum/curriculum.schema'

import { computeCurriculumStats } from './curriculum-stats'

function step(
  mastery: CurriculumStep['mastery'],
  status: CurriculumStep['status'],
): CurriculumStep {
  return {
    position: 1,
    concept: { id: 'c1', slug: 'rust.ownership', difficulty: 1 },
    prerequisites: [],
    mastery,
    status,
  }
}

describe('computeCurriculumStats', () => {
  it('returns zeros for an empty sequence, never dividing by zero', () => {
    expect(computeCurriculumStats([])).toEqual({
      complete: 0,
      total: 0,
      retained: 0,
      pct: 0,
    })
  })

  it('counts complete steps (Practiced or better) separately from Retained', () => {
    const steps = [
      step('unknown', 'locked'),
      step('introduced', 'started'),
      step('practiced', 'complete'),
      step('demonstrated', 'complete'),
      step('retained', 'complete'),
    ]

    expect(computeCurriculumStats(steps)).toEqual({
      complete: 3,
      total: 5,
      retained: 1,
      pct: 60,
    })
  })

  it('rounds the percentage to the nearest whole number', () => {
    const steps = [
      step('practiced', 'complete'),
      step('unknown', 'locked'),
      step('unknown', 'locked'),
    ]

    expect(computeCurriculumStats(steps).pct).toBe(33)
  })
})
