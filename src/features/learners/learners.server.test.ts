import { beforeEach, describe, expect, it, vi } from 'vitest'

type LearnerIdRow = { id: string }
type PreferenceRow = { depth: number; referenceFrame: string | null }

const mocks = vi.hoisted(() => ({
  rows: [] as LearnerIdRow[],
  preferenceRows: [] as PreferenceRow[],
  updateReturning: [] as PreferenceRow[],
}))

/**
 * A thenable that also exposes `.where()`/`.limit()`. `db.select().from()`
 * awaited directly (the unfiltered `getCurrentLearnerId` shape) resolves to
 * `unfiltered`; chaining `.where()`/`.limit()` (the filtered
 * `getExplanationPreferences` shape) switches to `filtered`.
 */
function selectChain<TUnfiltered, TFiltered>(
  unfiltered: TUnfiltered[],
  filtered: TFiltered[],
) {
  const chained = {
    where: () => chained,
    limit: () => chained,
    then: (
      resolve: (value: TFiltered[]) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(filtered).then(resolve, reject),
  }
  return {
    where: () => chained,
    limit: () => chained,
    then: (
      resolve: (value: TUnfiltered[]) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(unfiltered).then(resolve, reject),
  }
}

vi.mock('#/db/client.server', () => ({
  db: {
    select: () => ({
      from: () => selectChain(mocks.rows, mocks.preferenceRows),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(mocks.updateReturning),
        }),
      }),
    }),
  },
}))

import {
  getCurrentLearnerId,
  getExplanationPreferences,
  updateExplanationPreferences,
} from './learners.server'

describe('getCurrentLearnerId', () => {
  beforeEach(() => {
    mocks.rows = []
    mocks.preferenceRows = []
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

describe('getExplanationPreferences', () => {
  beforeEach(() => {
    mocks.rows = []
    mocks.preferenceRows = []
  })

  it('returns the learner’s persisted depth and reference frame', async () => {
    mocks.preferenceRows = [{ depth: 4, referenceFrame: 'as a Go developer' }]

    await expect(getExplanationPreferences('learner-1')).resolves.toEqual({
      depth: 4,
      referenceFrame: 'as a Go developer',
    })
  })

  it('returns a null reference frame when none was set', async () => {
    mocks.preferenceRows = [{ depth: 3, referenceFrame: null }]

    await expect(getExplanationPreferences('learner-1')).resolves.toEqual({
      depth: 3,
      referenceFrame: null,
    })
  })

  it('throws when the learner row is missing', async () => {
    await expect(getExplanationPreferences('missing')).rejects.toThrow(
      /No learner row found/,
    )
  })
})

describe('updateExplanationPreferences', () => {
  beforeEach(() => {
    mocks.rows = []
    mocks.preferenceRows = []
    mocks.updateReturning = []
  })

  it('persists a new depth and returns the resulting preferences', async () => {
    mocks.updateReturning = [{ depth: 5, referenceFrame: null }]

    await expect(
      updateExplanationPreferences('learner-1', { depth: 5 }),
    ).resolves.toEqual({ depth: 5, referenceFrame: null })
  })

  it('persists a new reference frame independently of depth', async () => {
    mocks.updateReturning = [
      { depth: 3, referenceFrame: 'as a senior JavaScript developer' },
    ]

    await expect(
      updateExplanationPreferences('learner-1', {
        referenceFrame: 'as a senior JavaScript developer',
      }),
    ).resolves.toEqual({
      depth: 3,
      referenceFrame: 'as a senior JavaScript developer',
    })
  })

  it('clears a reference frame when passed null', async () => {
    mocks.updateReturning = [{ depth: 3, referenceFrame: null }]

    await expect(
      updateExplanationPreferences('learner-1', { referenceFrame: null }),
    ).resolves.toEqual({ depth: 3, referenceFrame: null })
  })

  it('is a no-op read when neither field is given', async () => {
    mocks.preferenceRows = [{ depth: 2, referenceFrame: null }]

    await expect(
      updateExplanationPreferences('learner-1', {}),
    ).resolves.toEqual({ depth: 2, referenceFrame: null })
  })

  it('throws when the learner row is missing', async () => {
    await expect(
      updateExplanationPreferences('missing', { depth: 1 }),
    ).rejects.toThrow(/No learner row found/)
  })
})
