import { expect, test } from '@playwright/test'
import { eq } from 'drizzle-orm'

import { db } from '../src/db/client.server'
import { getCurrentLearnerId } from '../src/features/learners/learners.server'
import {
  attemptHints,
  attempts,
  concepts,
  exerciseConcepts,
  exercises,
  learnerConceptMastery,
} from '../src/db/schema'

test.setTimeout(240_000)

/**
 * Self-contained fixture standing in for a Tactical Sprint's generated
 * exercise (ticket #13, AC5). The e2e suite's web server force-fails every
 * AI Teacher Engine call (`E2E_FORCE_AI_FAILURE`, `playwright.config.ts`,
 * issue #93), so a real paste-through-identify-through-generate run can
 * never succeed here — this fixture seeds the *outcome* of that pipeline
 * directly through the shared `src/db` client, mirroring `exercise.spec.ts`'s
 * "generated-style" fixture, so the UI hand-off + solve + Learner Model
 * update can still be proven end to end. Slugs are namespaced
 * `e2e.tactical-sprint.*` and removed in `afterAll`.
 */
const FIXTURE_CONCEPT_SLUG = 'e2e.tactical-sprint.ownership'
const FIXTURE_EXERCISE_SLUG = 'e2e-tactical-sprint-ownership'

let fixtureConceptId: string
let fixtureExerciseId: string

/** Removes any rows this spec owns so reruns start from a clean state. */
async function cleanupFixture(): Promise<void> {
  const fixtureConcept = await db.query.concepts.findFirst({
    where: eq(concepts.slug, FIXTURE_CONCEPT_SLUG),
  })
  if (fixtureConcept) {
    await db
      .delete(learnerConceptMastery)
      .where(eq(learnerConceptMastery.conceptId, fixtureConcept.id))
    await db
      .delete(exerciseConcepts)
      .where(eq(exerciseConcepts.conceptId, fixtureConcept.id))
  }
  const fixtureExercise = await db.query.exercises.findFirst({
    where: eq(exercises.slug, FIXTURE_EXERCISE_SLUG),
  })
  if (fixtureExercise) {
    const fixtureAttempts = await db
      .select({ id: attempts.id })
      .from(attempts)
      .where(eq(attempts.exerciseId, fixtureExercise.id))
    for (const attempt of fixtureAttempts) {
      await db
        .delete(attemptHints)
        .where(eq(attemptHints.attemptId, attempt.id))
    }
    await db.delete(attempts).where(eq(attempts.exerciseId, fixtureExercise.id))
  }
  await db.delete(exercises).where(eq(exercises.slug, FIXTURE_EXERCISE_SLUG))
  await db.delete(concepts).where(eq(concepts.slug, FIXTURE_CONCEPT_SLUG))
}

test.describe('hand-off to the generated exercise (AC5)', () => {
  test.beforeAll(async () => {
    await cleanupFixture()
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
        title: 'Sprint: return ownership of the string',
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
  })

  test.afterAll(async () => {
    await cleanupFixture()
  })

  test('the "Go solve it" hand-off lands on the exact generated exercise, and solving it advances the Learner Model', async ({
    page,
  }) => {
    // Simulates the hand-off `tactical-sprint-card.tsx` performs after a
    // real sprint run: `to="/practice" search={{ exerciseId }}`.
    await page.goto(`/practice?exerciseId=${fixtureExerciseId}`)

    const article = page.getByRole('article', {
      name: 'Sprint: return ownership of the string',
      exact: true,
    })
    await expect(article).toBeVisible()
    await expect(article.getByText('From Tactical Sprint')).toBeVisible()

    // The seeded starter code compiles but fails the concept test.
    await article.getByRole('button', { name: 'Submit for evaluation' }).click()
    await expect(article.getByText(/Failed —/)).toBeVisible({
      timeout: 120_000,
    })

    // The correct solution passes, which must advance this concept's
    // Learner Model mastery to `practiced` (AC5, ADR-0010).
    await article.getByLabel('Your solution')
      .fill(`pub fn own(s: &str) -> String {
    s.to_string()
}
`)
    await article.getByRole('button', { name: 'Submit for evaluation' }).click()
    await expect(article.getByText(/Passed — all 1 test/)).toBeVisible({
      timeout: 120_000,
    })

    const learnerId = await getCurrentLearnerId()
    const masteryRow = await db.query.learnerConceptMastery.findFirst({
      where: (row, { and, eq: whereEq }) =>
        and(
          whereEq(row.learnerId, learnerId),
          whereEq(row.conceptId, fixtureConceptId),
        ),
    })
    expect(masteryRow?.state).toBe('practiced')
  })
})

test('paste a snippet through the Tactical Sprint UI and surface a graceful failure when the AI is unreachable (ticket #13)', async ({
  page,
}) => {
  await page.goto('/tactical-sprint')

  await expect(
    page.getByRole('heading', {
      name: "Turn a snippet you don't understand into practice.",
    }),
  ).toBeVisible()

  await page
    .getByLabel('rust snippet')
    .fill('pub fn first(v: Vec<u32>) -> u32 { v[0] }')
  await page.getByRole('button', { name: 'Analyze snippet' }).click()

  // E2E_FORCE_AI_FAILURE (issue #93) force-fails every AI call at the choke
  // point — the identification step must show the mapped error, not crash.
  await expect(
    page.getByText('The snippet could not be analyzed. Try again.'),
  ).toBeVisible({ timeout: 60_000 })
})

test('links from the practice page to the Tactical Sprint route', async ({
  page,
}) => {
  await page.goto('/practice')

  await page
    .getByRole('link', {
      name: "Don't understand an AI-generated snippet? Try a Tactical Sprint →",
    })
    .click()

  await expect(page).toHaveURL(/\/tactical-sprint$/)
})
