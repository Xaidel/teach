import { and, desc, eq, inArray } from 'drizzle-orm'
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
import type {
  GeneratedExercise,
  PreFlightDiagnosticsInput,
} from '#/lib/ai/schemas'
import { runSandboxSubmission } from '#/lib/sandbox/runner.server'
import type { SandboxLanguage } from '#/lib/sandbox/types'

import {
  GenerationError,
  isExerciseGenerationLanguage,
  MAX_PREFLIGHT_ATTEMPTS,
  SIMPLIFIED_FALLBACK_ATTEMPT_NUMBER,
  SPRINT_MAX_MINUTES,
  SPRINT_MIN_MINUTES,
} from './exercise-generation.schema'
import type {
  ExerciseGenerationLanguage,
  GenerateExerciseOutput,
} from './exercise-generation.schema'
// Deliberate, documented cross-feature dependency (arch_docs/dependency-rules.md
// "Feature Dependencies" exception): the no-skip-ahead gate (issue #14, AC 4)
// is owned by the Concept Graph, so exercise generation depends one-way on
// the single named entry point `concepts/concepts.server.ts` exposes for it.
// `concepts` never imports back from `exercise`, so the graph stays acyclic.
import { assertPrerequisitesPracticed } from '../concepts/concepts.server'
import { parseSandboxResult } from './exercise.schema'
import type { ExerciseGuidance } from './exercise.schema'
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
 * Persists one Pre-Flight-passed generation as a verified exercise, joined
 * to its target concepts, and logs the passing run — the single write path
 * shared by the retry loop and the circuit-breaker's simplified fallback
 * regeneration (issue #9). `mode` discriminates implement vs adversarial
 * debug rows (ADR-0010, issue #11): an adversarial generation persists as
 * `mode = 'debug'`.
 */
async function persistVerifiedExercise(input: {
  language: string
  conceptSlug: string
  conceptId: string
  generated: GeneratedExercise
  attemptNumber: number
  diagnostics: PreFlightDiagnostics
  mode: 'implement' | 'debug'
  guidance: ExerciseGuidance
}): Promise<GenerateExerciseOutput & { kind: 'generated' }> {
  // Persist only the join rows whose concepts exist in the graph; the
  // requested concept is guaranteed among them.
  const targetRows = await db
    .select({ id: concepts.id, slug: concepts.slug })
    .from(concepts)
    .where(
      and(
        eq(concepts.language, input.language),
        inArray(concepts.slug, input.generated.targetConcepts),
      ),
    )
  const conceptSlugToId = new Map(targetRows.map((row) => [row.slug, row.id]))
  const joinedConcepts = input.generated.targetConcepts
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
        title: input.generated.title,
        prompt: input.generated.prompt,
        starterCode: input.generated.starterCode,
        testSource: input.generated.testSource,
        referenceSolution: input.generated.referenceSolution,
        evaluationRubric: input.generated.evaluation.rubric,
        mode: input.mode,
        guidance: input.guidance,
        difficulty: input.generated.difficulty,
        constraints: input.generated.constraints,
        status: 'verified',
        // ADR-0023: persist the declared defect of an adversarial
        // (debug-mode) generation so the verified-fallback path can surface
        // it — a stored adversarial row served via fallback must render the
        // adversarial label consistently (issue #120).
        ...(input.generated.defect ? { defect: input.generated.defect } : {}),
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
      conceptId: input.conceptId,
      attemptNumber: input.attemptNumber,
      passed: true,
      diagnostics: input.diagnostics,
    })

    return row
  })

  return {
    kind: 'generated',
    exercise: rowToExercise(persisted),
    conceptSlug: input.conceptSlug,
    targetConcepts: joinedSlugs,
    prerequisites: input.generated.prerequisites,
    estimatedMinutes: input.generated.estimatedMinutes,
    constraints: input.generated.constraints,
    preflight: {
      attemptNumber: input.attemptNumber,
      passed: true,
      checks: input.diagnostics.checks,
    },
    simplified: input.attemptNumber === SIMPLIFIED_FALLBACK_ATTEMPT_NUMBER,
    ...(input.generated.defect ? { defect: input.generated.defect } : {}),
  }
}

/**
 * The circuit-breaker's first fallback (SPEC story 34, PRD §5.2, issue #9):
 * a previously verified exercise on the same concept, if one exists in the
 * bank. Its stored row is served as-is — `test_source` and
 * `reference_solution` are reused without regenerating (ADR-0019) and no
 * new Pre-Flight run happens, because the row was verified when it entered
 * the bank. Most recent first, so repeat generations of the same concept
 * keep surfacing the newest verified exercise.
 *
 * The fallback preserves the requested `guidance` (issue #14): a guided
 * slot may only fall back to a guided row and an independent slot to an
 * independent row — an independent slot served a guided row would carry
 * working hints, and vice versa. Adversarial `mode` stays selection-agnostic
 * exactly as before (SPEC story 34's contract is that a learner is never
 * blocked by a failed generation, not that the fallback preserves the
 * requested mode); a stored adversarial row it serves is still labeled via
 * its persisted defect (issue #120).
 */
