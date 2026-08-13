import { expect, test } from '@playwright/test'

test.setTimeout(240_000)

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
  await page.goto('/')

  await page
    .getByRole('link', {
      name: "Don't understand an AI-generated snippet? Try a Tactical Sprint →",
    })
    .click()

  await expect(page).toHaveURL(/\/tactical-sprint$/)
})
