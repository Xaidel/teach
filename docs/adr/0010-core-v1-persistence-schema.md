# ADR-0010: Core v1 persistence schema — Concept Graph, Learner Model, Retrieval Queue, Exercise Store

- **Date**: 2026-08-10
- **Status**: Accepted
- **Deciders**: Xaidel (sole maintainer)

## Context and Problem Statement

ADR-0007 already settled *where* v1's persistent data lives (one Postgres database, via Drizzle, with the Concept Graph modeled as adjacency tables rather than a graph database) and *that* every learner-scoped table carries a learner identifier from the first migration (ADR-0001). Neither ADR fixes the actual table shapes: what columns exist, how prerequisite/related edges are represented, how hint usage and generation failures are recorded, or whether the Retrieval Queue is a stored table or a computed view.

`docs/SPEC.md` names four entities only in prose — Concept Graph, Learner Model, Retrieval Queue, and an exercise store implied by Pre-Flight's fallback-to-a-previously-verified-exercise behavior — without concrete definitions. No code implements any of this yet. This ADR was resolved as wayfinder ticket [#22](../../issues/22) ("Data model: Concept Graph, Learner Model, Retrieval Queue, exercise store") on the [AI Learning Platform v1 map](../../issues/21), and gates build tickets [#7](../../issues/7), [#8](../../issues/8), [#9](../../issues/9), [#10](../../issues/10), and [#18](../../issues/18), each of which would otherwise need to improvise this shape during implementation.

## Decision Drivers

- **Consistency with ADR-0007**: adjacency-table Concept Graph, recursive-CTE traversal, one Postgres database — this ADR must realize that framing, not reopen it.
- **Consistency with ADR-0001**: every learner-scoped table needs a real learner identifier from the first migration.
- **Evidence fidelity**: the Learner Model exists to produce scheduling and remediation evidence (SPEC stories 41–43); the schema must preserve the granularity that evidence needs (e.g. hint-by-hint timing, not just a summary count) rather than collapsing it prematurely.
- **Solo-maintainer operability**: v1 has one learner and one maintainer; prefer synchronous, dependency-free write paths over background jobs, triggers, or event pipelines that add operational surface without a demonstrated need yet.
- **Future read scale**: the Retrieval Queue is read on every dashboard load; its cost should stay flat as attempt history grows, not degrade with it.

## Decision

We will use the following schema for v1's core persistence, all in the single Postgres database ADR-0007 already established, via Drizzle:

- **Keys**: every table's primary key is a UUID. Default to **UUIDv7** (monotonic, better B-tree index locality on insert-heavy tables) unless a specific table has a reason to deviate.
- **`learners`**: `id`, `created_at`. Seeded with exactly one row for v1. Every learner-scoped table below carries a `learner_id` foreign key into this table, not a free-standing identifier column.
- **`concepts`**: `id`, `language`, `slug` (the dotted natural identifier, e.g. `rust.async.send`), `difficulty`. Unique on `(language, slug)`. (A `status` enum column — `draft` | `approved`, tracking review only, never gating usage — was added by [ADR-0016](./0016-concept-graph-review-workflow.md).)
- **`concept_edges`**: `from_concept_id`, `to_concept_id`, `kind` (enum: `prerequisite` | `related`) — one adjacency table with a kind discriminator, queried via recursive CTEs per ADR-0007.
- **`learner_concept_mastery`**: `learner_id`, `concept_id`, `state` (enum: Unknown → Introduced → Practiced → Demonstrated → Retained), `updated_at`. Holds only the *current* mastery state per learner+concept; it is overwritten in place, not appended to.
- **`attempts`**: `id`, `learner_id`, `exercise_id`, `outcome`, `time_to_solution`, `compiler_errors` (jsonb).
- **`attempt_hints`**: `attempt_id`, `hint_level`, `served_at` — one row per hint level actually served against an attempt, child of `attempts`.