async function findVerifiedFallback(input: {
  conceptId: string
  conceptSlug: string
  guidance: ExerciseGuidance
}): Promise<GenerateExerciseOutput | null> {
  const row = await db.query.exercises.findFirst({
    where: and(
      eq(exercises.status, 'verified'),
      eq(exercises.guidance, input.guidance),
      inArray(
        exercises.id,
        db
          .select({ exerciseId: exerciseConcepts.exerciseId })
          .from(exerciseConcepts)
          .where(eq(exerciseConcepts.conceptId, input.conceptId)),
      ),
    ),
    orderBy: desc(exercises.createdAt),
  })
  if (!row) {
    return null
  }

  const targetRows = await db
    .select({ slug: concepts.slug })
    .from(exerciseConcepts)
    .innerJoin(concepts, eq(concepts.id, exerciseConcepts.conceptId))
    .where(eq(exerciseConcepts.exerciseId, row.id))

  return {
    kind: 'verified-fallback',
    exercise: rowToExercise(row),
    conceptSlug: input.conceptSlug,
    targetConcepts: targetRows.map((entry) => entry.slug),
    constraints: row.constraints ?? [],
    // A stored adversarial row is served with its persisted defect so the
    // card renders the adversarial label consistently with a freshly
    // generated one (issue #120). The fallback stays mode-agnostic — the
    // selection never preserves the requested mode — but what it serves is
    // labeled for what it is.
    ...(row.defect ? { defect: row.defect } : {}),
  }
}

/**
 * Generates one exercise for a Concept Graph concept and runs it through
 * the deterministic Pre-Flight Validation gate (SPEC stories 29-33, PRD
 * §13-14, issues #8, #9). Up to `MAX_PREFLIGHT_ATTEMPTS` generations run,
 * each retry fed the previous failure's structured diagnostics (SPEC story
 * 32); every run, passed or failed, is recorded in `pre_flight_attempts`
 * (ADR-0010). After the cap trips (SPEC story 33), the circuit breaker
 * falls back (SPEC story 34, PRD §5.2): a previously verified exercise on
 * the same concept is served as-is when one exists, otherwise one final
 * regeneration with a simplified constraint set runs — and if even that
 * fails Pre-Flight, the request fails rather than looping indefinitely.
 * Only a Pre-Flight-passed exercise is persisted — with `status = verified`
 * (ADR-0010/0017/0019) — and a learner is never shown a failed exercise.
 * `adversarial` targets a debug-mode exercise with a known, declared
 * defect (SPEC stories 51-52, PRD §20, issue #11); it is validated by the
 * exact same gate and the same retry/discard loop, so an adversarial
 * exercise that fails Pre-Flight is never shipped — no invented, unverified
 * bug reaches the learner. The adversarial flag survives the retry loop and
 * the simplified fallback regeneration; the verified-fallback path is
 * mode-agnostic in selection (SPEC story 34's contract is that a learner
 * is never blocked by a failed generation, not that the fallback preserves
 * the requested mode) — but a stored adversarial row it serves carries its
 * persisted defect, so the card labels it consistently (issue #120). The
 * fallback's selection *does* preserve the requested `guidance` (issue
 * #14), so a step slot never silently crosses the guided/independent
 * boundary.
 *
 * The no-skip-ahead gate (issue #14, AC 4) runs before any AI call: the
 * learner's mastery of this concept's prerequisites in the usable graph is
 * checked server-side, so no surface — including the standalone generation
 * card — can mint an exercise for a concept the learner may not practice
 * yet. `learnerId` scopes that check.
 */
