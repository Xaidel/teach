import { expect, test } from '@playwright/test'
import { eq } from 'drizzle-orm'

import { db } from '../src/db/client.server'
import {
  attemptHints,
  attempts,
  concepts,
  exerciseConcepts,
  exercises,
  learnerConceptMastery,
} from '../src/db/schema'

test.setTimeout(240_000)

const HARDCODED_EXERCISES = [
  {
    title: 'Is it even? (Go)',
    code: `package exercise

func IsEven(n uint32) bool {
	return n%2 == 0
}
`,
  },
  {
    title: 'Is it even? (Python)',
    code: `def is_even(n: int) -> bool:
    return n % 2 == 0
`,
  },
] as const

/**
 * Self-contained fixture for the Rust generated-exercise surface (issue
 * #8): the e2e seeds its own verified exercise + Concept Graph concept +
 * exercise_concepts join through the shared `src/db` client, so the page
 * renders and evaluates a generated-style Rust exercise deterministically
 * without needing the AI Teacher Engine. Slugs are namespaced `e2e.*` and
 * removed in `afterAll` (by slug, so a crashed run's leftover rows are
 * found and removed too).
 */
const FIXTURE_CONCEPT_SLUG = 'e2e.rust.borrowing'
const FIXTURE_EXERCISE_SLUG = 'e2e-generated-rust-borrowing'
/**
 * A second, deliberately bare concept: no verified exercise ever joined to
 * it. The "AI unreachable" test below needs this — `generateExerciseForConcept`'s
 * circuit breaker (SPEC story 34) serves any existing verified exercise for
 * the target concept once every generation attempt fails, so a total outage
 * only surfaces the error UI when nothing already exists to fall back to.
 * `FIXTURE_CONCEPT_SLUG` above always has one (`FIXTURE_EXERCISE_SLUG`,
 * seeded right below), which would silently rescue that request instead.
 */
const NO_FALLBACK_CONCEPT_SLUG = 'e2e.rust.generation_unreachable'

/** Removes any rows this spec owns so reruns start from a clean state. */
async function cleanupFixture(): Promise<void> {
  const fixtureConcept = await db.query.concepts.findFirst({
    where: eq(concepts.slug, FIXTURE_CONCEPT_SLUG),
  })
  if (fixtureConcept) {
    // Submitting the fixture exercise advances Learner Model mastery for
    // this concept (ADR-0010, ticket #10) — that row must go before the
    // concept itself, or the FK from learner_concept_mastery blocks it.
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
    await db.delete(exercises).where(eq(exercises.id, fixtureExercise.id))
  }
  await db.delete(concepts).where(eq(concepts.slug, FIXTURE_CONCEPT_SLUG))
  await db.delete(concepts).where(eq(concepts.slug, NO_FALLBACK_CONCEPT_SLUG))
}

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
      title: 'Generated: borrow the vector',
      prompt:
        'Implement `first(v: &Vec<u32>) -> u32` returning the first element without consuming the vector.',
      starterCode: `pub fn first(v: Vec<u32>) -> u32 {
    v[0]
}
`,
      testSource: `#[test]
fn borrows_its_argument() {
    let v = vec![1, 2];
    assert_eq!(exercise::first(&v), 1);
    assert_eq!(v.len(), 2, "the vector must not be consumed");
}

#[test]
fn handles_single_element() {
    assert_eq!(exercise::first(&vec![7]), 7);
}

#[test]
fn first_of_empty_is_zero() {
    assert_eq!(exercise::first(&vec![]), 0);
}
`,
      referenceSolution: `pub fn first(v: &Vec<u32>) -> u32 {
    v.first().copied().unwrap_or(0)
}
`,
      evaluationRubric: {
        required: ['Takes the vector by reference'],
        prohibited: ['Consumes the vector with into_iter'],
        advisory: ['Keeps the body to a single expression'],
      },
      mode: 'implement',
      difficulty: 2,
      constraints: ['std_only'],
      status: 'verified',
    })
    .returning({ id: exercises.id })
  const fixtureConceptId = conceptRows[0]?.id
  const fixtureExerciseId = exerciseRows[0]?.id
  if (!fixtureConceptId || !fixtureExerciseId) {
    throw new Error('expected the fixture rows to be inserted')
  }
  await db.insert(exerciseConcepts).values({
    exerciseId: fixtureExerciseId,
    conceptId: fixtureConceptId,
  })
  await db.insert(concepts).values({
    language: 'rust',
    slug: NO_FALLBACK_CONCEPT_SLUG,
    difficulty: 2,
  })
})

test.afterAll(async () => {
  await cleanupFixture()
})