> **Staging deviation (2026-08-12, PR #52):** the walking skeleton persisted hints as
> `submission_hints` (`submission_id`, `hint_level`, `content`, `served_at`), keyed to
> `submissions` — not this ADR's `attempt_hints` (`attempt_id`, `hint_level`, `served_at`) —
> because the `attempts` table does not exist yet (ticket #10 is still blocked). The staging
> table also adds a `content` column, since the AI Teacher Engine generates hint text that
> must be stored with the level and served-at timestamp. This is a guaranteed **rekey
> migration**, not a rename, when the real attempts model lands: `submission_hints` →
> `attempt_hints` with `submission_id` re-keyed to `attempt_id`, and `submissions` merged
> into `attempts`. Do not treat `submission_hints` as the durable shape; treat this note as
> the reconciliation record ticket #10 must consume. [ADR-NNNN](./NNNN-shield-blocked-hint-ladder-exhaustion.md)
> (parked, unnumbered) adds a shield-blocked marker column to `submission_hints`; the rekey migration must carry that
> column forward into the durable shape.
- **`exercises`**: `id`, `mode` (enum: `implement` | `debug` | `explain`), `difficulty`, `constraints`, `reference_solution`, `status` (enum: `pending` | `verified` | `failed` | `retired`).
- **`exercise_concepts`**: `exercise_id`, `concept_id` — join table; an exercise may target more than one concept.
- **Explanation Assessment and Transfer Testing** are not separate entities: they are `exercises`/`attempts` rows with `mode = explain` or a structurally different exercise (`debug`) on an already-passed concept. An `explain`-mode attempt stores its accuracy score and detected missing/incorrect/conflated concepts as jsonb in place of a pass/fail outcome, and skips Pre-Flight validation, which does not apply to it.
- **`retrieval_queue`**: `learner_id`, `concept_id`, `schedule_stage` (0–4, mapping to the fixed 24h → 3d → 7d → 21d → 60d schedule), `due_at`, `priority_score`. Materialized — not computed at read time — and upserted **synchronously**, inline with the code path that records an attempt or a mastery change. No background job, trigger, or async queue for v1.
- **`pre_flight_attempts`**: `concept_id`, `attempt_number` (1–3), `passed`, `diagnostics` (jsonb), `created_at`. A generation-time log, independent of `exercises` — a failed generation attempt may never produce a savable `exercises` row at all.

  > **Amendment (issue #9, PR #99):** `attempt_number`'s range widens to **1–4**. SPEC story 34 / PRD §5.2's circuit breaker allows ONE terminal fallback regeneration with a simplified constraint set after the 3-attempt cap trips; that run is also Pre-Flight-validated and logged, so it is the fourth and final `pre_flight_attempts` row a request can produce. The retry loop itself remains capped at 3 (SPEC story 33).

## Alternatives Considered

### Option A: Natural string keys (concept `slug` as primary key)

Use the dotted concept identifier (e.g. `rust.async.send`) directly as `concepts`' primary key, with every foreign key elsewhere storing that string.

- Benefits: human-readable foreign keys; no separate `slug` column to keep in sync with `id`.
- Costs and risks: every referencing table (`concept_edges`, `learner_concept_mastery`, `exercise_concepts`) carries a wider, variable-length foreign key instead of a fixed-width UUID; renaming a concept's slug becomes a cascading update instead of a metadata change.

### Option B (chosen): Surrogate UUID keys, natural slug retained as a unique column

- Benefits: fixed-width foreign keys throughout; slug remains available for display and lookup via a unique `(language, slug)` index; consistent with the UUID convention adopted for every other table.
- Costs and risks: one extra unique index per table; ids are opaque in raw query output, though the `slug` column keeps them resolvable.

### Option A: Event-sourced mastery log

Record every mastery-state change as a new row in `mastery_events` (`learner_id`, `concept_id`, `new_state`, `changed_at`); current mastery is the latest row per learner+concept.

- Benefits: a full mastery-change timeline is available without reconstructing it from other tables.
- Costs and risks: duplicates history already captured by `attempts` and `attempt_hints`, introducing a second source of truth for "how did this learner get here"; every "what's the current mastery" read needs an aggregation (`ORDER BY changed_at DESC LIMIT 1` or an equivalent index/view) instead of a direct row lookup.

### Option B (chosen): Current-state `learner_concept_mastery` table

- Benefits: SPEC story 41 frames the five states as a present classification, not a timeline; a direct row lookup for "current mastery," no aggregation required; avoids a second, redundant history source alongside `attempts`.
- Costs and risks: mastery-state *transition* history (as opposed to attempt history) is not separately queryable — reconstructing "when did this learner reach Demonstrated" requires correlating against `attempts.created_at`, not a direct read.

### Option A: Hint usage as a summary column on `attempts`

Store hint usage as a single `max_hint_level` column on each `attempts` row.

- Benefits: no additional table; one row per attempt covers everything.
- Costs and risks: discards the order and timing of individual hint requests. SPEC story 25 wants "solved after 4 hints" distinguishable evidence, which includes escalation *pattern* (e.g. hints requested in rapid succession versus with deliberation) that a single terminal value cannot represent.

### Option B (chosen): Child `attempt_hints` table

- Benefits: preserves per-hint-level timing, directly serving story 25's evidence requirement.
- Costs and risks: one extra table and an extra insert per hint request, though volume is small (at most 6 hint levels per attempt).

### Option A: Single `concept_id` on `exercises`, boolean `is_verified` status

- Benefits: simplest possible shape — one foreign key, one boolean.
- Costs and risks: SPEC's ticket language explicitly names "target concept(s)" (plural), which a single foreign key cannot represent for compound exercises; a boolean cannot distinguish `failed` from `retired` generation outcomes, which story 35 wants tracked as a quality signal.

### Option B (chosen): `exercise_concepts` join table, `status` enum

- Benefits: supports multi-concept exercises without schema change (single-concept exercises are simply one join row); the status enum carries the fuller generation lifecycle Pre-Flight's fallback and story 35's observability both need from one column.
- Costs and risks: one additional join table even for the common single-concept case.

### Option A: Retrieval Queue computed at read time

No dedicated table; `schedule_stage` lives on `learner_concept_mastery`, and due/priority are computed by joining `learner_concept_mastery` + `attempts` + the fixed schedule whenever the dashboard is opened.

- Benefits: nothing to keep in sync — no upsert path to maintain or get wrong.
- Costs and risks: read cost grows with the volume of attempt history behind each learner and with the number of concurrent readers, since the full multi-table join re-runs on every read; priority exists only as a query result, not an inspectable stored value.

### Option B (chosen): Materialized `retrieval_queue`, synchronous upsert

- Benefits: dashboard reads are a flat, indexed `WHERE due_at <= now()` regardless of how much history exists behind them — the read cost does not grow with attempt volume or reader count; priority is a stored, inspectable value.
- Costs and risks: the write path (recording an attempt or a mastery change) must also correctly upsert this table, or the two fall out of sync; v1 accepts this coupling via a synchronous, in-process upsert rather than a background job, deferring the operational complexity of an async pipeline until it is actually justified.

### Option A: Separate `explanation_assessments` and `transfer_tests` tables

- Benefits: each table's columns are shaped exactly for what it records, with no unused or dual-purpose columns.
- Costs and risks: SPEC story 46 frames a transfer test as "a structurally different exercise" on an already-passed concept — the same entity as any other exercise, not a new one. Separate tables would force a UNION across three tables everywhere "what has this learner done on concept X" is asked, and would need special-casing in the Learner Model's mastery/history logic per table.

### Option B (chosen): `mode` enum on the existing `exercises`/`attempts` tables

- Benefits: one query answers "what has this learner done on concept X" across implement/debug/explain; no special-casing elsewhere in the schema.
- Costs and risks: `explain`-mode attempts don't fit the pass/fail `outcome` shape as cleanly — they store an accuracy score and a detected-issue list as jsonb instead, and Pre-Flight validation is simply skipped for that mode, which is a conditional the read/write paths must know about.

### Option A: Generation-failure diagnostics as a `jsonb[]` array column on `exercises`

- Benefits: no additional table.
- Costs and risks: a failed generation attempt may never produce a savable `exercises` row at all (per SPEC story 33's 3-attempt cap, only a successful attempt need be persisted) — there is nowhere to append the array before a row exists. Story 35's "repeated failures on the same concept" query would need to unnest arrays across every exercise instead of a plain aggregation.

### Option B (chosen): Dedicated `pre_flight_attempts` log table

- Benefits: keyed by `concept_id` directly, independent of whether a corresponding `exercises` row ever gets created; story 35's "repeated failures per concept" is a plain `GROUP BY concept_id`.
- Costs and risks: one more table whose rows outlive the exercise-generation attempts that produced them, with no `exercises` foreign key to clean up by (only `concept_id`).

## Consequences

### Positive

- Build tickets #7, #8, #9, #10, and #18 are unblocked with a concrete schema to implement against, rather than each improvising one independently.
- The Learner Model preserves hint-timing and generation-failure granularity from the first migration, avoiding a later migration to recover evidence that a coarser v1 schema would have discarded.
- The Retrieval Queue's read cost is decoupled from attempt-history volume and reader concurrency from day one.
- Explanation Assessment and Transfer Testing share infrastructure with ordinary exercises, so the Learner Model's mastery/history logic (ADR scope: `learner_concept_mastery`, `attempts`) does not need per-mode special cases beyond the `mode` column itself.

### Negative

- The `retrieval_queue` table's correctness now depends on every code path that records an attempt or mastery change also performing the matching upsert — a coupling that can silently drift out of sync if a future write path forgets it, with no background reconciliation job in v1 to catch that.
- `learner_concept_mastery` being current-state-only means mastery *transition* history (as distinct from attempt history) is not directly queryable; it must be inferred by correlating `attempts.created_at` against known state thresholds if ever needed.
- Nine additional tables (`learners`, `concepts`, `concept_edges`, `learner_concept_mastery`, `attempts`, `attempt_hints`, `exercises`, `exercise_concepts`, `retrieval_queue`, `pre_flight_attempts`) must all be created, migrated, and kept consistent together — more migration surface than a minimal schema would have, in exchange for the evidence granularity and read-scale properties above.

### Neutral / Risks

- The "small, shallow graph" scale assumption ADR-0007 already flagged for `concept_edges` applies unchanged here; this ADR does not revisit it.
- `retrieval_queue`'s synchronous-upsert choice is explicitly a v1-scoped simplification, not a permanent architectural commitment — if write volume or multi-user load ever justifies it, the upsert can move to an async/triggered path without changing the table shape itself.
- The `mode` enum's `explain` case carrying different semantics (accuracy score instead of pass/fail, no Pre-Flight) on the same table as `implement`/`debug` is a deliberate reuse, but any future addition of a fourth mode should re-examine whether the shared shape still fits before assuming it does.

## Confirmation

No code implements this yet as of this writing; there is no automated check to point to today. Once built: Drizzle schema/migration files define the tables listed in Decision, in the same Postgres database ADR-0007 already established — verifiable by schema/migration review confirming the table set, foreign keys (especially every `learner_id` reference into `learners`), and the `retrieval_queue` upsert call site existing in the attempt/mastery write path. The shared integration-test seam (ADR-0002, ADR-0009) exercising Learner Model and Retrieval Queue behavior together is the natural place to assert the upsert-on-write invariant, once that seam exists.

## Relationships and References

- Related to: [ADR-0007](./0007-postgres-storage.md) — this ADR makes ADR-0007's storage technology and adjacency-table framing concrete as actual table definitions.
- Related to: [ADR-0001](./0001-single-user-mvp-multi-user-ready-data-model.md) — the `learners` table and every `learner_id` foreign key in this schema implement ADR-0001's learner-scoping mandate.
- Related to: [ADR-0003](./0003-multi-language-from-v1.md) — the per-language `concepts.language` column is how this schema stores the three v1 languages ADR-0003 establishes.
- Related to: [ADR-0016](./0016-concept-graph-review-workflow.md), [ADR-0017](./0017-stage2-rubric-storage.md), [ADR-0019](./0019-generated-test-source-storage.md) — each adds a single column to a table this ADR defines (`concepts.status`, `exercises.evaluation_rubric`, `exercises.test_source` respectively) without reopening this ADR's schema otherwise.
- Supporting evidence: [docs/SPEC.md](../SPEC.md) (Concept Graph, Learner Model, Explanation Assessment & Transfer Testing, Spaced Retrieval, and Pre-Flight Validation sections); wayfinder ticket #22 on map #21 (resolution session this ADR records).
- Owning implementation package: none yet — no code implements this as of this writing.
