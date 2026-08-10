import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rows: [] as { id: string }[],
}))

vi.mock('#/db/client.server', () => ({
  db: {
    select: () => ({
      from: () => Promise.resolve(mocks.rows),
    }),
  },
}))

import { getCurrentLearnerId } from './learners.server'

describe('getCurrentLearnerId', () => {
  beforeEach(() => {
    mocks.rows = []
  })

  it('returns the id when exactly one learner row exists', async () => {
    mocks.rows = [{ id: '11111111-1111-7111-8111-111111111111' }]
    await expect(getCurrentLearnerId()).resolves.toBe(
      '11111111-1111-7111-8111-111111111111',
    )
  })

  it('throws and points at db:seed when no learner row exists', async () => {
    await expect(getCurrentLearnerId()).rejects.toThrow(/db:seed/)
  })

  it('throws when more than one learner row exists', async () => {
    mocks.rows = [
      { id: '11111111-1111-7111-8111-111111111111' },
      { id: '22222222-2222-7222-8222-222222222222' },
    ]
    await expect(getCurrentLearnerId()).rejects.toThrow(/exactly one/)
  })
})
