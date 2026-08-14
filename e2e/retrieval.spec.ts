import { expect, test } from '@playwright/test'
import { eq } from 'drizzle-orm'

import { db } from '../src/db/client.server'
import {
  concepts,
  exerciseConcepts,
  exercises,
  learnerConceptMastery,
  retrievalQueue,
  retrievalReviewExercises,
} from '../src/db/schema'
import { getCurrentLearnerId } from '../src/features/learners/learners.server'

test.setTimeout(240_000)

/**
 * The Retrieval Queue entry surface (issue #18 AC 3): the /retrieval Daily
 * Review page lists a due concept and "Start Daily Review" begins the
 * Refresher Test on it. This spec seeds a due queue row backed by a
 * verified exercise (the deterministic, AI-free path — the e2e server
 * force-fails every AI call via `E2E_FORCE_AI_FAILURE`, issue #93, so the
 * generation fallback is out of scope here), mirroring the fixture pattern
 * of `tactical-sprint.spec.ts`'s "generated-style" exercise. Slugs are
 * namespaced `e2e.retrieval.*` and removed in `afterAll`.
 */
const FIXTURE_CONCEPT_SLUG = 'e2e.retrieval.due-now'
const FIXTURE_EXERCISE_SLUG = 'e2e-retrieval-due-now'

let fixtureConceptId: string
let fixtureExerciseId: string

/** Removes any rows this spec owns so reruns start from a clean state. */
async function cleanupFixture(): Promise<void> {
  const fixtureConcept = await db.query.concepts.findFirst({
    where: eq(concepts.slug, FIXTURE_CONCEPT_SLUG),
  })
  if (fixtureConcept) {
    await db
      .delete(retrievalQueue)
      .where(eq(retrievalQueue.conceptId, fixtureConcept.id))
    await db
      .delete(retrievalReviewExercises)
      .where(eq(retrievalReviewExercises.conceptId, fixtureConcept.id))
    await db
      .delete(learnerConceptMastery)
      .where(eq(learnerConceptMastery.conceptId, fixtureConcept.id))
    await db
      .delete(exerciseConcepts)
      .where(eq(exerciseConcepts.conceptId, fixtureConcept.id))
  }
  await db.delete(exercises).where(eq(exercises.slug, FIXTURE_EXERCISE_SLUG))
  await db.delete(concepts).where(eq(concepts.slug, FIXTURE_CONCEPT_SLUG))
}

test.describe('Daily Review on a due concept (AC 3)', () => {
  test.beforeAll(async () => {
    await cleanupFixture()
    const learnerId = await getCurrentLearnerId()
    const conceptRows = await db
      .insert(concepts)
      .values({
        language: 'rust',
        slug: FIXTURE_CONCEPT_SLUG,
        difficulty: 2,
      })
      .returning({ id: concepts.id })
    const exerciseRows = await db
      .insert(exercises)
      .values({
        slug: FIXTURE_EXERCISE_SLUG,
        language: 'rust',
        title: 'Daily Review: return ownership of the string',
        prompt:
          'Implement `own(s: &str) -> String` returning an owned copy of the input.',
        starterCode: `pub fn own(s: &str) -> String {
    String::new()
}
`,
        testSource: `#[test]
fn returns_an_owned_copy() {
    assert_eq!(exercise::own("hi"), "hi".to_string());
}
`,
        referenceSolution: `pub fn own(s: &str) -> String {
    s.to_string()
}
`,
        evaluationRubric: {
          required: ['Returns an owned String'],
          prohibited: [],
          advisory: [],
        },
        mode: 'implement',
        difficulty: 2,
        constraints: ['std_only'],
        status: 'verified',
      })
      .returning({ id: exercises.id })
    const conceptId = conceptRows[0]?.id
    const exerciseId = exerciseRows[0]?.id
    if (!conceptId || !exerciseId) {
      throw new Error('expected the fixture rows to be inserted')
    }
    fixtureConceptId = conceptId
    fixtureExerciseId = exerciseId
    await db.insert(exerciseConcepts).values({ exerciseId, conceptId })
    // A stage-0 row past its 24h due time: the concept is overdue and must
    // appear in the queue's Due bucket without any remediation boost.
    await db.insert(retrievalQueue).values({
      learnerId,
      conceptId,
      scheduleStage: 0,
      dueAt: new Date(Date.now() - 60 * 60 * 1000),
      priorityScore: 20,
    })
  })

  test.afterAll(async () => {
    await cleanupFixture()
  })

  test('lists the due concept and starts its Refresher Test on the reusable verified exercise', async ({
    page,
  }) => {
    await page.goto('/retrieval')

    await expect(
      page.getByRole('heading', { name: 'Daily Review.' }),
    ).toBeVisible()

    await expect(
      page.getByRole('heading', { name: 'Retrieval Queue' }),
    ).toBeVisible()
    await expect(page.getByText(FIXTURE_CONCEPT_SLUG)).toBeVisible()
    await expect(page.getByText(/overdue by/)).toBeVisible()

    await page.getByRole('button', { name: 'Start Daily Review' }).click()

    // Reuses the seeded verified exercise (no AI call — the concept has
    // one), so the hand-off names it and tells the learner to solve it in
    // the practice list.
    await expect(
      page.getByText(
        new RegExp(
          `Daily Review started for ${FIXTURE_CONCEPT_SLUG} — Daily Review: return ownership of the string`,
        ),
      ),
    ).toBeVisible()

    // The started review is registered so a later submission applies the
    // pass/fail review semantics (promote to Retained / revert + remediation).
    const learnerId = await getCurrentLearnerId()
    const registered = await db.query.retrievalReviewExercises.findFirst({
      where: (row, { and, eq: whereEq }) =>
        and(
          whereEq(row.learnerId, learnerId),
          whereEq(row.conceptId, fixtureConceptId),
        ),
    })
    expect(registered?.exerciseId).toBe(fixtureExerciseId)
  })
})
