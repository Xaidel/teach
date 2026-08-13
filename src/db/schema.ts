import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { uuidv7 } from 'uuidv7'

import {
  CONCEPT_DIFFICULTY_MAX,
  CONCEPT_DIFFICULTY_MIN,
} from '../lib/concept-graph'
import {
  DEFAULT_EXPLANATION_DEPTH,
  EXPLANATION_DEPTH_MAX,
  EXPLANATION_DEPTH_MIN,
} from '../lib/explanation-depth'
import { HINT_LADDER_MAX_LEVEL } from '../lib/hint-levels'
import type { EvaluationRubric, ExerciseDefect } from '../lib/ai/schemas'
import type { SandboxResult, SandboxTest } from '../lib/sandbox/types'

/**
 * Concept review status (ADR-0016): a personal tracking marker set through
 * the review UI. It never gates whether a concept is usable — Concept
 * Validation does.
 */
export const conceptStatus = pgEnum('concept_status', ['draft', 'approved'])

/** Concept edge kind discriminator (ADR-0010). */
export const conceptEdgeKind = pgEnum('concept_edge_kind', [
  'prerequisite',
  'related',
])

/**
 * Exercise generation lifecycle (ADR-0010): `pending` before verification,
 * `verified` only after Pre-Flight passed (the only state a learner can
 * ever see, ticket #8), `failed`/`retired` for later generation-lifecycle
 * handling (tickets #9, #19, #20).
 */
export const exerciseStatus = pgEnum('exercise_status', [
  'pending',
  'verified',
  'failed',
  'retired',
])

/**
 * Exercise mode discriminator (ADR-0010): `implement`/`debug` exercises go
 * through Pre-Flight and carry a test harness and rubric; `explain`-mode
 * rows skip Stage 1 entirely and leave `test_source`, `evaluation_rubric`
 * and `reference_solution` NULL (ADR-0017, ADR-0019).
 */
export const exerciseMode = pgEnum('exercise_mode', [
  'implement',
  'debug',
  'explain',
])

/**
 * Exercise guidance discriminator (issue #14, Class A curriculum steps):
 * `guided` exercises are served with the full Socratic hint ladder; an
 * `independent` exercise is served without hints — the learner must solve
 * it on their own. Guidance is orthogonal to `mode`: it is a step-level
 * property of how the exercise is presented, not of what is evaluated.
 */
export const exerciseGuidance = pgEnum('exercise_guidance', [
  'guided',
  'independent',
])

/**
 * Learner Model mastery state (ADR-0010, SPEC story 41): Unknown is the
 * implicit absence of a `learner_concept_mastery` row, not a stored value —
 * a row is created no earlier than `introduced`, on a concept's first
 * attempt. `unknown` stays in the enum for a future explicit downgrade path
 * (SPEC story 50, ticket #18), even though this ticket never writes it.
 */
export const masteryState = pgEnum('mastery_state', [
  'unknown',
  'introduced',
  'practiced',
  'demonstrated',
  'retained',
])

/**
 * Attempt outcome (ADR-0010): the deterministic Stage 1 sandbox verdict —
 * Stage 1 stays the authoritative gate (ADR-0008); a Stage 2 rubric
 * violation is reported to the learner (`stage2Review`) without flipping
 * this column, matching the pre-rekey `results.passed` boolean it replaces.
 * Mastery advancement additionally requires Stage 2 to pass where the
 * exercise has a rubric (`advanceMasteryOnCompletion`, exercise.server.ts).
 */
export const attemptOutcome = pgEnum('attempt_outcome', ['pass', 'fail'])

/**
 * The single learner the platform serves in v1 (ADR-0001, ADR-0014).
 * `explanation_depth` and `reference_frame` are the learner's adaptive
 * explanation preferences (issue #12, PRD §12): depth (1-5, Intuitive
 * through Runtime/Compiler Internals) and an optional reference frame,
 * threaded into `explainConcept`/`generateHint` calls to shape presentation
 * only — they never change the underlying hint level or concept targeted.
 */
export const learners = pgTable(
  'learners',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    explanationDepth: integer('explanation_depth')
      .notNull()
      .default(DEFAULT_EXPLANATION_DEPTH),
    referenceFrame: text('reference_frame'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'learners_explanation_depth_check',
      sql`${table.explanationDepth} between ${sql.raw(String(EXPLANATION_DEPTH_MIN))} and ${sql.raw(String(EXPLANATION_DEPTH_MAX))}`,
    ),
  ],
)

/**
 * One exercise a learner can attempt; v1 seeds the hardcoded Go/Python
 * exercises and generates Rust exercises through the AI Teacher Engine
 * (ticket #8). `mode` discriminates implement/debug/explain (ADR-0010);
 * `difficulty` and `constraints` are the exercise's generation-time
 * metadata. `test_source` is nullable because explain-mode rows skip Stage
 * 1 and have no generated tests (ADR-0019). `reference_solution` is
 * nullable for the same reason: the Prompt Shield's leakage check needs the
 * Pre-Flight-verified reference solution as ground truth (ADR-0008), which
 * explain-mode rows don't produce (ADR-0010). `evaluation_rubric` is
 * nullable because explain-mode rows never reach Stage 2 and therefore
 * have no rubric (ADR-0017). `status` is `verified` only after Pre-Flight
 * Validation passed — the only state ever shown to the learner.
 * `defect` is the declared intentional defect of an adversarial (debug-mode)
 * row (ADR-0022/0023, issue #11), persisted from the generation contract so
 * the verified-fallback path can surface it — a stored adversarial row
 * served via fallback must render the adversarial label consistently
 * (issue #120). Null for `implement`/`explain` rows.
 */
