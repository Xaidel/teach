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
import { HINT_LADDER_MAX_LEVEL } from '../lib/hint-levels'
import type { EvaluationRubric } from '../lib/ai/schemas'
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

/** The single learner the platform serves in v1 (ADR-0001, ADR-0014). */
export const learners = pgTable('learners', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

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
    mode: exerciseMode('mode').notNull().default('implement'),
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

/** One learner submission of an exercise, attributed to the current learner (ADR-0014). */
export const submissions = pgTable(
  'submissions',
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
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('submissions_learner_idx').on(table.learnerId)],
)

/** The normalized Sandbox Result produced for one submission. */
export const results = pgTable(
  'results',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => submissions.id),
    passed: boolean('passed').notNull(),
    tests: jsonb('tests').$type<SandboxTest[]>().notNull(),
    /** Result-level diagnostics, persisted so later hint context can be rebuilt. */
    message: text('message'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex('results_submission_unique').on(table.submissionId)],
)

/** One Socratic hint served against an exercise attempt (issue #4). */
export const submissionHints = pgTable(
  'submission_hints',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    submissionId: uuid('submission_id')
      .notNull()
      .references(() => submissions.id),
    hintLevel: integer('hint_level').notNull(),
    content: text('content').notNull(),
    servedAt: timestamp('served_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('submission_hints_submission_idx').on(table.submissionId),
    uniqueIndex('submission_hints_level_unique').on(
      table.submissionId,
      table.hintLevel,
    ),
    check(
      'submission_hints_level_check',
      sql`${table.hintLevel} between 0 and ${sql.raw(String(HINT_LADDER_MAX_LEVEL))}`,
    ),
  ],
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
 * The generation-time Pre-Flight log (ADR-0010): one row per Pre-Flight
 * run, keyed by concept — a failed run may never produce a savable
 * `exercises` row at all, and this table is where its record lives. A
 * successful generation is also logged here for observability.
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
      sql`${table.attemptNumber} between 1 and 3`,
    ),
  ],
)
