# ADR-0021: `attempts` rekey reconciliation — closing ADR-0010's staging deviation

- **Date**: 2026-08-13
- **Status**: Accepted
- **Deciders**: Xaidel (sole maintainer)

## Context and Problem Statement

ADR-0010 specified `attempts` (`id`, `learner_id`, `exercise_id`, `outcome`,
`time_to_solution`, `compiler_errors` jsonb) and a child `attempt_hints`
(`attempt_id`, `hint_level`, `served_at`) as the Learner Model's attempt-history
tables. Its staging-deviation note (added by PR #52, ticket #4) records that the
walking skeleton (ticket #1) could not build against that shape yet — `attempts`
did not exist — and persisted hints as `submission_hints` (`submission_id`,
`hint_level`, `content`, `served_at`) keyed to a `submissions` + `results` pair
instead, with an explicit instruction that this was a **guaranteed rekey
migration, not a rename**, to be consumed by ticket #10.

Ticket #10 (this ADR's owning work) is where the real `attempts` model lands.
Per `docs/adr/README.md`'s change procedure, that reconciliation is recorded as
a new ADR that `Refines` ADR-0010, rather than silently rewriting ADR-0010's
original staging note — this is that record, and it also resolves the follow-up
ticket #59 filed to track writing it. Two things ADR-0010 named as columns
without pinning their exact semantics also needed a concrete decision once real
code had to write them: `outcome` and `time_to_solution`.

## Decision Drivers

- **ADR-0010's reconciliation instruction**: "treat this note as the
  reconciliation record ticket #10 must consume" — this ADR is that
  consumption, not a reopening of ADR-0010's table shapes.
- **ADR-0008's Stage 1 authority**: Stage 1 (the sandbox) is the deterministic,
  authoritative evaluation gate; Stage 2 (the qualitative rubric review) is
  advisory-on-top. Any column recording "did the attempt pass" must not blur
  that boundary.
- **Evidence fidelity (ADR-0010)**: `time_to_solution` must mean something
  concrete and queryable, not an unspecified placeholder, or later scheduling
  logic (SPEC stories 41–43) has nothing real to read.
- **No data loss on rekey**: existing `submissions`/`results`/`submission_hints`
  rows (dev/test data under the walking skeleton) must migrate forward, not
  simply get dropped, matching "rekey migration, not a rename."

## Decision

We will:

1. **Merge `submissions` + `results` into `attempts` 1:1, reusing ids.** The
   migration (`drizzle/0008_learner-model-mastery-attempts.sql`) creates
   `attempts`/`attempt_hints` alongside the still-live staging tables, backfills
   `attempts` from `submissions` joined to `results` — **reusing each
   submission's id as the corresponding attempt's id** — and backfills
   `attempt_hints` from `submission_hints` by the same id reuse (no lookup
   join needed for the hint rekey). A second migration
   (`drizzle/0009_rekey-drop-submissions-results-hints.sql`) then drops the
   three staging tables. Two migrations, not one, so drizzle-kit's schema diff
   never has to guess whether `submissions`→`attempts` is a rename.
2. **`attempts.outcome` is Stage 1's verdict only.** `outcome` is `pass` when
   the sandbox run passed, `fail` otherwise — exactly what `results.passed`
   recorded pre-rekey. A Stage 2 rubric violation is reported to the learner
   through `stage2Review` and does not flip `outcome`; hint eligibility
   (`requestHint`) keys off this same Stage 1 verdict, unchanged from the
   walking skeleton's behavior.
3. **`attempts.compiler_errors` carries the full Sandbox Result diagnostic**,
   `{ tests: SandboxTest[], message: string | null }` — the same detail
   `results` split across its `tests` and `message` columns, on every attempt
   (not only failures), now as the ADR-0010 jsonb column.
4. **`attempts.time_to_solution` is seconds elapsed since the learner's
   earliest attempt at that exercise** (0 on that first attempt), computed
   server-side at write time (`computeTimeToSolutionSeconds`,
   `exercise.server.ts`) and, for backfilled rows, by an equivalent
   `MIN(created_at) OVER (PARTITION BY learner_id, exercise_id)` window
   function in the migration.
5. **Mastery advancement, scoped to this ticket only.** On any attempt
   (pass or fail), the exercise's Concept Graph concepts advance to at least
   `introduced` in `learner_concept_mastery` — attributing the attempt to
   learner and concept even on failure. Completing an exercise (Stage 1 pass,
   and Stage 2 pass wherever the exercise has a rubric) additionally advances
   them to `practiced`. `demonstrated`/`retained` are out of scope here —
   they belong to Explanation Assessment (#16), Transfer Testing (#17), and
   Spaced Retrieval (#18), none of which exist yet.
6. **ADR-NNNN's shield-blocked marker column carries forward as: nothing.**
   ADR-NNNN (parked, v2) proposed a marker column on `submission_hints`
   recording a shield-blocked hint as ladder exhaustion. It was never
   implemented — `submission_hints` shipped without it — so this rekey has no
   column to carry onto `attempt_hints`. When ADR-NNNN's v2 effort begins, it
   adds the marker directly to `attempt_hints` and updates its own
   Relationships section then; this ADR does not pre-add a column no code
   uses.

## Alternatives Considered

### Option A: Single migration, answering drizzle-kit's interactive rename prompt

Run `drizzle-kit generate` once and answer "no, not a rename" for
`submissions`→`attempts`/`submission_hints`→`attempt_hints` at the prompt.

- Benefits: one migration file instead of two.
- Costs and risks: drizzle-kit's rename resolver requires an interactive TTY;
  this environment has none, so the tool cannot run at all. Also produces a
  single migration mixing three drops and three creates, which reads less
  clearly as "expand, backfill, contract" than two purpose-scoped files.

### Option B (chosen): Two migrations — additive create+backfill, then drop

Generate the additive migration first (schema.ts temporarily keeps the
staging tables alongside the new ones — a pure addition, no rename
ambiguity), hand-append the backfill `INSERT ... SELECT` statements, then
generate a second, pure-drop migration once the staging tables are removed
from `schema.ts`.

- Benefits: sidesteps the interactive resolver entirely (each generate step
  is unambiguous); matches the standard expand/contract pattern for a
  production-safe rekey (data lands in the new shape before the old shape is
  removed); each migration file is self-explanatory in isolation.
- Costs and risks: two migration files and a numbered-but-scaffolded
  intermediate state where both old and new tables briefly coexist in
  `schema.ts` during generation (not in any shipped commit — the scaffold is
  removed again before committing).

### Option A: `outcome` reflects the combined Stage 1 + Stage 2 verdict

Store `pass` only when both stages pass, `fail` otherwise.

- Benefits: one column answers "did the learner complete this exercise."
- Costs and risks: breaks hint eligibility, which must key off Stage 1 alone
  (a Stage 1 pass with a Stage 2 violation is not hintable — it gets a
  refactor request, not a hint) — conflating the two would require a second
  column to recover Stage 1's verdict anyway. Also contradicts ADR-0008's
  framing of Stage 1 as the sole authoritative, deterministic gate.

### Option B (chosen): `outcome` is Stage 1's verdict alone

- Benefits: matches ADR-0008 exactly; preserves the walking skeleton's
  `results.passed` semantics unchanged, so hint-eligibility logic needed no
  rework; mastery advancement reads Stage 1 (`outcome`) and Stage 2
  (`stage2Review`, computed in the same request) as the two distinct signals
  ADR-0010 already implied they were.
- Costs and risks: a caller wanting "did this attempt fully complete the
  exercise" cannot read that off `outcome` alone — it must also consult
  `stage2Review`, which is not persisted (unchanged from pre-rekey; Stage 2
  review was never stored, per ADR-0010's scope).

## Consequences

### Positive

- ADR-0010's staging deviation is fully closed: `submissions`, `results`, and
  `submission_hints` no longer exist; `attempts`/`attempt_hints` are the only
  attempt-history tables, matching ADR-0010's original shape exactly.
- `outcome`, `compiler_errors`, and `time_to_solution` now have concrete,
  documented semantics that later scheduling/remediation work (SPEC stories
  41–43, tickets #16–#18) can build against without re-deriving them.
- Existing dev/test data migrated forward via id-reuse rather than being
  dropped, keeping the "rekey, not a rename" promise ADR-0010 made.

### Negative

- `time_to_solution`'s backfill and live-write definitions ("elapsed since
  this exercise's earliest attempt by this learner") are a judgment call ADR-
  0010 left unspecified; a different definition (e.g. per-attempt wall-clock
  duration, once a "started" event exists) would require a further migration
  if adopted later.
- The mastery-advancement scope decided here (Unknown→Introduced→Practiced
  only) means `demonstrated`/`retained` transitions are unimplemented until
  tickets #16–#18 land; a caller reading `learner_concept_mastery` today will
  never see those two states populated.

### Neutral / Risks

- `attempts.compiler_errors` stays nullable in the schema (ADR-0010 does not
  mandate NOT NULL) even though every write path currently populates it
  unconditionally — a future write path skipping it silently degrades hint
  context for that attempt, unless review catches the omission.
- The Option B two-migration split is a tooling/process choice for this
  rekey specifically, not a precedent binding future migrations — a future
  schema change without rename ambiguity can go back to a single
  `drizzle-kit generate` call.

## Confirmation

- Migration review: `drizzle/0008_learner-model-mastery-attempts.sql` creates
  `attempts`/`attempt_hints`/`learner_concept_mastery` and backfills from the
  staging tables; `drizzle/0009_rekey-drop-submissions-results-hints.sql`
  drops `submissions`/`results`/`submission_hints`; `pnpm run db:migrate`
  applies both cleanly from a fresh database.
- `src/features/exercise/exercise.server.test.ts` and
  `src/features/learners/mastery.server.test.ts` (integration tests against
  real Postgres, ADR-0002/ADR-0009's shared seam) assert: `outcome` reflects
  Stage 1 only even on a Stage 2 violation; `compiler_errors` round-trips the
  Sandbox Result; `time_to_solution` is 0 on a first attempt; mastery advances
  to `introduced` on any attempt and to `practiced` only when both stages
  pass; a hardcoded exercise with no `exercise_concepts` row is a mastery
  no-op.

## Relationships and References

- Refines: [ADR-0010](./0010-core-v1-persistence-schema.md) — concretizes the
  `attempts`/`attempt_hints` shape ADR-0010 specified and consumes its
  staging-deviation reconciliation note; ADR-0010's table definitions are
  otherwise unchanged and remain authoritative.
- Related to: [ADR-0008](./0008-deterministic-prompt-shield.md) — `outcome`'s
  Stage-1-only semantics implement ADR-0008's Stage 1 authority at the
  persistence layer.
- Related to: [ADR-0014](./0014-single-learner-session-model.md) — every
  `attempts`/`learner_concept_mastery` write is attributed via
  `getCurrentLearnerId()`, threaded as a parameter per ADR-0014.
- Related to: [ADR-NNNN](./NNNN-shield-blocked-hint-ladder-exhaustion.md) —
  its proposed marker column was never implemented on `submission_hints`, so
  this rekey carries none forward; noted here so the v2 effort doesn't assume
  otherwise.
- Supporting evidence: [docs/SPEC.md](../SPEC.md) stories 41–43 (Learner
  Model); ticket [#10](../../issues/10) (owning work); ticket
  [#59](../../issues/59) (follow-up this ADR resolves); PR #52 (origin of the
  staging deviation).
- Owning implementation package: `src/db/schema.ts`
  (`attempts`/`attemptHints`/`learnerConceptMastery`),
  `src/features/exercise/exercise.server.ts` (`submitExercise`,
  `advanceMasteryOnAttempt`), `src/features/learners/mastery.server.ts`.
