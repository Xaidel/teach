import { and, eq, inArray } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'

import { db } from '#/db/client.server'
import {
  concepts,
  exerciseConcepts,
  exercises,
  preFlightAttempts,
} from '#/db/schema'
import type { PreFlightCheck, PreFlightDiagnostics } from '#/db/schema'
import { TeacherEngineError } from '#/lib/ai/client.server'
import { generateExercise } from '#/lib/ai/functions.server'
import type { GeneratedExercise } from '#/lib/ai/schemas'
import { runSandboxSubmission } from '#/lib/sandbox/runner.server'
import type { SandboxLanguage } from '#/lib/sandbox/types'

import {
  GenerationError,
  isExerciseGenerationLanguage,
} from './exercise-generation.schema'
import type { GenerateExerciseOutput } from './exercise-generation.schema'
import { parseSandboxResult } from './exercise.schema'
import { rowToExercise } from './exercise.server'

/**
 * The test function names actually defined in a generated Rust test
 * harness (`#[test] fn <name>`). The model authors both `evaluation.tests`
 * and `testSource`, so the declared names alone cannot be trusted — a
 * padded declaration (a name that never appears in the harness) must not
 * satisfy `failure_matches_concept` (issue #89).
 */
function extractRustTestNames(testSource: string): string[] {
  const names: string[] = []
  const pattern =
    /#\[test\]\s*(?:#\[[^\]]*\]\s*)*fn\s+([A-Za-z_][A-Za-z0-9_]*)/g
  for (const match of testSource.matchAll(pattern)) {
    const name = match[1]
    if (name) {
      names.push(name)
    }
  }
  return names
}

/**
 * Runs the deterministic Pre-Flight Validation gate over one generated
 * exercise (PRD §14, CONTEXT.md — Pre-Flight Validation): the reference
 * solution must compile and pass every generated test, the intended broken
 * state (starterCode) must actually fail, and the failure must land on one
 * of the generated tests — the target concept's tests — rather than
 * anywhere else. The gate never consults the AI Teacher Engine, so the
 * model that generated the exercise never grades its own output (SPEC
 * story 28). Runs both sandbox executions in parallel: they are
 * independent, and the pair must fit inside the fixed execution budget.
 */
async function runPreFlightChecks(input: {
  language: SandboxLanguage
  generated: GeneratedExercise
}): Promise<{ passed: boolean; diagnostics: PreFlightDiagnostics }> {
  const [referenceResult, brokenResult] = await Promise.all([
    runSandboxSubmission({
      language: input.language,
      code: input.generated.referenceSolution,
      testSource: input.generated.testSource,
    }).then(parseSandboxResult),
    runSandboxSubmission({
      language: input.language,
      code: input.generated.starterCode,
      testSource: input.generated.testSource,
    }).then(parseSandboxResult),
  ])

  // Only a test that is both declared AND actually defined in the harness
  // counts: the model authors both, so a declared-but-absent name must not
  // satisfy the check (issue #89).
  const actualTestNames = new Set(
    extractRustTestNames(input.generated.testSource),
  )
  const expectedTestNames = new Set(
    input.generated.evaluation.tests.filter((name) =>
      actualTestNames.has(name),
    ),
  )
  const failureMatchesConcept = brokenResult.tests.some(
    (test) => test.status === 'failed' && expectedTestNames.has(test.name),
  )
  const checks: PreFlightCheck[] = [
    {
      name: 'reference_passes',
      passed: referenceResult.passed,
      ...(referenceResult.passed
        ? {}
        : {
            detail:
              'The reference solution did not compile and pass its tests.',
          }),
    },
    {
      name: 'broken_state_fails',
      passed: !brokenResult.passed,
      ...(brokenResult.passed
        ? { detail: 'The intended broken state did not actually fail.' }
        : {}),
    },
    {
      name: 'failure_matches_concept',
      passed: failureMatchesConcept,
      ...(failureMatchesConcept
        ? {}
        : {
            detail:
              'No failing test matched a declared test that is actually defined in the harness for the target concept.',
          }),
    },
  ]

  return {
    passed: checks.every((check) => check.passed),
    diagnostics: { checks, referenceResult, brokenResult },
  }
}

/**
 * Generates a unique slug for a verified generated exercise, derived from
 * the language and target concept so it stays readable in the exercises
 * table (e.g. `rust-borrowing-a1b2c3d4`).
 */
