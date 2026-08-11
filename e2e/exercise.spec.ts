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

test('escalates the manual Socratic hint ladder one level at a time', async ({
  page,
}) => {
  await page.goto('/')

  const article = page.getByRole('article', {
    name: 'Is it even?',
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