test('submits code and receives a pass/fail result end to end for each hardcoded language', async ({
  page,
}) => {
  await page.goto('/practice')

  await expect(
    page.getByRole('heading', {
      name: 'Teach — practice in three languages.',
    }),
  ).toBeVisible()

  for (const exercise of HARDCODED_EXERCISES) {
    const article = page.getByRole('article', {
      name: exercise.title,
      exact: true,
    })

    // The seeded starter code compiles but fails at least one test.
    await article.getByRole('button', { name: 'Submit for evaluation' }).click()
    await expect(article.getByText(/Failed —/)).toBeVisible({
      timeout: 120_000,
    })

    // The correct solution passes every test.
    await article.getByLabel('Your solution').fill(exercise.code)
    await article.getByRole('button', { name: 'Submit for evaluation' }).click()
    await expect(article.getByText(/Passed — all 3 tests/)).toBeVisible({
      timeout: 120_000,
    })
  }
})

test('submits a generated-style Rust exercise end to end (issue #8)', async ({
  page,
}) => {
  await page.goto('/practice')

  const article = page.getByRole('article', {
    name: 'Generated: borrow the vector',
    exact: true,
  })
  await expect(article).toBeVisible()

  // The generated starter code compiles but fails the concept tests.
  await article.getByRole('button', { name: 'Submit for evaluation' }).click()
  await expect(article.getByText(/Failed —/)).toBeVisible({
    timeout: 120_000,
  })

  // The correct solution passes every test.
  await article.getByLabel('Your solution')
    .fill(`pub fn first(v: &Vec<u32>) -> u32 {
    v.first().copied().unwrap_or(0)
}
`)
  await article.getByRole('button', { name: 'Submit for evaluation' }).click()
  await expect(article.getByText(/Passed — all 3 tests/)).toBeVisible({
    timeout: 120_000,
  })
})

test('generation surfaces a graceful failure when the AI is unreachable', async ({
  page,
}) => {
  await page.goto('/practice')

  await page
    .getByRole('combobox', { name: 'Target concept' })
    .selectOption(NO_FALLBACK_CONCEPT_SLUG)
  await page.getByRole('button', { name: 'Generate rust exercise' }).click()

  // E2E_FORCE_AI_FAILURE (issue #93) force-fails every AI call at the choke
  // point — the page must show the mapped error, not crash. Targets
  // NO_FALLBACK_CONCEPT_SLUG specifically: FIXTURE_CONCEPT_SLUG already has
  // a verified exercise, which the circuit breaker would serve instead of
  // failing once every generation attempt is exhausted.
  await expect(
    page.getByText('The exercise could not be generated. Try again.'),
  ).toBeVisible({ timeout: 60_000 })
})

test('sets and persists the explanation depth and reference frame (issue #12)', async ({
  page,
}) => {
  await page.goto('/practice')

  const panel = page.getByRole('region', { name: 'Explanation preferences' })
  await expect(panel).toBeVisible()

  await panel
    .getByRole('button', { name: '5 · Runtime/Compiler internals' })
    .click()
  await expect(
    panel.getByRole('button', { name: '5 · Runtime/Compiler internals' }),
  ).toHaveAttribute('aria-pressed', 'true')

  await panel
    .getByLabel('Reference frame (optional)')
    .fill('as a senior JavaScript developer')
  await panel.getByRole('button', { name: 'Save' }).click()

  // Reloading re-fetches the persisted preferences through the route
  // loader — a real page load, not just component state.
  await page.reload()

  const reloadedPanel = page.getByRole('region', {
    name: 'Explanation preferences',
  })
  await expect(
    reloadedPanel.getByRole('button', {
      name: '5 · Runtime/Compiler internals',
    }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(
    reloadedPanel.getByLabel('Reference frame (optional)'),
  ).toHaveValue('as a senior JavaScript developer')

  // Reset back to the default so this spec leaves shared v1 learner state
  // as it found it for other e2e specs run in the same suite.
  await reloadedPanel.getByRole('button', { name: '3 · Developer' }).click()
  await reloadedPanel.getByLabel('Reference frame (optional)').fill('')
  await reloadedPanel.getByRole('button', { name: 'Save' }).click()
})

test('escalates the manual Socratic hint ladder one level at a time', async ({
  page,
}) => {
  await page.goto('/practice')

  const article = page.getByRole('article', {
    name: 'Is it even? (Go)',
    exact: true,
  })

  await article.getByRole('button', { name: 'Submit for evaluation' }).click()
  await expect(article.getByText(/Failed —/)).toBeVisible({
    timeout: 120_000,
  })

  // A failed attempt always exposes the manual ladder controls, letting the
  // learner choose their next level of help.
  await expect(
    article.getByText('Choose how much help you want next.'),
  ).toBeVisible()

  const hintButton = article.getByRole('button', {
    name: /Get Level 0 hint|Request Level 1/,
  })
  await hintButton.click()

  // The request resolves to either a served hint (when the AI Teacher
  // Engine produced one) or a graceful failure message — the ladder never
  // crashes the attempt.
  await expect(
    article
      .getByText(/Your hint · Level (0|1)/)
      .or(
        article.getByText(
          'The requested hint could not be generated. Try again.',
        ),
      ),
  ).toBeVisible({ timeout: 60_000 })
})
