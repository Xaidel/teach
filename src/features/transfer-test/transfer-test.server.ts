import { eq } from 'drizzle-orm'

import { db } from '#/db/client.server'
import { concepts, exercises } from '#/db/schema'
import { isSandboxLanguage } from '#/lib/sandbox/types'
// Narrow, documented cross-feature dependency (arch_docs/dependency-rules.md
// "Feature Dependencies" exception): eligibility needs the Concept Graph's
// usable projection (the same gate the practice list and explanation-
// assessment feature already read) — one-way, `concepts` never imports back.
import { getUsableConceptGraph } from '#/features/concepts/concepts.server'
// Same exception: generating a Transfer Test exercise reuses the exact same
// generation + Pre-Flight pipeline as any other exercise (issue #8) — one-way,
// `exercise` never imports back from `transfer-test`.
import { generateExerciseForConcept } from '#/features/exercise/exercise-generation.server'
// Same exception: eligibility and the Learner Model's evidence signal are
// owned by `learners`, reported through and read back from the single named
// entry points it exposes for this feature — one-way, `learners` never
// imports back from `transfer-test`.
import {
  getMasteryStates,
  getPassedTransferTestConceptIds,
  hasPassedExerciseModeForConcept,
} from '#/features/learners/mastery.server'
import {
  getTransferTestExerciseId,
  registerTransferTestExercise,
} from '#/features/learners/transfer-test.server'

import { TransferTestError } from './transfer-test.schema'
import type {
  TransferTestExerciseView,
  TransferTestOverview,
} from './transfer-test.schema'

/**
 * The language scoped by the practice list (issue #8) and the Concept Graph
 * surface (issue #7): Rust until tickets #19/#20 land Go/Python. The
 * Transfer Test eligibility read follows the same scope as Explanation
 * Assessment's.
 */
const TRANSFER_TEST_LANGUAGE = 'rust' as const

/**
 * The concepts a learner can currently take a Transfer Test on (ADR-0015,
 * issue #17): every usable Concept Graph concept at `practiced` — eligible
 * as soon as the concept reaches Practiced, no exercise-count threshold —
 * annotated with whether the learner already passed a Transfer Test on it.
 * Concepts past Practiced (already Demonstrated) are intentionally absent:
 * the initial gate is a one-time promotion check; recurring Transfer Tests
 * on Demonstrated concepts are the scheduled-review shape ticket #18 owns
 * (deferred — see the follow-up filed alongside this ticket, mirroring
 * issue #16's own #131).
 */
export async function getTransferTestOverview(
  learnerId: string,
): Promise<TransferTestOverview> {
  const usableGraph = await getUsableConceptGraph(TRANSFER_TEST_LANGUAGE)
  const conceptIds = usableGraph.concepts.map((concept) => concept.id)

  const masteryStates = await getMasteryStates(learnerId, conceptIds)
  const eligibleIds = conceptIds.filter(
    (conceptId) => masteryStates[conceptId] === 'practiced',
  )

  const passedIds = new Set(
    await getPassedTransferTestConceptIds(learnerId, eligibleIds),
  )
  const byId = new Map(
    usableGraph.concepts.map((concept) => [concept.id, concept]),
  )

  return {
    language: TRANSFER_TEST_LANGUAGE,
    concepts: eligibleIds
      .map((conceptId) => {
        const concept = byId.get(conceptId)
        if (!concept) return null
        return {
          conceptId,
          slug: concept.slug,
          difficulty: concept.difficulty,
          hasPassedTest: passedIds.has(conceptId),
        }
      })
      .filter(
        (concept): concept is NonNullable<typeof concept> => concept !== null,
      )
      .sort((a, b) => a.slug.localeCompare(b.slug)),
  }
}

/** Loads a persisted exercise row's slug/title by id. */
async function getExerciseView(exerciseId: string): Promise<{
  slug: string
  title: string
} | null> {
  const row = await db.query.exercises.findFirst({
    where: eq(exercises.id, exerciseId),
    columns: { slug: true, title: true },
  })
  return row ?? null
}

