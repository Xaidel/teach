import { and, count, eq, sql } from 'drizzle-orm'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

vi.mock('#/lib/ai/functions.server', () => ({
  analyzeMisconceptions: vi.fn(),
}))

import { db } from '#/db/client.server'
import {
  attempts,
  conceptEdges,
  concepts,
  exerciseConcepts,
  exercises,
  learnerConceptMastery,
} from '#/db/schema'
import { TeacherEngineError } from '#/lib/ai/client.server'
import { analyzeMisconceptions } from '#/lib/ai/functions.server'
import type { AnalyzeMisconceptionsOutput } from '#/lib/ai/schemas'
import { getCurrentLearnerId } from '#/features/learners/learners.server'
import { advanceMastery } from '#/features/learners/mastery.server'

import {
  getExplanationAssessmentOverview,
  submitExplanationAssessment,
} from './explanation-assessment.server'
import { ExplanationAssessmentError } from './explanation-assessment.schema'

async function dbAvailable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`)
    return true
  } catch {
    return false
  }
}

const dbUp = await dbAvailable()
const analyzeMock = vi.mocked(analyzeMisconceptions)

const TARGET_SLUG = 'test.explanation.assessment.target'
const PREREQ_SLUG = 'test.explanation.assessment.prereq'
const RELATED_SLUG = 'test.explanation.assessment.related'

const NO_FINDINGS: AnalyzeMisconceptionsOutput = {
  missing: [],
  incorrect: [],
  conflated: [],
}

describe.skipIf(!dbUp)('explanation-assessment.server', () => {
  let learnerId: string
  let targetConceptId: string
  let prereqConceptId: string
  let relatedConceptId: string

  beforeAll(async () => {
    learnerId = await getCurrentLearnerId()

    const [prereq] = await db
      .insert(concepts)
      .values({ language: 'rust', slug: PREREQ_SLUG, difficulty: 1 })
      .returning()
    if (!prereq) throw new Error('expected a persisted concept')
    prereqConceptId = prereq.id

    const [related] = await db
      .insert(concepts)
      .values({ language: 'rust', slug: RELATED_SLUG, difficulty: 1 })
      .returning()
    if (!related) throw new Error('expected a persisted concept')
    relatedConceptId = related.id

    const [target] = await db
      .insert(concepts)
      .values({ language: 'rust', slug: TARGET_SLUG, difficulty: 2 })
      .returning()
    if (!target) throw new Error('expected a persisted concept')
    targetConceptId = target.id

    await db.insert(conceptEdges).values({
      fromConceptId: targetConceptId,
      toConceptId: prereqConceptId,
      kind: 'prerequisite',
    })
    await db.insert(conceptEdges).values({
      fromConceptId: targetConceptId,
      toConceptId: relatedConceptId,
      kind: 'related',
    })
  })

  afterAll(async () => {
    await db
      .delete(attempts)
      .where(
        and(
          eq(attempts.learnerId, learnerId),
          sql`${attempts.exerciseId} in (select ${exercises.id} from ${exercises} where ${exercises.slug} = ${`explain-${TARGET_SLUG}`})`,
        ),
      )
    await db
      .delete(exerciseConcepts)
      .where(eq(exerciseConcepts.conceptId, targetConceptId))
    await db
      .delete(exercises)
      .where(eq(exercises.slug, `explain-${TARGET_SLUG}`))
    await db
      .delete(learnerConceptMastery)
      .where(eq(learnerConceptMastery.conceptId, targetConceptId))
    await db
      .delete(conceptEdges)
      .where(eq(conceptEdges.fromConceptId, targetConceptId))
    await db.delete(concepts).where(eq(concepts.id, targetConceptId))
    await db.delete(concepts).where(eq(concepts.id, prereqConceptId))
    await db.delete(concepts).where(eq(concepts.id, relatedConceptId))
  })

  afterEach(async () => {
    vi.clearAllMocks()
    await db
      .delete(attempts)
      .where(
        and(
          eq(attempts.learnerId, learnerId),
          sql`${attempts.exerciseId} in (select ${exercises.id} from ${exercises} where ${exercises.slug} = ${`explain-${TARGET_SLUG}`})`,
        ),
      )
    await db
      .delete(exerciseConcepts)
      .where(eq(exerciseConcepts.conceptId, targetConceptId))
    await db
      .delete(exercises)
      .where(eq(exercises.slug, `explain-${TARGET_SLUG}`))
  })

  describe('getExplanationAssessmentOverview', () => {
    afterEach(async () => {
      await db
        .delete(learnerConceptMastery)
        .where(
          and(
            eq(learnerConceptMastery.learnerId, learnerId),
            eq(learnerConceptMastery.conceptId, targetConceptId),
          ),
        )
    })

    it('lists a Practiced concept as eligible with no passed assessment', async () => {
      await advanceMastery(learnerId, [targetConceptId], 'practiced')

      const overview = await getExplanationAssessmentOverview(learnerId)

      expect(overview.language).toBe('rust')
      expect(overview.concepts).toContainEqual({
        conceptId: targetConceptId,
        slug: TARGET_SLUG,
        difficulty: 2,
        hasPassedAssessment: false,
      })
    })

    it('does not list a concept that has not reached Practiced', async () => {
      await advanceMastery(learnerId, [targetConceptId], 'introduced')

      const overview = await getExplanationAssessmentOverview(learnerId)

      expect(
        overview.concepts.some(
          (concept) => concept.conceptId === targetConceptId,
        ),
      ).toBe(false)
    })

    it('annotates a concept with a passed assessment already recorded', async () => {
      await advanceMastery(learnerId, [targetConceptId], 'practiced')
      analyzeMock.mockResolvedValue(NO_FINDINGS)

      await submitExplanationAssessment({
        learnerId,
        conceptId: targetConceptId,
        explanation: 'A flawless explanation.',
      })

      const overview = await getExplanationAssessmentOverview(learnerId)

      expect(overview.concepts).toContainEqual({
        conceptId: targetConceptId,
        slug: TARGET_SLUG,
        difficulty: 2,
        hasPassedAssessment: true,
      })
    })
  })

  describe('submitExplanationAssessment', () => {
    beforeEach(async () => {
      await advanceMastery(learnerId, [targetConceptId], 'practiced')
    })

    afterEach(async () => {
      await db
        .delete(learnerConceptMastery)
        .where(
          and(
            eq(learnerConceptMastery.learnerId, learnerId),
            eq(learnerConceptMastery.conceptId, targetConceptId),
          ),
        )
    })

    it('rejects an unknown concept', async () => {
      await expect(
        submitExplanationAssessment({
          learnerId,
          conceptId: '00000000-0000-7000-8000-000000000000',
          explanation: 'x',
        }),
      ).rejects.toBeInstanceOf(ExplanationAssessmentError)
    })

    it('rejects a concept below Practiced as not eligible', async () => {
      await db
        .update(learnerConceptMastery)
        .set({ state: 'introduced' })
        .where(
          and(
            eq(learnerConceptMastery.learnerId, learnerId),
            eq(learnerConceptMastery.conceptId, targetConceptId),
          ),
        )

      await expect(
        submitExplanationAssessment({
          learnerId,
          conceptId: targetConceptId,
          explanation: 'x',
        }),
      ).rejects.toMatchObject({ code: 'CONCEPT_NOT_ELIGIBLE' })
    })

    it('rejects a concept already past Practiced as not eligible', async () => {
      await db
        .update(learnerConceptMastery)
        .set({ state: 'demonstrated' })
        .where(
          and(
            eq(learnerConceptMastery.learnerId, learnerId),
            eq(learnerConceptMastery.conceptId, targetConceptId),
          ),
        )

      await expect(
        submitExplanationAssessment({
          learnerId,
          conceptId: targetConceptId,
          explanation: 'x',
        }),
      ).rejects.toMatchObject({ code: 'CONCEPT_NOT_ELIGIBLE' })
    })

    it('maps an AI engine failure to EXPLANATION_ANALYSIS_FAILED without persisting', async () => {
      analyzeMock.mockRejectedValue(
        new TeacherEngineError('api_error', 'engine down'),
      )

      await expect(
        submitExplanationAssessment({
          learnerId,
          conceptId: targetConceptId,
          explanation: 'x',
        }),
      ).rejects.toMatchObject({ code: 'EXPLANATION_ANALYSIS_FAILED' })

      const [row] = await db
        .select({ value: count() })
        .from(attempts)
        .where(
          and(
            eq(attempts.learnerId, learnerId),
            sql`${attempts.exerciseId} in (select ${exercises.id} from ${exercises} where ${exercises.slug} = ${`explain-${TARGET_SLUG}`})`,
          ),
        )
      expect(row?.value ?? 0).toBe(0)
    })

    it('persists a passing assessment as an explain-mode attempt with the payload', async () => {
      analyzeMock.mockResolvedValue(NO_FINDINGS)

      const result = await submitExplanationAssessment({
        learnerId,
        conceptId: targetConceptId,
        explanation: 'Borrowing lets code use a value without owning it.',
      })

      expect(result.accuracyScore).toBe(1)
      expect(result.passed).toBe(true)
      expect(result.analysis).toEqual(NO_FINDINGS)
      // No Transfer Test evidence exists yet (ticket #17), so the concept
      // stays at Practiced: the ADR-0015 gate requires both signals.
      expect(result.masteryState).toBe('practiced')

      const [exercise] = await db
        .select()
        .from(exercises)
        .where(eq(exercises.slug, `explain-${TARGET_SLUG}`))
      expect(exercise).toBeDefined()
      expect(exercise?.mode).toBe('explain')
      expect(exercise?.status).toBe('verified')

      const [attemptRow] = await db
        .select()
        .from(attempts)
        .where(
          and(
            eq(attempts.learnerId, learnerId),
            eq(attempts.exerciseId, exercise?.id ?? ''),
          ),
        )
      // Explain-mode attempts carry no Stage 1 sandbox verdict: outcome is
      // NULL and the payload alone holds the accuracy signal (ADR-0010,
      // ADR-0021, review S1/P2).
      expect(attemptRow?.outcome).toBeNull()
      expect(attemptRow?.code).toBe(
        'Borrowing lets code use a value without owning it.',
      )
      expect(attemptRow?.explanationAssessment).toEqual({
        accuracyScore: 1,
        analysis: NO_FINDINGS,
      })
    })

    it('persists a failing assessment with a NULL outcome and keeps the concept at Practiced', async () => {
      analyzeMock.mockResolvedValue({
        ...NO_FINDINGS,
        missing: [
          { concept: PREREQ_SLUG, detail: 'omitted' },
          { concept: TARGET_SLUG, detail: 'omitted' },
        ],
      })

      const result = await submitExplanationAssessment({
        learnerId,
        conceptId: targetConceptId,
        explanation: 'A shaky explanation.',
      })

      expect(result.accuracyScore).toBe(0)
      expect(result.passed).toBe(false)
      expect(result.masteryState).toBe('practiced')

      const [exercise] = await db
        .select()
        .from(exercises)
        .where(eq(exercises.slug, `explain-${TARGET_SLUG}`))
      const [attemptRow] = await db
        .select()
        .from(attempts)
        .where(
          and(
            eq(attempts.learnerId, learnerId),
            eq(attempts.exerciseId, exercise?.id ?? ''),
          ),
        )
      expect(attemptRow?.outcome).toBeNull()
      expect(attemptRow?.explanationAssessment).toEqual({
        accuracyScore: 0,
        analysis: {
          missing: [
            { concept: PREREQ_SLUG, detail: 'omitted' },
            { concept: TARGET_SLUG, detail: 'omitted' },
          ],
          incorrect: [],
          conflated: [],
        },
      })
    })

    it('reuses one explain exercise row across repeated assessments', async () => {
      analyzeMock.mockResolvedValue(NO_FINDINGS)

      await submitExplanationAssessment({
        learnerId,
        conceptId: targetConceptId,
        explanation: 'First attempt.',
      })
      await submitExplanationAssessment({
        learnerId,
        conceptId: targetConceptId,
        explanation: 'Second attempt.',
      })

      const [row] = await db
        .select({ value: count() })
        .from(exercises)
        .where(eq(exercises.slug, `explain-${TARGET_SLUG}`))
      expect(row?.value ?? 0).toBe(1)

      const [attemptsCount] = await db
        .select({ value: count() })
        .from(attempts)
        .where(
          and(
            eq(attempts.learnerId, learnerId),
            sql`${attempts.exerciseId} in (select ${exercises.id} from ${exercises} where ${exercises.slug} = ${`explain-${TARGET_SLUG}`})`,
          ),
        )
      expect(attemptsCount?.value ?? 0).toBe(2)
    })

    describe('remediationConcepts', () => {
      it('is empty on a pass', async () => {
        analyzeMock.mockResolvedValue(NO_FINDINGS)

        const result = await submitExplanationAssessment({
          learnerId,
          conceptId: targetConceptId,
          explanation: 'A flawless explanation.',
        })

        expect(result.passed).toBe(true)
        expect(result.remediationConcepts).toEqual([])
      })

      it('always includes the assessed concept as the baseline on a failed attempt, even when nothing resolves', async () => {
        // Two incorrect-claim findings alone fail the threshold (1 - 0.5 =
        // 0.5 < 0.7) without naming any concept (incorrect findings carry no
        // `concept` field) — the baseline is the only thing that can cover
        // them.
        analyzeMock.mockResolvedValue({
          ...NO_FINDINGS,
          incorrect: [
            { claim: 'Wrong claim one.', correction: 'Correction one.' },
            { claim: 'Wrong claim two.', correction: 'Correction two.' },
          ],
        })

        const result = await submitExplanationAssessment({
          learnerId,
          conceptId: targetConceptId,
          explanation: 'Two wrong claims.',
        })

        expect(result.passed).toBe(false)
        expect(result.remediationConcepts).toEqual([TARGET_SLUG])
      })

      it('resolves a missing finding to its real prerequisite slug, normalized (trim + lowercase)', async () => {
        analyzeMock.mockResolvedValue({
          ...NO_FINDINGS,
          missing: [
            // Exact match against the required vocabulary — this is what
            // fails the deterministic accuracy formula.
            { concept: TARGET_SLUG, detail: 'omitted' },
            // Differently cased/padded — does not affect the accuracy
            // formula's exact match, but should still resolve here.
            { concept: `  ${PREREQ_SLUG.toUpperCase()}  `, detail: 'omitted' },
          ],
        })

        const result = await submitExplanationAssessment({
          learnerId,
          conceptId: targetConceptId,
          explanation: 'A shaky explanation.',
        })

        expect(result.passed).toBe(false)
        expect(result.remediationConcepts).toEqual([TARGET_SLUG, PREREQ_SLUG])
      })

      it('resolves a conflated finding entry to its real related slug and drops a non-resolving entry silently', async () => {
        analyzeMock.mockResolvedValue({
          ...NO_FINDINGS,
          missing: [{ concept: TARGET_SLUG, detail: 'omitted' }],
          conflated: [
            {
              concepts: [
                'not a real concept',
                ` ${RELATED_SLUG.toUpperCase()} `,
              ],
              detail: 'Blurred.',
            },
          ],
        })

        const result = await submitExplanationAssessment({
          learnerId,
          conceptId: targetConceptId,
          explanation: 'A conflated explanation.',
        })

        expect(result.passed).toBe(false)
        expect(result.remediationConcepts).toEqual([TARGET_SLUG, RELATED_SLUG])
        // The non-resolving string still renders as plain text in the raw
        // analysis — resolution only ever adds a pointer, never removes it.
        expect(result.analysis.conflated[0]?.concepts).toContain(
          'not a real concept',
        )
      })

      it('deduplicates a slug resolved from multiple findings', async () => {
        analyzeMock.mockResolvedValue({
          ...NO_FINDINGS,
          missing: [
            { concept: TARGET_SLUG, detail: 'omitted' },
            { concept: PREREQ_SLUG, detail: 'omitted' },
          ],
          conflated: [{ concepts: [PREREQ_SLUG, 'x'], detail: 'Blurred.' }],
        })

        const result = await submitExplanationAssessment({
          learnerId,
          conceptId: targetConceptId,
          explanation: 'A doubly-flagged explanation.',
        })

        expect(result.passed).toBe(false)
        expect(result.remediationConcepts).toEqual([TARGET_SLUG, PREREQ_SLUG])
      })
    })
  })
})
