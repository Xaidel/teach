import { expect, test } from '@playwright/test'

test.setTimeout(240_000)

test('submits code and receives a pass/fail result end to end', async ({
  page,
}) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Is it even?' })).toBeVisible()

  // The seeded starter code compiles but fails the tests.
  await page.getByRole('button', { name: 'Submit for evaluation' }).click()
  await expect(page.getByText(/Failed —/)).toBeVisible({ timeout: 120_000 })

  // The correct solution passes every test.
  await page.getByLabel('Your solution').fill(
    `pub fn is_even(n: u32) -> bool {
    n % 2 == 0
}
`,
  )
  await page.getByRole('button', { name: 'Submit for evaluation' }).click()
  await expect(page.getByText(/Passed — all 3 tests/)).toBeVisible({
    timeout: 120_000,
  })
})