function generatedExerciseSlug(language: string, conceptSlug: string): string {
  return `${language}-${conceptSlug.replaceAll('.', '-')}-${randomUUID().slice(0, 8)}`
}

/**
 * Generates one exercise for a Concept Graph concept and runs it through
 * the deterministic Pre-Flight Validation gate (SPEC stories 29-31, PRD
 * §13-14, issue #8). Only a Pre-Flight-passed exercise is persisted — with
 * `status = verified`, its test harness, reference solution, and Stage 2
 * rubric (ADR-0017/0019) — and joined to its target concepts. Every run,
 * passed or failed, is recorded in `pre_flight_attempts`; a failed run
 * never produces an `exercises` row at all (ADR-0010), and the retry loop
 * with its 3-attempt cap is ticket #9.
 */
export async function generateExerciseForConcept(input: {
  language: string
  conceptSlug: string
}): Promise<GenerateExerciseOutput> {
  if (!isExerciseGenerationLanguage(input.language)) {
    throw new GenerationError('EXERCISE_GENERATION_UNSUPPORTED')
  }

  const concept = await db.query.concepts.findFirst({
    where: and(
      eq(concepts.language, input.language),
      eq(concepts.slug, input.conceptSlug),
    ),
  })
  if (!concept) {
    throw new GenerationError('CONCEPT_NOT_FOUND')
  }

  let generated: GeneratedExercise
  try {
    generated = await generateExercise({
      language: input.language,
      conceptSlug: input.conceptSlug,
      conceptDifficulty: concept.difficulty,
    })
  } catch (error) {
    if (error instanceof TeacherEngineError) {
      throw new GenerationError('EXERCISE_GENERATION_FAILED')
    }
    throw error
  }

  // The draft must actually target the requested concept: an exercise
  // about something else is not usable raw material, whatever else it got
  // right (PRD §13 — generation is always scoped).
  if (!generated.targetConcepts.includes(input.conceptSlug)) {
    throw new GenerationError('EXERCISE_GENERATION_INVALID')
  }

  const attemptNumber = 1
  const preflight = await runPreFlightChecks({
    language: input.language,
    generated,
  })

  if (!preflight.passed) {
    await db.insert(preFlightAttempts).values({
      conceptId: concept.id,
      attemptNumber,
      passed: false,
      diagnostics: preflight.diagnostics,
    })
    throw new GenerationError('PREFLIGHT_FAILED')
  }

  // Persist only the join rows whose concepts exist in the graph; the
  // requested concept is guaranteed among them.
  const targetRows = await db
    .select({ id: concepts.id, slug: concepts.slug })
    .from(concepts)
    .where(
      and(
        eq(concepts.language, input.language),
        inArray(concepts.slug, generated.targetConcepts),
      ),
    )
  const conceptSlugToId = new Map(targetRows.map((row) => [row.slug, row.id]))
  const joinedConcepts = generated.targetConcepts
    .map((slug) => ({ slug, id: conceptSlugToId.get(slug) }))
    .filter(
      (entry): entry is { slug: string; id: string } => entry.id !== undefined,
    )
  const joinedSlugs = joinedConcepts.map((entry) => entry.slug)

  const persisted = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(exercises)
      .values({
        slug: generatedExerciseSlug(input.language, input.conceptSlug),
        language: input.language,
        title: generated.title,
        prompt: generated.prompt,
        starterCode: generated.starterCode,
        testSource: generated.testSource,
        referenceSolution: generated.referenceSolution,
        evaluationRubric: generated.evaluation.rubric,
        mode: 'implement',
        difficulty: generated.difficulty,
        constraints: generated.constraints,
        status: 'verified',
      })
      .returning()
    if (!row) {
      throw new Error('The exercise insert returned no row.')
    }

    await tx.insert(exerciseConcepts).values(
      joinedConcepts.map((entry) => ({
        exerciseId: row.id,
        conceptId: entry.id,
      })),
    )

    await tx.insert(preFlightAttempts).values({
      conceptId: concept.id,
      attemptNumber,
      passed: true,
      diagnostics: preflight.diagnostics,
    })

    return row
  })

  return {
    exercise: rowToExercise(persisted),
    conceptSlug: input.conceptSlug,
    targetConcepts: joinedSlugs,
    prerequisites: generated.prerequisites,
    estimatedMinutes: generated.estimatedMinutes,
    constraints: generated.constraints,
    preflight: {
      attemptNumber,
      passed: true,
      checks: preflight.diagnostics.checks,
    },
  }
}