export const exercises = pgTable(
  'exercises',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    slug: text('slug').notNull(),
    language: text('language').notNull(),
    title: text('title').notNull(),
    prompt: text('prompt').notNull(),
    starterCode: text('starter_code').notNull(),
    testSource: text('test_source'),
    referenceSolution: text('reference_solution'),
    evaluationRubric: jsonb('evaluation_rubric').$type<EvaluationRubric>(),
    defect: jsonb('defect').$type<ExerciseDefect>(),
    mode: exerciseMode('mode').notNull().default('implement'),
    guidance: exerciseGuidance('guidance').notNull().default('guided'),
    // Set exclusively by Tactical Sprint (Class B, ticket #13, issue #14
    // Round 3): Class B is deliberately exempt from the Class A no-skip-
    // ahead gate (SPEC story 8 — a passed sprint accelerates the curriculum,
    // it doesn't wait for it), and the exemption on submission has to be
    // read back from the persisted row rather than a submission-time input,
    // or any learner could set it themselves to bypass the gate.
    sprintScoped: boolean('sprint_scoped').notNull().default(false),
    difficulty: integer('difficulty').notNull(),
    constraints: jsonb('constraints').$type<string[]>(),
    status: exerciseStatus('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex('exercises_slug_unique').on(table.slug)],
)

/**
 * The exercise ↔ concept join (ADR-0010): an exercise targets one or more
 * Concept Graph concepts. Generated exercises are exactly the exercises
 * with rows here — hardcoded v1 seeds have none (ticket #8).
 */
export const exerciseConcepts = pgTable(
  'exercise_concepts',
  {
    exerciseId: uuid('exercise_id')
      .notNull()
      .references(() => exercises.id),
    conceptId: uuid('concept_id')
      .notNull()
      .references(() => concepts.id),
  },
  (table) => [primaryKey({ columns: [table.exerciseId, table.conceptId] })],
)

/** Compiler/test diagnostics preserved per attempt (ADR-0010): the same
 * Sandbox Result detail the pre-rekey `results` table split across `tests`
 * and `message`, now the ADR's single `compiler_errors` jsonb column. */
export type AttemptCompilerErrors = {
  tests: SandboxTest[]
  message: string | null
}

/**
 * One learner attempt at an exercise (ADR-0010, ADR-0014): merges the
 * walking skeleton's `submissions` + `results` tables (staging deviation
 * recorded in ADR-0010, reconciled by ADR-0021) into the durable shape this
 * ADR specifies. `time_to_solution` is seconds elapsed since the learner's
 * first attempt at this exercise — 0 on that first attempt — the evidence
 * granularity SPEC story 42 asks for.
 */
export const attempts = pgTable(
  'attempts',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    learnerId: uuid('learner_id')
      .notNull()
      .references(() => learners.id),
    exerciseId: uuid('exercise_id')
      .notNull()
      .references(() => exercises.id),
    code: text('code').notNull(),
    outcome: attemptOutcome('outcome').notNull(),
    timeToSolution: integer('time_to_solution').notNull(),
    compilerErrors: jsonb('compiler_errors').$type<AttemptCompilerErrors>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('attempts_learner_idx').on(table.learnerId),
    index('attempts_exercise_idx').on(table.exerciseId),
  ],
)

/**
 * One Socratic hint served against an exercise attempt (issue #4), rekeyed
 * from `submission_hints` onto `attempts` (ADR-0010, ADR-0021).
 */
export const attemptHints = pgTable(
  'attempt_hints',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => attempts.id),
    hintLevel: integer('hint_level').notNull(),
    content: text('content').notNull(),
    servedAt: timestamp('served_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('attempt_hints_attempt_idx').on(table.attemptId),
    uniqueIndex('attempt_hints_level_unique').on(
      table.attemptId,
      table.hintLevel,
    ),
    check(
      'attempt_hints_level_check',
      sql`${table.hintLevel} between 0 and ${sql.raw(String(HINT_LADDER_MAX_LEVEL))}`,
    ),
  ],
)

/**
 * Current per-learner, per-concept mastery state (ADR-0010, SPEC story 41):
 * overwritten in place on every state change, never appended to — mastery
 * *transition* history is reconstructed from `attempts.created_at` if ever
 * needed (ADR-0010 Alternatives Considered). No row exists for a concept
 * the learner has never attempted; that absence *is* the Unknown state.
 */
export const learnerConceptMastery = pgTable(
  'learner_concept_mastery',
  {
    learnerId: uuid('learner_id')
      .notNull()
      .references(() => learners.id),
    conceptId: uuid('concept_id')
      .notNull()
      .references(() => concepts.id),
    state: masteryState('state').notNull().default('introduced'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.learnerId, table.conceptId] })],
)