/**
 * Generates (or reuses) one learner's Transfer Test exercise for an
 * already-Practiced concept (SPEC story 46, ADR-0015, ADR-0010, issue #17):
 * validates the concept is gate-eligible (usable, at Practiced), then
 * requests an exercise from the exact same generation + Pre-Flight pipeline
 * every other exercise goes through (`generateExerciseForConcept`, issue
 * #8). ADR-0010's fixed "structurally different exercise" shape for
 * Transfer Testing is debug-mode (`adversarial: true`) — but "different"
 * means different from what the learner actually solved, not a hardcoded
 * mode: the practice list's adversarial toggle (issue #11) lets a learner
 * reach Practiced via a debug-mode exercise through ordinary practice, in
 * which case a debug-mode Transfer Test would be the *same* shape (AC1).
 * `hasPassedExerciseModeForConcept` checks whether the learner has already
 * passed debug-mode on this concept; if so, the Transfer Test requests
 * `implement`-mode instead. If the learner has already passed *both* shapes
 * (no shape left that's guaranteed novel), this falls back to ADR-0010's
 * debug-mode default — no third shape exists in this pipeline.
 *
 * The generated instance is registered (`registerTransferTestExercise`) so
 * a retry — or a second call to this function — resolves back to the same
 * exercise rather than minting a new one each time (mirrors Explanation
 * Assessment's `ensureExplainExercise` reuse). The learner then solves it
 * through the ordinary practice submission flow: Transfer Testing is not a
 * separate entity or a separate submission surface (ADR-0010). Recording
 * the pass as Transfer Test evidence and firing the ADR-0015 gate happens
 * in `recordAttemptOutcome` (`mastery.server.ts`) at submission time, keyed
 * off the registration this function writes.
 */
export async function generateTransferTestExercise(input: {
  learnerId: string
  conceptId: string
}): Promise<TransferTestExerciseView> {
  const concept = await db.query.concepts.findFirst({
    where: eq(concepts.id, input.conceptId),
  })
  if (!concept) {
    throw new TransferTestError('CONCEPT_NOT_FOUND')
  }

  if (!isSandboxLanguage(concept.language)) {
    throw new TransferTestError('CONCEPT_NOT_ELIGIBLE')
  }

  const usableGraph = await getUsableConceptGraph(concept.language)
  if (!usableGraph.concepts.some((c) => c.id === concept.id)) {
    throw new TransferTestError('CONCEPT_NOT_ELIGIBLE')
  }

  const mastery = (await getMasteryStates(input.learnerId, [concept.id]))[
    concept.id
  ]
  if (mastery !== 'practiced') {
    throw new TransferTestError('CONCEPT_NOT_ELIGIBLE')
  }

  const existingExerciseId = await getTransferTestExerciseId({
    learnerId: input.learnerId,
    conceptId: concept.id,
  })
  if (existingExerciseId) {
    const existing = await getExerciseView(existingExerciseId)
    if (existing) {
      return {
        exerciseId: existingExerciseId,
        slug: existing.slug,
        title: existing.title,
        conceptSlug: concept.slug,
        reused: true,
      }
    }
  }

  // AC1's "structurally different exercise shape" (see this function's doc
  // comment): default to debug-mode (ADR-0010), but switch to implement-mode
  // when the learner already passed debug-mode on this concept through the
  // practice list's own adversarial toggle — otherwise the Transfer Test
  // would silently regenerate the same shape already solved.
  const alreadyPassedDebug = await hasPassedExerciseModeForConcept(
    input.learnerId,
    concept.id,
    'debug',
  )
  const alreadyPassedImplement = await hasPassedExerciseModeForConcept(
    input.learnerId,
    concept.id,
    'implement',
  )
  // Only switch away from the debug-mode default when debug is the shape
  // already faced and implement genuinely offers something different —
  // otherwise (neither passed, or both passed) debug stays the default.
  const adversarial = !(alreadyPassedDebug && !alreadyPassedImplement)

  let generated
  try {
    // `guidance: 'independent'` — a test of transferred mastery is solved
    // unaided, no Socratic hint ladder (issue #14's guidance discriminator).
    // Not `sprintScoped`: the concept is already Practiced, so its own
    // prerequisites were already satisfied when it was originally unlocked.
    generated = await generateExerciseForConcept({
      language: concept.language,
      conceptSlug: concept.slug,
      learnerId: input.learnerId,
      adversarial,
      guidance: 'independent',
    })
  } catch {
    throw new TransferTestError('TRANSFER_TEST_GENERATION_FAILED')
  }

  await registerTransferTestExercise({
    learnerId: input.learnerId,
    conceptId: concept.id,
    exerciseId: generated.exercise.id,
  })

  return {
    exerciseId: generated.exercise.id,
    slug: generated.exercise.slug,
    title: generated.exercise.title,
    conceptSlug: concept.slug,
    reused: false,
  }
}
