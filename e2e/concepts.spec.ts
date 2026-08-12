import { expect, test, type Locator, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'

test.setTimeout(240_000)

/**
 * Self-contained fixture for the `/concepts` review route (issue #79): the
 * e2e seeds its own Concept Graph rows directly into Postgres so the review
 * surface is deterministic without needing the AI Teacher Engine. Slugs are
 * namespaced `e2e.graph.*` and removed in `afterAll`.
 */
const SQL = postgres(
  process.env.DATABASE_URL ?? 'postgres://teach:teach@localhost:5432/teach',
  { max: 1 },
)

const SLUGS = ['e2e.graph.a', 'e2e.graph.b', 'e2e.graph.c'] as const
const IDs = { a: randomUUID(), b: randomUUID(), c: randomUUID() }

/** Removes any rows this spec owns so reruns start from a clean graph. */
async function cleanupFixture(): Promise<void> {
  await SQL`
    delete from concept_edges
    where from_concept_id in ${SQL([IDs.a, IDs.b, IDs.c])}
       or to_concept_id in ${SQL([IDs.a, IDs.b, IDs.c])}`
  await SQL`delete from concepts where slug in ${SQL([...SLUGS])}`
}

test.beforeAll(async () => {
  await cleanupFixture()
  await SQL`
    insert into concepts (id, language, slug, difficulty, status)
    values
      (${IDs.a}, 'rust', 'e2e.graph.a', 2, 'draft'),
      (${IDs.b}, 'rust', 'e2e.graph.b', 3, 'draft'),
      (${IDs.c}, 'rust', 'e2e.graph.c', 4, 'draft')`
  // a ↔ b both prerequisite forms a cycle, excluding both edges (ADR-0016).
  await SQL`
    insert into concept_edges (from_concept_id, to_concept_id, kind)
    values
      (${IDs.a}, ${IDs.b}, 'prerequisite'),
      (${IDs.b}, ${IDs.a}, 'prerequisite')`
})

test.afterAll(async () => {
  await cleanupFixture()
  await SQL.end()
})

/** The review card for one fixture concept, scoped by its heading. */
function conceptCard(page: Page, slug: string): Locator {
  return page.locator('[data-slot="card"]', {
    has: page.getByRole('heading', { name: slug, exact: true }),
  })
}

test('renders the concept review route for the default language', async ({
  page,
}) => {
  await page.goto('/concepts')

  await expect(
    page.getByRole('heading', {
      name: 'rust concepts — structural review.',
    }),
  ).toBeVisible()

  // The language switcher marks rust as the active/default language.
  await expect(
    page.getByRole('button', { name: 'rust', exact: true }),
  ).toHaveClass(/bg-primary/)
})

test('shows the card-level excluded badge for cycle edges', async ({
  page,
}) => {
  await page.goto('/concepts')

  // a ↔ b prerequisite edges both fail Concept Validation as a cycle.
  await expect(conceptCard(page, 'e2e.graph.a')).toContainText(
    'Excluded — cycle',
  )
  await expect(conceptCard(page, 'e2e.graph.b')).toContainText(
    'Excluded — cycle',
  )
  // A concept with only ok edges shows no excluded badge.
  await expect(conceptCard(page, 'e2e.graph.c')).not.toContainText(/Excluded/)
})

test('toggles a concept review status round-trip', async ({ page }) => {
  await page.goto('/concepts')

  const card = conceptCard(page, 'e2e.graph.a')
  await expect(card).toContainText('draft')

  await card.getByRole('button', { name: 'Mark approved' }).click()
  await expect(card).toContainText('approved')

  await card.getByRole('button', { name: 'Mark draft' }).click()
  await expect(card).toContainText('draft')
})

test('adds and removes an edge during review', async ({ page }) => {
  await page.goto('/concepts')

  const card = conceptCard(page, 'e2e.graph.a')

  // Add a related edge from a → c.
  await card.getByLabel('Target slug').fill('e2e.graph.c')
  await card.getByLabel('Kind').selectOption('related')
  await card.getByRole('button', { name: 'Add', exact: true }).click()

  const edgeRow = card.locator('li', { hasText: 'related to e2e.graph.c' })
  await expect(edgeRow).toBeVisible()

  // Remove it again — the review surface round-trips without a page reload.
  await edgeRow.getByRole('button', { name: 'Remove' }).click()
  await expect(edgeRow).toBeHidden()
})

test('draft trigger surfaces a graceful failure when the AI is unreachable', async ({
  page,
}) => {
  await page.goto('/concepts')

  await page.getByRole('button', { name: 'Draft rust concepts' }).click()

  // The draft hits the AI Teacher Engine, which is unreachable in the e2e
  // environment; the review UI must show the mapped error, not crash.
  await expect(
    page.getByText('The Concept Graph draft could not be generated.'),
  ).toBeVisible({ timeout: 60_000 })
})
