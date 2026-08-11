import { expect, test } from '@playwright/test'

test.setTimeout(240_000)

const EXERCISES = [
  {
    title: 'Is it even?',
    code: `pub fn is_even(n: u32) -> bool {
    n % 2 == 0
}
`,
  },
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

test('submits code and receives a pass/fail result end to end for each language', async ({
  page,
}) => {
  await page.goto('/')

  await expect(
    page.getByRole('heading', {
      name: 'Teach — practice in three languages.',
    }),
  ).toBeVisible()

  for (const exercise of EXERCISES) {
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
