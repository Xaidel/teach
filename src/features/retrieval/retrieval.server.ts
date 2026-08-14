import { and, desc, eq, inArray } from 'drizzle-orm'

import { db } from '#/db/client.server'
import { concepts, exerciseConcepts, exercises } from '#/db/schema'
// Narrow, documented cross-feature dependency (arch_docs/dependency-rules.md
// "Feature Dependencies" exception): the queue view needs the Learner
// Model's mastery states and the queue itself, both owned by `learners` —
// one-way, `learners` never imports back from `retrieval`.
import {
  getRetrievalQueueEntries,
  getRetrievalReviewExerciseId,
  registerRetrievalReviewExercise,
} from '#/features/learners/retrieval-queue.server'
import { getMasteryStates } from '#/features/learners/mastery.server'
// Same exception: when a due concept has no verified exercise yet, the
// Refresher Test reuses the exact generation + Pre-Flight pipeline as any
// other exercise (issue #8) — one-way, `exercise` never imports back from
// `retrieval`.
import { generateExerciseForConcept } from '#/features/exercise/exercise-generation.server'
import {
  isRetrievalRemediationScore,
  retrievalIntervalLabel,
} from '#/lib/retrieval-schedule'

import { RetrievalError } from './retrieval.schema'
import type {
  RetrievalQueueEntry,
  RetrievalQueueView,
  RetrievalTestView,
  StartRetrievalReviewCommand,
} from './retrieval.schema'

/**
 * The Retrieval Queue view (issue #18 AC 1): every `retrieval_queue` row
 * for the learner, annotated with the concept's slug/difficulty and the
 * learner's current mastery state, then bucketed into High Priority / Due
 * / Upcoming (PRD §23.1) and ordered by priority then due time. Bucketing
 * reads only the stored `due_at` and `priority_score` columns — the flat
 * materialized read ADR-0010 chose; the mastery join is a per-id PK lookup
 * that does not grow with attempt history.
 */
export async function getRetrievalQueue(
  learnerId: string,
): Promise<RetrievalQueueView> {
  const rows = await getRetrievalQueueEntries(learnerId)
  if (rows.length === 0) {
    return { highPriority: [], due: [], upcoming: [], dueCount: 0 }
  }

  const conceptIds = rows.map((row) => row.conceptId)
  const [conceptRows, masteryStates] = await Promise.all([
    db
      .select({
        id: concepts.id,
        slug: concepts.slug,
        difficulty: concepts.difficulty,
      })
      .from(concepts)
      .where(inArray(concepts.id, conceptIds)),
    getMasteryStates(learnerId, conceptIds),
  ])
  const byId = new Map(conceptRows.map((row) => [row.id, row]))

  const now = Date.now()
  const entries: RetrievalQueueEntry[] = rows.map((row) => {
    const concept = byId.get(row.conceptId)
    const dueAtMs = row.dueAt.getTime()
    const remediation = isRetrievalRemediationScore(row.priorityScore)
    const status =
      dueAtMs <= now ? (remediation ? 'high-priority' : 'due') : 'upcoming'
    return {
      conceptId: row.conceptId,
      slug: concept?.slug ?? row.conceptId,
      difficulty: concept?.difficulty ?? 1,
      masteryState: masteryStates[row.conceptId] ?? 'unknown',
      scheduleStage: row.scheduleStage,
      intervalLabel: retrievalIntervalLabel(row.scheduleStage),
      dueAt: row.dueAt.toISOString(),
      priorityScore: row.priorityScore,
      status,
      remediation,
    }
  })

  const sortEntries = (list: RetrievalQueueEntry[]): RetrievalQueueEntry[] =>
    [...list].sort(
      (a, b) =>
        b.priorityScore - a.priorityScore ||
        new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime(),
    )

  const highPriority = sortEntries(
    entries.filter((entry) => entry.status === 'high-priority'),
  )
  const due = sortEntries(entries.filter((entry) => entry.status === 'due'))
  const upcoming = sortEntries(
    entries.filter((entry) => entry.status === 'upcoming'),
  )

  return {
    highPriority,
    due,
    upcoming,
    dueCount: highPriority.length + due.length,
  }
}

/**
 * The verified exercise a Refresher Test on a concept will use, or null
 * when the concept has none (issue #18): the most recently created
 * Pre-Flight-verified `exercises` row targeting the concept. Reuse-first
 * keeps the review flow deterministic and free of AI generation when a
 * suitable exercise already exists; a concept whose only exercises were
 * generated but never verified falls through to `startRefresherTest`'s
 * generation fallback.
 */
async function findVerifiedReviewExercise(
  conceptId: string,
): Promise<{ id: string; slug: string; title: string } | null> {
  const row = await db
    .select({
      id: exercises.id,
      slug: exercises.slug,
      title: exercises.title,
    })
    .from(exercises)
    .innerJoin(exerciseConcepts, eq(exerciseConcepts.exerciseId, exercises.id))
    .where(
      and(
        eq(exerciseConcepts.conceptId, conceptId),
        eq(exercises.status, 'verified'),
      ),
    )
    .orderBy(desc(exercises.createdAt))
    .limit(1)

  return row[0] ?? null
}

/**
 * Starts a Refresher Test on one due concept (issue #18, AC 3): validates
 * the concept exists and its queue row is due, resolves the exercise the
 * review will use — an already-verified exercise targeting the concept, or
 * a freshly generated independent exercise when none exists — and
 * registers it so the submission path (`recordAttemptOutcome`) recognizes
 * the review and applies its pass/fail semantics (promote to Retained /
 * revert to Practiced + remediation). The learner then solves the exercise
 * through the ordinary practice flow; the review is not a separate
 * submission surface (ADR-0010).
 */
export async function startRetrievalReview(
  input: StartRetrievalReviewCommand,
): Promise<RetrievalTestView> {
  const concept = await db.query.concepts.findFirst({
    where: eq(concepts.id, input.conceptId),
  })
  if (!concept) {
    throw new RetrievalError('CONCEPT_NOT_FOUND')
  }

  const queueRows = await getRetrievalQueueEntries(input.learnerId)
  const queueRow = queueRows.find((row) => row.conceptId === input.conceptId)
  if (!queueRow || queueRow.dueAt.getTime() > Date.now()) {
    throw new RetrievalError('CONCEPT_NOT_DUE')
  }

  const existingExerciseId = await getRetrievalReviewExerciseId({
    learnerId: input.learnerId,
    conceptId: concept.id,
  })
  if (existingExerciseId) {
    const existing = await db.query.exercises.findFirst({
      where: eq(exercises.id, existingExerciseId),
      columns: { slug: true, title: true },
    })
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

  const verified = await findVerifiedReviewExercise(concept.id)
  if (verified) {
    await registerRetrievalReviewExercise({
      learnerId: input.learnerId,
      conceptId: concept.id,
      exerciseId: verified.id,
    })
    return {
      exerciseId: verified.id,
      slug: verified.slug,
      title: verified.title,
      conceptSlug: concept.slug,
      reused: true,
    }
  }

  let generated
  try {
    // `guidance: 'independent'` — a retrieval test is solved unaided, no
    // Socratic hint ladder (issue #14's guidance discriminator). Not
    // `sprintScoped`: the concept is being reviewed for retention, not
    // granted by Class B.
    generated = await generateExerciseForConcept({
      language: concept.language,
      conceptSlug: concept.slug,
      learnerId: input.learnerId,
      adversarial: false,
      guidance: 'independent',
    })
  } catch {
    throw new RetrievalError('REFRESHER_GENERATION_FAILED')
  }

  await registerRetrievalReviewExercise({
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
