# ADR-0019: Generated test source storage on `exercises`

- **Date**: 2026-08-11
- **Status**: Accepted
- **Deciders**: Xaidel (sole maintainer)

## Context and Problem Statement

ADR-0010's `exercises` table (`id`, `mode`, `difficulty`, `constraints`, `reference_solution`,
`status`) has no column for the generated test code itself — PRD §13's `evaluation.tests` list
(e.g. `ownership_test`, `borrowing_test`) names tests an exercise must pass, but nothing in
ADR-0010 says where the actual generated test *source* that implements those named tests is
persisted.

This isn't a hypothetical gap: ADR-0011 already assumes the artifact exists, calling it "the
exercise's test harness" and stating that it, together with the learner's submission, is "written
into [the Sandbox Workspace] before the container starts" on every run. Stage 1 needs to re-run
that same test code on every subsequent attempt against a given exercise — not just once at
generation/Pre-Flight time — and the fallback-to-a-previously-verified-exercise path (ADR-0010,
SPEC story 34) depends on a stored exercise row carrying everything needed to re-run it later, not
just at the moment it was generated. Without a persisted home for the test harness, Stage 1 has
nothing to write into the workspace on a second or later attempt.

Surfaced while resolving [ADR-0017](./0017-stage2-rubric-storage.md) (wayfinder ticket
[#32](../../issues/32)) but deliberately left out of that ticket's scope, since it's a distinct
column decision on the same table rather than part of the Stage 2 rubric question.

This ADR was resolved as wayfinder ticket [#34](../../issues/34) ("Generated test source
persistence on the exercises schema") on the [AI Learning Platform v1 map](../../issues/21), and
gates build tickets [#8](../../issues/8) (Exercise Generation + Pre-Flight Validation: Rust),
[#9](../../issues/9) (Pre-Flight retry, circuit breaker, verified-exercise fallback),
[#19](../../issues/19) (Go), and [#20](../../issues/20) (Python) — each needs a concrete place to
write/read generated test code rather than improvising one during implementation.

## Decision Drivers

- **Consistency with ADR-0010's existing precedent**: `reference_solution` is already a raw
  generated-source column on this same table; a second generated-source artifact is the same kind
  of thing, not a new kind.
- **Conceptual separation** (same reasoning ADR-0017 applied to `constraints` vs.
  `evaluation_rubric`): the reference solution is "the correct answer"; the test harness is "how
  any answer is checked" — two different concepts that happen to both be source code.
- **Mode correctness**: ADR-0010 already establishes that `explain`-mode exercises skip Stage 1
  entirely — a test-source-storage decision must not accidentally imply otherwise.
- **Solo-maintainer operability**: nothing in v1 needs to query, update, or re-run an individual
  named test in isolation from the rest of its exercise's test file.
- **Re-run requirement**: Stage 1 must be able to reproduce the exact same test run on any
  subsequent attempt against the same exercise, not only immediately after generation.

## Decision

- Add **`test_source`** — a **nullable `text` column** on `exercises`, sibling to
  `reference_solution`.
- Holds the full generated test file's source as one blob — the named tests PRD §13's
  `evaluation.tests` list refers to (e.g. `ownership_test`, `borrowing_test`) are read as multiple
  test functions inside that one generated file, matching how each language's native test runner
  (`cargo-nextest`, `go test`, `pytest`) already discovers multiple named tests within a single
  source file.
- Populated at generation time by `generateExercise`, alongside `reference_solution` and
  `evaluation_rubric` (ADR-0017), for `implement`/`debug`-mode rows.
- Left `NULL` for `explain`-mode rows — identical rule to ADR-0017's `evaluation_rubric`
  nullability: those rows skip Stage 1 entirely (ADR-0010) and have no code to test.
- Stage 1 writes this column's value into the Sandbox Workspace as the exercise's test harness
  (ADR-0011) on every attempt, not only the generation-time Pre-Flight run — this column is what
  makes that re-run possible without regenerating the tests.
- The specific file path each language's toolchain expects the harness written to (e.g. a Rust
  `tests/*.rs` integration file vs. a colocated Go `_test.go` file vs. a separate Python
  `test_*.py` module) remains ADR-0011/sandbox-orchestration mechanics, applied per-language by
  whoever implements build tickets #8/#19/#20 — not fixed by this ADR.
- No other change to ADR-0010's schema; every other table and column stands as originally decided.

## Alternatives Considered

### Storage location: bundle into `reference_solution` vs. dedicated column

**Option A: bundle into `reference_solution`.** Widen the existing column into a combined value
carrying both the correct implementation and the generated test code together.

- Benefits: no new column.
- Costs and risks: conflates a "what's the correct answer" artifact with a "how is any answer
  checked" artifact under one name, for no querying or storage benefit in return — the same
  reasoning ADR-0017 used to reject folding the Stage 2 rubric into `constraints`.

**Option B (chosen): dedicated `test_source` column.**

- Benefits: keeps two distinct concepts distinct at the schema level, consistent with
  `evaluation_rubric`'s own precedent as a separate column rather than a widened
  `constraints`/`reference_solution`.
- Costs and risks: one more column to migrate and keep populated correctly per mode.

### Shape: structured per-test jsonb vs. single text blob

**Option A: structured jsonb keyed by test name**, e.g. an array of `{ name: string, source:
string }` objects, mirroring PRD §13's `evaluation.tests` list entry by entry.

- Benefits: individual named tests are independently addressable and updatable.
- Costs and risks: nothing in v1 needs to query, diagnose, or update a single named test in
  isolation from the rest of its exercise's test file — PRD §13's test names read as labels for
  test *functions* within one generated file, not as independently stored units. This also splits
  the generated harness across storage in a way the native per-language test runners never need,
  since they already discover multiple named tests inside one source file unassisted.

**Option B (chosen): single `text` blob, one value per exercise row.**

- Benefits: matches `reference_solution`'s own shape and precedent (raw generated source, not
  structured data) on this same table; no per-test indexing or aggregation to maintain for a value
  nothing in v1 needs to query into.
- Costs and risks: individual tests aren't independently queryable — acceptable since nothing in
  v1 needs that, and diagnosing a specific test failure is a Pre-Flight/Stage 1 *result* concern
  (`pre_flight_attempts.diagnostics`, the Sandbox Result's per-test `tests` array — ADR-0010,
  ADR-0011), not a storage-shape concern for the source itself.

### Nullability: `NOT NULL` with empty-string default vs. nullable

**Option A: `NOT NULL`**, `explain`-mode rows get an empty string.

- Benefits: no null-handling branch anywhere the column is read.
- Costs and risks: an empty string reads ambiguously — "no test source was generated" versus "this
  mode never reaches Stage 1 at all" are different claims a lone empty value can't distinguish,
  the same problem ADR-0017 identified for `evaluation_rubric`.

**Option B (chosen): nullable.**

- Benefits: `NULL` says the honest thing — Stage 1 doesn't apply to this row's mode — distinct
  from "applies, but the harness is somehow empty." Directly consistent with `evaluation_rubric`'s
  nullability rule on the same table.
- Costs and risks: every read path must handle the null case for `explain`-mode rows, same as it
  already must for `evaluation_rubric`.

## Consequences

### Positive

- Build tickets #8, #9, #19, and #20 have a concrete column to implement against instead of an
  undefined gap in ADR-0010's schema.
- ADR-0011's "the exercise's test harness" now has a stated storage location, closing the gap
  between what ADR-0011 assumed exists and what ADR-0010 actually defined.
- Every subsequent attempt against an exercise (including the ADR-0010 fallback-to-a-previously-
  verified-exercise path) can re-run the exact same test harness without regenerating it.

### Negative

- One more nullable column on `exercises` whose applicability (only `implement`/`debug` modes) is
  knowable only from `mode`, not from the column itself — the same characteristic ADR-0017 already
  accepted for `evaluation_rubric`, now doubled.
- A migration against `exercises`, in addition to whatever ADR-0010's and ADR-0017's migrations
  already cover.

### Neutral / Risks

- The exact file path/name each language's toolchain expects the harness written to (Rust
  `tests/*.rs`, Go `_test.go`, Python `test_*.py`) is left to build tickets #8/#19/#20 — this ADR
  fixes only where the source is stored, not how Stage 1 materializes it on disk per language.
- If a future need arises to diagnose or update an individual named test independently (rather
  than regenerating the whole exercise), the single-blob shape would need revisiting — no such
  need exists in v1.

## Confirmation

No code implements this yet as of this writing; there is no automated check to point to today.
Once built: a migration adds `exercises.test_source` (text, nullable); `generateExercise`'s zod
output schema and its corresponding DB write path populate it for `implement`/`debug` modes and
leave it `NULL` for `explain`; Stage 1's workspace-write step reads it and writes it into the
Sandbox Workspace on every attempt, not only the generation-time Pre-Flight run — verifiable by
schema/migration review and by Stage 1's implementation once tickets #8/#9 are picked up.

## Relationships and References

- Related to: [ADR-0010](./0010-core-v1-persistence-schema.md) — adds a `test_source` column to
  the `exercises` table ADR-0010 defines; the rest of that schema is unchanged and remains
  authoritative.
- Related to: [ADR-0011](./0011-sandbox-orchestration-mechanics.md) — this ADR supplies the
  storage location for the "test harness" artifact ADR-0011 already names but leaves unlocated.
- Related to: [ADR-0017](./0017-stage2-rubric-storage.md) — same treatment precedent: a short
  follow-up ADR for a single nullable-column addition to an ADR-0010 table, with an identical
  per-mode nullability rule.
- Supporting evidence: `docs/SPEC.md` story 29; `docs/INITIAL_PRD.md` §13 (exercise generation
  shape, `evaluation.tests`); wayfinder ticket [#32](../../issues/32)'s resolution (surfaced this
  gap); wayfinder ticket [#34](../../issues/34) on map [#21](../../issues/21) (resolution session
  this ADR records).
- Owning implementation package: none yet — no code implements this as of this writing.
