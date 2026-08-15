import { expect, test } from '@playwright/test'
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

test('renders the concept graph with lock states, and clicking an unlocked node opens that concept’s page', async ({
  page,
}) => {
  await page.goto('/curriculum')

  await expect(
    page.getByRole('heading', { name: 'Concept Graph — Rust' }),
  ).toBeVisible()

  // The chain's root has no prerequisites: it is available and renders as a
  // real link into its own step page; the child is locked behind its
  // un-Practiced prerequisite and renders as a button that explains the
  // gate instead of navigating (ConceptFlowNode).
  const rootLink = page.getByRole('link', {
    name: 'e2e.curriculum.root, available, difficulty 1. Open this concept.',
  })
  await expect(rootLink).toBeVisible()

  const basicButton = page.getByRole('button', {
    name: 'e2e.curriculum.basic, locked. Complete e2e.curriculum.root first.',
  })
  await expect(basicButton).toBeVisible()

  await basicButton.click()
  await expect(page.getByRole('status')).toContainText(
    'Locked — complete e2e.curriculum.root first.',
  )
  await expect(page).toHaveURL('/curriculum')

  await rootLink.click()
  await expect(page).toHaveURL('/curriculum/e2e.curriculum.root')
  await expect(
    page.getByRole('heading', { name: 'Step 1 — e2e.curriculum.root' }),
  ).toBeVisible()
})

test('shows the locked panel instead of step artifacts for a gated step', async ({
  page,
}) => {
  await page.goto('/curriculum/e2e.curriculum.basic')

  await expect(page.getByRole('heading', { name: 'Step locked' })).toBeVisible()
  await expect(page.getByText(/cannot be started yet/)).toBeVisible()
  await expect(page.getByText('e2e.curriculum.root')).toBeVisible()

  // No concept/exercise panels render behind the gate.
  await expect(
    page.getByRole('heading', { name: 'Guided exercise' }),
  ).toHaveCount(0)
})

test('renders the concept panel and the guided exercise slot for an unlocked step (NodeDetail.dc.html layout)', async ({
  page,
}) => {
  await page.goto('/curriculum/e2e.curriculum.root')

  await expect(
    page.getByRole('link', { name: '← Concept Graph' }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Step 1 — e2e.curriculum.root' }),
  ).toBeVisible()
  // The guided exercise slot is the one shown first — the independent slot
  // only appears after the guided attempt passes (ConceptExercisePanel's
  // onPassed), so it isn't on the page yet.
  await expect(
    page.getByRole('heading', { name: 'Guided exercise' }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Independent exercise' }),
  ).toHaveCount(0)
})

test('lesson generation surfaces a graceful failure when the AI is unreachable', async ({
  page,
}) => {
  await page.goto('/curriculum/e2e.curriculum.root')

  // The lesson now generates automatically on arrival (no button to click)
  // — E2E_FORCE_AI_FAILURE (issue #93) force-fails every AI call at the
  // choke point, so the concept panel must show the mapped error, not
  // crash, and offer a way to retry.
  await expect(
    page.getByText('The lesson could not be generated. Try again.'),
  ).toBeVisible({ timeout: 60_000 })
  await expect(
    page.getByRole('button', { name: 'Try again' }).first(),
  ).toBeVisible()
})

test('step exercise generation surfaces a graceful failure when the AI is unreachable', async ({
  page,
}) => {
  await page.goto('/curriculum/e2e.curriculum.root')

  // The guided exercise also generates automatically on arrival now.
  await expect(
    page.getByText('The exercise could not be generated. Try again.'),
  ).toBeVisible({ timeout: 60_000 })
  await expect(
    page.getByRole('button', { name: 'Try again' }).last(),
  ).toBeVisible()
})
