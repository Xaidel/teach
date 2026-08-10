import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

import { uuidv7 } from '../lib/uuidv7'
import type { SandboxTest } from '../lib/sandbox/types'

/** The single learner the platform serves in v1 (ADR-0001, ADR-0014). */
export const learners = pgTable('learners', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
})

/** One exercise a learner can attempt; v1 seeds exactly one (ADR-0019). */
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
    testSource: text('test_source').notNull(),
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
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex('results_submission_unique').on(table.submissionId)],
)
