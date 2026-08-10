import 'dotenv/config'

import { count } from 'drizzle-orm'

import { db } from '../src/db/client.server'
import { exercises, learners } from '../src/db/schema'

const HARDCODED_EXERCISE = {
  slug: 'rust-is-even',
  language: 'rust',
  title: 'Is it even?',
  prompt:
    'Implement `is_even(n: u32) -> bool`, returning true when n is an even number and false otherwise. Handle zero.',
  starterCode: `pub fn is_even(n: u32) -> bool {
    false
}
`,
  testSource: `#[test]
fn returns_true_for_even_numbers() {
    assert!(exercise::is_even(4), "4 is even");
}

#[test]
fn returns_false_for_odd_numbers() {
    assert!(!exercise::is_even(7), "7 is odd");
}

#[test]
fn handles_zero() {
    assert!(exercise::is_even(0), "0 is even");
}
`,
  status: 'verified',
}

async function seedLearner(): Promise<void> {
  const rows = await db.select({ value: count() }).from(learners)
  const existing = rows[0]?.value ?? 0
  if (existing === 0) {
    await db.insert(learners).values({})
    console.log('Seeded the v1 learner row.')
  } else {
    console.log('Learner row already present; skipping.')
  }
}

async function seedExercise(): Promise<void> {
  const existing = await db.query.exercises.findFirst({
    where: (table, { eq }) => eq(table.slug, HARDCODED_EXERCISE.slug),
  })
  if (existing) {
    console.log(
      `Exercise "${HARDCODED_EXERCISE.slug}" already present; skipping.`,
    )
    return
  }
  await db.insert(exercises).values(HARDCODED_EXERCISE)
  console.log(`Seeded exercise "${HARDCODED_EXERCISE.slug}".`)
}

await seedLearner()
await seedExercise()
await db.$client.end()
