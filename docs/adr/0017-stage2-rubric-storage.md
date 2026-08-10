# ADR-0017: Stage 2 evaluation rubric storage on `exercises`

- **Date**: 2026-08-11
- **Status**: Accepted
- **Deciders**: Xaidel (sole maintainer)

## Context and Problem Statement

ADR-0010's `exercises` table (`id`, `mode`, `difficulty`, `constraints`, `reference_solution`,
`status`) has no column to persist the Stage 2 rubric (required/prohibited/advisory criteria,
`docs/INITIAL_PRD.md` §18), even though `docs/SPEC.md` story 29 and wayfinder ticket
[#23](../../issues/23)'s resolution (AI Teacher Engine interface contract) both say
`generateExercise` produces one combined evaluation spec — tests *and* the Stage 2 rubric — at
generation time. Ticket #23 surfaced this gap explicitly rather than deciding it inline, since
it falls under ADR-0010's schema, not the interface contract itself.

This ADR was resolved as wayfinder ticket [#32](../../issues/32) ("Stage 2 rubric storage on the
exercises schema") on the [AI Learning Platform v1 map](../../issues/21), and gates build
tickets [#6](../../issues/6) (Stage 2 qualitative code review) and [#8](../../issues/8) (Exercise
Generation + Pre-Flight Validation: Rust).

## Decision Drivers

- **Consistency with ADR-0010's existing precedent**: `constraints` is already an unstructured
  jsonb column on this same table, not normalized into a child table.
- **Conceptual separation**: `constraints` is a generation-time *input* (what the generator may
  or may not use); the rubric is an evaluation-time *output* (what Stage 2 checks the submission
  against) — two different concepts that happen to both be "a list of strings."
- **Solo-maintainer operability**: nothing in v1 needs to query or aggregate across rubric
  criteria; a single generated-and-read-as-one-unit value doesn't justify normalization.
- **Mode correctness**: ADR-0010 already establishes that `explain`-mode exercises skip Stage 1
  and never reach Stage 2 — a rubric-storage decision must not accidentally claim otherwise.

## Decision

- Add **`evaluation_rubric`** — a **nullable jsonb column** on `exercises`.
- Shape: `{ required: string[], prohibited: string[], advisory: string[] }`, mirroring PRD §18's
  `review:` YAML directly.
- Populated at generation time by `generateExercise`, alongside `constraints` and
  `reference_solution`, for `implement`/`debug`-mode rows.
- Left `NULL` for `explain`-mode rows — those skip Stage 1 and therefore never reach Stage 2
  (ADR-0010), so no rubric applies.
- No other change to ADR-0010's schema; every other table and column stands as originally
  decided.

## Alternatives Considered

### Storage location: fold into `constraints` vs. dedicated column

**Option A: fold into `constraints`.** Widen the existing jsonb `constraints` column into a
combined object holding both the generation-time constraint list and the Stage 2 rubric.

- Benefits: no new column.
- Costs and risks: conflates a generation-time input with an evaluation-time output under one
  name; every reader of "the constraints" now has to know to ignore the rubric sub-key and vice
  versa, for no querying benefit in return.

**Option B (chosen): dedicated `evaluation_rubric` column.**

- Benefits: keeps two distinct concepts distinct at the schema level; each column reads for
  exactly what it is.
- Costs and risks: one more column to migrate and keep populated correctly per mode.

### Shape: normalized child table vs. single jsonb column

**Option A: `exercise_rubric_criteria` child table** (`exercise_id`, `kind` enum
`required`/`prohibited`/`advisory`, `criterion` text), mirroring the `kind`-discriminated
adjacency pattern ADR-0010 already uses for `concept_edges`.

- Benefits: consistent with an existing schema pattern; each criterion individually queryable.
- Costs and risks: more migration surface for a value that's generated once, atomically, as part
  of one exercise — nothing in v1 needs to query or filter by individual criterion, and
  `constraints`, the closest existing precedent on this very table, is already unstructured
  jsonb rather than normalized.

**Option B (chosen): single jsonb column, one value per exercise row.**

- Benefits: matches `constraints`' own precedent on this table; no extra table, join, or index to
  maintain for a value nothing needs to query into.
- Costs and risks: individual criteria aren't independently indexable or queryable — acceptable
  since nothing in v1 needs that.

### Nullability: `NOT NULL` with empty-array default vs. nullable

**Option A: `NOT NULL`,** `explain`-mode rows get `{ required: [], prohibited: [], advisory: [] }`.

- Benefits: no null-handling branch anywhere the column is read.
- Costs and risks: an empty rubric reads as "this exercise has zero required/prohibited/advisory
  criteria" — a different, false claim from "this exercise's mode never goes through Stage 2 at
  all." It also becomes indistinguishable from a genuinely empty rubric, should that ever occur
  on an `implement`/`debug` exercise.

**Option B (chosen): nullable.**

- Benefits: `NULL` says the honest thing — Stage 2 doesn't apply to this row's mode — distinct
  from "applies, but with zero criteria."
- Costs and risks: every read path must handle the null case for `explain`-mode rows.

## Consequences

### Positive

- Build tickets #6 and #8 have a concrete column to implement against instead of an undefined
  gap in ADR-0010's schema.
- `generateExercise`'s "one combined evaluation spec" output (SPEC story 29) has a home for its
  Stage 2 half without inventing a shape mid-implementation.

### Negative

- One more nullable column on `exercises` whose applicability (only `implement`/`debug` modes)
  is knowable only from `mode`, not from the column itself — every future reader must know that
  rule rather than reading it off the schema directly.
- A migration against `exercises`, in addition to whatever ADR-0010's original migration already
  covers.

### Neutral / Risks

- Where the *tests* half of SPEC story 29's "combined evaluation spec" (as opposed to the Stage 2
  rubric this ADR covers) is persisted is untouched here — out of this ticket's scope, and not
  claimed to be resolved elsewhere by this ADR.

## Confirmation

No code implements this yet as of this writing; there is no automated check to point to today.
Once built: a migration adds `exercises.evaluation_rubric` (jsonb, nullable); `generateExercise`'s
zod output schema and its corresponding DB write path populate it for `implement`/`debug` modes
and leave it `NULL` for `explain`; the Stage 2 review call (`reviewSubmission`) reads
`required`/`prohibited` from it to gate pass/fail and `advisory` for informational output only —
verifiable by schema/migration review and by `reviewSubmission`'s implementation once ticket #6
is picked up.

## Relationships and References

- Related to: [ADR-0010](./0010-core-v1-persistence-schema.md) — adds an `evaluation_rubric`
  column to the `exercises` table ADR-0010 defines; the rest of that schema is unchanged and
  remains authoritative.
- Related to: [ADR-0016](./0016-concept-graph-review-workflow.md) — same treatment precedent: a
  short follow-up ADR for a single-column addition to an ADR-0010 table, rather than reopening
  ADR-0010 itself.
- Supporting evidence: `docs/SPEC.md` story 29; `docs/INITIAL_PRD.md` §13 (exercise generation
  shape) and §18 (Stage 2 qualitative evaluation, the `review:` YAML this column's shape
  mirrors); wayfinder ticket [#23](../../issues/23)'s resolution (surfaced this gap); wayfinder
  ticket [#32](../../issues/32) on map [#21](../../issues/21) (resolution session this ADR
  records).
- Owning implementation package: none yet — no code implements this as of this writing.
