import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
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
import type { SandboxTest } from '../lib/sandbox/types'

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
 * One exercise a learner can attempt; v1 seeds exactly one (issue #1).
 * `test_source` is nullable because explain-mode rows skip Stage 1 and have
 * no generated tests (ADR-0019). `reference_solution` is nullable for the
 * same reason: the Prompt Shield's leakage check needs the Pre-Flight-verified
 * reference solution as ground truth (ADR-0008), which explain-mode rows
 * don't produce (ADR-0010). `evaluation_rubric` is nullable because
 * explain-mode rows never reach Stage 2 and therefore have no rubric
 * (ADR-0017).
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
    status: text('status').notNull().default('verified'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex('exercises_slug_unique').on(table.slug)],
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