export async function generateExerciseForConcept(input: {
  language: string
  conceptSlug: string
  learnerId: string
  adversarial?: boolean | undefined
  sprintScoped?: boolean | undefined
  guidance?: ExerciseGuidance | undefined
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

  await assertPrerequisitesPracticed({
    learnerId: input.learnerId,
    language: input.language,
    conceptIds: [concept.id],
  })

  const guidance = input.guidance ?? 'guided'
  let previousDiagnostics: PreFlightDiagnosticsInput | undefined
  for (
    let attemptNumber = 1;
    attemptNumber <= MAX_PREFLIGHT_ATTEMPTS;
    attemptNumber++
  ) {
    const attempt = await runGenerationAttempt({
      language: input.language,
      conceptSlug: input.conceptSlug,
      conceptId: concept.id,
      conceptDifficulty: concept.difficulty,
      attemptNumber,
      previousDiagnostics,
      simplifiedConstraints: false,
      adversarial: input.adversarial,
      sprintScoped: input.sprintScoped,
      guidance,
    })
    if (attempt.kind === 'succeeded') {
      return attempt.outcome
    }
    previousDiagnostics = attempt.failureDiagnostics
  }

  // Circuit breaker (SPEC story 33): every attempt within the cap failed.
  const fallback = await findVerifiedFallback({
    conceptId: concept.id,
    conceptSlug: input.conceptSlug,
    guidance,
  })
  if (fallback) {
    return fallback
  }

  // Terminal fallback regeneration with a simplified constraint set (SPEC
  // story 34): one run beyond the cap, never looped further.
  const finalAttempt = await runGenerationAttempt({
    language: input.language,
    conceptSlug: input.conceptSlug,
    conceptId: concept.id,
    conceptDifficulty: concept.difficulty,
    attemptNumber: SIMPLIFIED_FALLBACK_ATTEMPT_NUMBER,
    previousDiagnostics,
    simplifiedConstraints: true,
    adversarial: input.adversarial,
    sprintScoped: input.sprintScoped,
    guidance,
  })
  if (finalAttempt.kind === 'succeeded') {
    return finalAttempt.outcome
  }
  throw new GenerationError('PREFLIGHT_FAILED')
}

/**
 * One generation + Pre-Flight cycle: calls the AI Teacher Engine, rejects
 * drafts that do not target the requested concept, runs the deterministic
 * gate, and logs the run in `pre_flight_attempts` — passed or failed,
 * every run is recorded (SPEC story 35, ADR-0010). Returns the persisted
 * verified exercise on success, or the failure's structured diagnostics
 * for the next attempt. `adversarial` targets a debug-mode exercise with a
 * known, declared defect (SPEC stories 51-52, PRD §20, issue #11): the
 * gate is byte-for-byte the same one a non-adversarial exercise runs, and
 * a failing adversarial exercise is discarded and retried exactly like any
 * other — a model may never ship an invented, unverified bug.
 */
async function runGenerationAttempt(input: {
  language: ExerciseGenerationLanguage
  conceptSlug: string
  conceptId: string
  conceptDifficulty: number
  attemptNumber: number
  previousDiagnostics: PreFlightDiagnosticsInput | undefined
  simplifiedConstraints: boolean
  adversarial: boolean | undefined
  sprintScoped: boolean | undefined
  guidance: ExerciseGuidance
}): Promise<
  | {
      kind: 'succeeded'
      outcome: GenerateExerciseOutput & { kind: 'generated' }
    }
  | { kind: 'failed'; failureDiagnostics: PreFlightDiagnostics }
> {
  let generated: GeneratedExercise
  try {
    generated = await generateExercise({
      language: input.language,
      conceptSlug: input.conceptSlug,
      conceptDifficulty: input.conceptDifficulty,
      previousDiagnostics: input.previousDiagnostics,
      simplifiedConstraints: input.simplifiedConstraints,
      adversarial: input.adversarial,
      sprintScoped: input.sprintScoped,
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

  // A Tactical Sprint (Class B) exercise must stay in the spec's own
  // 5-10 minute window (SPEC stories 6-7, ticket #13) — a draft outside it
  // is discarded the same way an off-target draft is, never silently kept
  // with a misleading estimate.
  if (
    input.sprintScoped &&
    (generated.estimatedMinutes < SPRINT_MIN_MINUTES ||
      generated.estimatedMinutes > SPRINT_MAX_MINUTES)
  ) {
    throw new GenerationError('EXERCISE_GENERATION_INVALID')
  }

  const preflight = await runPreFlightChecks({
    language: input.language,
    generated,
  })

  if (!preflight.passed) {
    await db.insert(preFlightAttempts).values({
      conceptId: input.conceptId,
      attemptNumber: input.attemptNumber,
      passed: false,
      diagnostics: preflight.diagnostics,
    })
    return { kind: 'failed', failureDiagnostics: preflight.diagnostics }
  }

  return {
    kind: 'succeeded',
    outcome: await persistVerifiedExercise({
      language: input.language,
      conceptSlug: input.conceptSlug,
      conceptId: input.conceptId,
      generated,
      attemptNumber: input.attemptNumber,
      diagnostics: preflight.diagnostics,
      mode: input.adversarial ? 'debug' : 'implement',
      guidance: input.guidance,
    }),
  }
}