/**
 * One Concept Graph node (ADR-0010, ADR-0016): a language-scoped concept
 * with the dotted natural slug (e.g. `rust.async.send`), a 1-5 difficulty,
 * and a review-only `status` that never gates usage.
 */
export const concepts = pgTable(
  'concepts',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    language: text('language').notNull(),
    slug: text('slug').notNull(),
    difficulty: integer('difficulty').notNull(),
    status: conceptStatus('status').notNull().default('draft'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('concepts_language_slug_unique').on(table.language, table.slug),
    check(
      'concepts_difficulty_range_check',
      sql`${table.difficulty} between ${sql.raw(String(CONCEPT_DIFFICULTY_MIN))} and ${sql.raw(String(CONCEPT_DIFFICULTY_MAX))}`,
    ),
  ],
)

/**
 * One Concept Graph edge (ADR-0010): an adjacency row discriminated by
 * `kind` (prerequisite | related). Edges carry no review status — an edge
 * is reviewed as part of the concept it originates from (ADR-0016).
 */
export const conceptEdges = pgTable(
  'concept_edges',
  {
    fromConceptId: uuid('from_concept_id')
      .notNull()
      .references(() => concepts.id),
    toConceptId: uuid('to_concept_id')
      .notNull()
      .references(() => concepts.id),
    kind: conceptEdgeKind('kind').notNull(),
  },
  (table) => [
    uniqueIndex('concept_edges_from_to_kind_unique').on(
      table.fromConceptId,
      table.toConceptId,
      table.kind,
    ),
    check(
      'concept_edges_no_self_loop_check',
      sql`${table.fromConceptId} <> ${table.toConceptId}`,
    ),
  ],
)

/** One named check in a Pre-Flight Validation run (PRD §14, ticket #8). */
export type PreFlightCheckName =
  'reference_passes' | 'broken_state_fails' | 'failure_matches_concept'

/** One named check verdict plus optional failure detail. */
export type PreFlightCheck = {
  name: PreFlightCheckName
  passed: boolean
  detail?: string
}

/**
 * Diagnostics persisted per Pre-Flight run (ADR-0010): every check verdict
 * and both sandbox runs, so retries (ticket #9) are informed by the exact
 * failure rather than repeated blind.
 */
export type PreFlightDiagnostics = {
  checks: PreFlightCheck[]
  referenceResult: SandboxResult
  brokenResult: SandboxResult
}

/**
 * One generated curriculum lesson, persisted so a learner revisiting an
 * already-generated step doesn't pay a fresh AI generation call (issue
 * #135). Presentation-only content (SPEC story 2) with no evaluation role,
 * cached durably in Postgres per ADR-0007/0010. The cache key is the
 * complete set of generation inputs — `(learner_id, concept_id,
 * explanation_depth, reference_frame)` — so a change in the learner's
 * explanation preferences naturally misses the cache (issue #12) and a
 * fresh lesson is generated at the new settings; the old row is left in
 * place and serves again if the learner switches back. No TTL: the content
 * is deterministic given the inputs, so the only staleness that matters is
 * an input change, which the key already captures.
 */
export const curriculumLessons = pgTable(
  'curriculum_lessons',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    learnerId: uuid('learner_id')
      .notNull()
      .references(() => learners.id),
    conceptId: uuid('concept_id')
      .notNull()
      .references(() => concepts.id),
    explanationDepth: integer('explanation_depth').notNull(),
    referenceFrame: text('reference_frame'),
    explanation: text('explanation').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // `reference_frame` is nullable, so the uniqueness key must coalesce it
    // to a non-null sentinel — a bare unique index would treat two NULLs as
    // distinct and allow duplicate cache rows for a learner without a frame.
    uniqueIndex('curriculum_lessons_cache_key_unique').on(
      table.learnerId,
      table.conceptId,
      table.explanationDepth,
      sql`coalesce(${table.referenceFrame}, '')`,
    ),
  ],
)

/**
 * The generation-time Pre-Flight log (ADR-0010): one row per Pre-Flight
 * run, keyed by concept — a failed run may never produce a savable
 * `exercises` row at all, and this table is where its record lives. A
 * successful generation is also logged here for observability. `attempt_number`
 * is 1-3 for the retry loop's cap (SPEC story 33); the circuit breaker's
 * terminal simplified-constraints fallback regeneration is the one
 * additional run (SPEC story 34, PRD §5.2) and is logged as attempt 4.
 */
export const preFlightAttempts = pgTable(
  'pre_flight_attempts',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    conceptId: uuid('concept_id')
      .notNull()
      .references(() => concepts.id),
    attemptNumber: integer('attempt_number').notNull(),
    passed: boolean('passed').notNull(),
    diagnostics: jsonb('diagnostics').$type<PreFlightDiagnostics>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('pre_flight_attempts_concept_idx').on(table.conceptId),
    check(
      'pre_flight_attempts_number_check',
      sql`${table.attemptNumber} between 1 and 4`,
    ),
  ],
)
