import { describe, expect, it } from 'vitest'

import { resolveTargetLevel } from './hint-ladder'

describe('resolveTargetLevel', () => {
  it('serves level 0 as the first next-hint request', () => {
    expect(resolveTargetLevel([], 'next')).toBe(0)
  })

  it('escalates one level per next-hint request from level 0', () => {
    expect(resolveTargetLevel([0], 'next')).toBe(1)
    expect(resolveTargetLevel([0, 1], 'next')).toBe(2)
    expect(resolveTargetLevel([0, 1, 2], 'next')).toBe(3)
    expect(resolveTargetLevel([0, 1, 2, 3], 'next')).toBe(4)
  })

  it('stops next-hint progression after level 4', () => {
    expect(() => resolveTargetLevel([0, 1, 2, 3, 4], 'next')).toThrow(
      expect.objectContaining({ code: 'HINT_ESCALATION_INVALID' }),
    )
  })

  it('refuses next-hint requests once the full solution is served', () => {
    expect(() => resolveTargetLevel([0, 1, 2, 3, 4, 5], 'next')).toThrow(
      expect.objectContaining({ code: 'HINT_ESCALATION_INVALID' }),
    )
  })

  it('serves level 5 only via the full-solution action after level 4', () => {
    expect(resolveTargetLevel([0, 1, 2, 3, 4], 'full_solution')).toBe(5)
  })

  it('refuses the full-solution action before level 4 is served', () => {
    for (const servedLevels of [[], [0], [0, 1], [0, 1, 2], [0, 1, 2, 3]]) {
      expect(() => resolveTargetLevel(servedLevels, 'full_solution')).toThrow(
        expect.objectContaining({ code: 'HINT_ESCALATION_INVALID' }),
      )
    }
  })

  it('refuses a redundant full-solution action after level 5', () => {
    expect(() =>
      resolveTargetLevel([0, 1, 2, 3, 4, 5], 'full_solution'),
    ).toThrow(expect.objectContaining({ code: 'HINT_ESCALATION_INVALID' }))
  })
})
