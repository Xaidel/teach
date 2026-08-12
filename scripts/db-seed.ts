import 'dotenv/config'

import { count, eq } from 'drizzle-orm'

import { db } from '../src/db/client.server'
import { exercises, learners } from '../src/db/schema'
import { STAGE2_RUBRIC } from '../src/features/exercise/stage2-review.rubric'
import type { EvaluationRubric } from '../src/lib/ai/schemas'
import type { SandboxLanguage } from '../src/lib/sandbox/types'

type HardcodedExercise = {
  slug: string
  language: SandboxLanguage
  title: string
  prompt: string
  starterCode: string
  referenceSolution: string
  testSource: string
  evaluationRubric: EvaluationRubric
  status: 'verified'
}

const HARDCODED_EXERCISES: HardcodedExercise[] = [
  {
    slug: 'rust-is-even',
    language: 'rust',
    title: 'Is it even?',
    prompt:
      'Implement `is_even(n: u32) -> bool`, returning true when n is an even number and false otherwise. Handle zero.',
    starterCode: `pub fn is_even(n: u32) -> bool {
    false
}
`,
    referenceSolution: `pub fn is_even(n: u32) -> bool {
    n % 2 == 0
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
    evaluationRubric: STAGE2_RUBRIC,
    status: 'verified',
  },
  {
    slug: 'go-is-even',
    language: 'go',
    title: 'Is it even? (Go)',
    prompt:
      'Implement `IsEven(n uint32) bool`, returning true when n is an even number and false otherwise. Handle zero.',
    starterCode: `package exercise

func IsEven(n uint32) bool {
	return false
}
`,
    referenceSolution: `package exercise

func IsEven(n uint32) bool {
	return n%2 == 0
}
`,
    testSource: `package exercise

import "testing"

func TestIsEvenEvenNumbers(t *testing.T) {
	if !IsEven(4) {
		t.Error("4 is even")
	}
}

func TestIsEvenOddNumbers(t *testing.T) {
	if IsEven(7) {
		t.Error("7 is odd")
	}
}

func TestIsEvenZero(t *testing.T) {
	if !IsEven(0) {
		t.Error("0 is even")
	}
}
`,
    evaluationRubric: STAGE2_RUBRIC,
    status: 'verified',
  },
  {
    slug: 'python-is-even',
    language: 'python',
    title: 'Is it even? (Python)',
    prompt:
      'Implement `is_even(n: int) -> bool`, returning True when n is an even number and False otherwise. Handle zero.',
    starterCode: `def is_even(n: int) -> bool:
    return False
`,
    referenceSolution: `def is_even(n: int) -> bool:
    return n % 2 == 0
`,
    testSource: `from exercise import is_even


def test_even_numbers():
    assert is_even(4) is True, "4 is even"


def test_odd_numbers():
    assert is_even(7) is False, "7 is odd"


def test_zero():
    assert is_even(0) is True, "0 is even"
`,
    evaluationRubric: STAGE2_RUBRIC,
    status: 'verified',
  },
]

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

async function seedExercise(exercise: HardcodedExercise): Promise<void> {
  const existing = await db.query.exercises.findFirst({
    where: (table, { eq }) => eq(table.slug, exercise.slug),
  })
  if (existing) {
    const backfill: Partial<HardcodedExercise> = {}
    if (existing.referenceSolution === null) {
      backfill.referenceSolution = exercise.referenceSolution
    }
    if (existing.evaluationRubric === null) {
      backfill.evaluationRubric = exercise.evaluationRubric
    }
    if (Object.keys(backfill).length > 0) {
      await db
        .update(exercises)
        .set(backfill)
        .where(eq(exercises.slug, exercise.slug))
      console.log(
        `Exercise "${exercise.slug}" already present; backfilled missing columns.`,
      )
    } else {
      console.log(`Exercise "${exercise.slug}" already present; skipping.`)
    }
    return
  }
  await db.insert(exercises).values(exercise)
  console.log(`Seeded exercise "${exercise.slug}".`)
}

await seedLearner()
for (const exercise of HARDCODED_EXERCISES) {
  await seedExercise(exercise)
}
await db.$client.end()
