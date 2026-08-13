import { expect, test, type Locator, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'

import { db } from '../src/db/client.server'
import { conceptEdges, concepts, learnerConceptMastery } from '../src/db/schema'

test.setTimeout(240_000)

/**
 * Self-contained fixture for the Class A curriculum routes (issue #14): the
 * e2e seeds its own small prerequisite chain through the shared `src/db`
 * client, so the sequence and its lock states render deterministically
 * without the AI Teacher Engine. Slugs are namespaced `e2e.curriculum.*`
 * and removed in `afterAll` (by slug, so a crashed run's leftover rows are
 * found and removed too).
 */
const IDs = { root: randomUUID(), basic: randomUUID() }

/** Removes any rows this spec owns so reruns start from a clean chain. */
async function cleanupFixture(): Promise<void> {
  for (const id of Object.values(IDs)) {
    await db
      .delete(learnerConceptMastery)
      .where(eq(learnerConceptMastery.conceptId, id))
    await db.delete(conceptEdges).where(eq(conceptEdges.fromConceptId, id))
    await db.delete(conceptEdges).where(eq(conceptEdges.toConceptId, id))
  }
  await db.delete(concepts).where(eq(concepts.slug, 'e2e.curriculum.root'))
  await db.delete(concepts).where(eq(concepts.slug, 'e2e.curriculum.basic'))
}

test.beforeAll(async () => {
  await cleanupFixture()
  await db.insert(concepts).values([
    {
      id: IDs.root,
      language: 'rust',
      slug: 'e2e.curriculum.root',
      difficulty: 1,
    },
    {
      id: IDs.basic,
      language: 'rust',
      slug: 'e2e.curriculum.basic',
      difficulty: 2,
    },
  ])
  await db.insert(conceptEdges).values({
    fromConceptId: IDs.root,
    toConceptId: IDs.basic,
    kind: 'prerequisite',
  })
})

test.afterAll(async () => {
  await cleanupFixture()
})

/** The step card on the sequence page, scoped by its slug heading. */
function stepCard(page: Page, slug: string): Locator {
  return page.locator('[data-slot="card"]', {
    has: page.getByRole('heading', { name: slug, exact: true }),
  })
}

test('renders the curriculum sequence in prerequisite order with lock states', async ({
  page,
}) => {
  await page.goto('/curriculum')

  await expect(
    page.getByRole('heading', { name: 'The rust curriculum.' }),
  ).toBeVisible()

  // The chain's root has no prerequisites: it is available and links into
  // the step page; the child is locked behind its un-Practiced prerequisite.
  const rootCard = stepCard(page, 'e2e.curriculum.root')
  await expect(rootCard).toContainText('Available')
  await expect(rootCard).toContainText('No prerequisites')
  await expect(rootCard.getByRole('link', { name: 'Start' })).toBeVisible()

  const basicCard = stepCard(page, 'e2e.curriculum.basic')
  await expect(basicCard).toContainText('Locked')
  await expect(basicCard).toContainText(
    'Requires Practiced mastery of: e2e.curriculum.root.',
  )
})

test('shows the locked panel instead of step artifacts for a gated step', async ({
  page,
}) => {
  await page.goto('/curriculum/e2e.curriculum.basic')

  await expect(page.getByRole('heading', { name: 'Step locked' })).toBeVisible()
  await expect(page.getByText(/cannot be started yet/)).toBeVisible()
  await expect(page.getByText('e2e.curriculum.root')).toBeVisible()

  // No lesson or exercise slots render behind the gate.
  await expect(page.getByRole('heading', { name: 'Lesson' })).toHaveCount(0)
  await expect(
    page.getByRole('heading', { name: 'Guided exercise' }),
  ).toHaveCount(0)
})

test('renders lesson, guided, and independent slots for an unlocked step', async ({
  page,
}) => {
  await page.goto('/curriculum/e2e.curriculum.root')

  await expect(
    page.getByRole('heading', { name: 'Step 1 — e2e.curriculum.root' }),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Lesson' })).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Guided exercise' }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Independent exercise' }),
  ).toBeVisible()
})

test('lesson generation surfaces a graceful failure when the AI is unreachable', async ({
  page,
}) => {
  await page.goto('/curriculum/e2e.curriculum.root')

  await page.getByRole('button', { name: 'Generate lesson' }).click()

  // E2E_FORCE_AI_FAILURE (issue #93) force-fails every AI call at the choke
  // point — the lesson card must show the mapped error, not crash.
  await expect(
    page.getByText('The lesson could not be generated. Try again.'),
  ).toBeVisible({ timeout: 60_000 })
})

test('step exercise generation surfaces a graceful failure when the AI is unreachable', async ({
  page,
}) => {
  await page.goto('/curriculum/e2e.curriculum.root')

  await page.getByRole('button', { name: 'Generate guided exercise' }).click()

  await expect(
    page.getByText('The exercise could not be generated. Try again.'),
  ).toBeVisible({ timeout: 60_000 })
})
