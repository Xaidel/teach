# ADR-0027: `transfer_test_exercises.passed` — durable Transfer Test pass flag

- **Date**: 2026-08-14
- **Status**: Accepted
- **Deciders**: Xaidel (sole maintainer)

## Context and Problem Statement

ADR-0010's `transfer_test_exercises` table (issue #17) is a pointer: it resolves a learner's
Transfer Test back to the same generated `exercises` instance across retries. It carries no
pass/fail state of its own — the initial implementation derived "has this learner passed their
Transfer Test" by joining to `attempts.outcome`, Stage 1's deterministic sandbox verdict.

That derivation is structurally incomplete. `attempts` only persists Stage 1's verdict
(`outcome`, ADR-0021); Stage 2's qualitative rubric review (issue #6) is computed live at
submission time (`submitExercise`, `exercise.server.ts`) and never written to any column. A
retrospective query against `attempts` therefore cannot know whether Stage 2 passed for a given
attempt — only whether Stage 1 did. Reaching Practiced itself requires both stages
(`stage1Passed && stage2Passed`, `recordAttemptOutcome`); a Transfer Test evidence read that can
only consult Stage 1 is a strictly weaker bar than the one the learner already cleared to reach
Practiced in the first place — backwards for a check whose entire purpose (SPEC story 46,
ADR-0015) is proving mastery generalizes beyond the original pattern.

The gap is deeper than the trigger call site. `promoteToDemonstrated` (`mastery.server.ts`)
re-derives *both* signals independently every time it runs, regardless of which one triggered
it — so even gating the Transfer Test's own trigger on `stage1Passed && stage2Passed` would not
close the gap: a Stage-1-pass/Stage-2-fail attempt would still read as passed evidence the moment
the *other* signal (Explanation Assessment) later fires and re-invokes the same retrospective
`attempts.outcome` query.

Surfaced by Round 1 review of issue #17's implementation (PR #146): the code's own doc comments
justified the Stage-1-only bar with a citation to ADR-0008, which is entirely about Prompt
Shield leakage/injection detection and contains no mention of Stage 1, Stage 2, or Transfer
Testing — the citation did not support the design it was attached to.

## Decision Drivers

- **Parity with Practiced's own bar**: nothing in ADR-0015 or issue #17 asks Transfer Test's
  pass bar to be weaker than Practiced's; the asymmetry was an implementation artifact, not a
  deliberate decision.
- **Stage 2 has no durable home on `attempts`**: a retrospective read can only ever be as
  complete as what's persisted. Adding a general `stage2Passed` column to `attempts` (every
  mode, every attempt) is a much larger surface than this pointer table's own narrow need — out
  of scope for what issue #17 requires.
- **`promoteToDemonstrated` re-derives both signals independently**: the fix must live in the
  evidence read itself (what "passed" means for a `transfer_test_exercises` row), not just in
  the trigger that happens to call `recordTransferTestOutcome`.
- **Column-addition precedent** (ADR-0017, ADR-0019, ADR-0022, ADR-0023): a narrow, single-column
  addition to a table this ADR-family already defines, decided in its own short ADR.

## Decision

- Add **`passed`** — a **`boolean` column, `NOT NULL DEFAULT false`**, on `transfer_test_exercises`.
- Written exactly once, durably, by `markTransferTestExercisePassed`
  (`learners/transfer-test.server.ts`) — called from `recordTransferTestOutcome` the moment
  `recordAttemptOutcome` observes `stage1Passed && stage2Passed` against the learner's
  registered Transfer Test instance, mirroring Practiced's own bar exactly. Never unset:
  idempotent, and mastery never regresses on a later failed retry (ADR-0015).
- `hasPassedTransferTest` / `getPassedTransferTestConceptIds` read this column directly — no
  join to `attempts`, no re-derivation from Stage 1 alone.

## Alternatives Considered

### Option A: Fix the citation only, keep Stage-1-only as a documented, intentional bar

Leave the read deriving "passed" from `attempts.outcome` alone, but replace the ADR-0008
citation with an honest one (or an explicit "no ADR backs this, it's a scoped decision") and
document the retry-leak behavior as accepted.

- Benefits: no migration; smallest possible change.
- Costs and risks: does not fix the underlying weaker-than-Practiced bar, and does not fix the
  `promoteToDemonstrated` retry-leak (a Stage-2-failing attempt still counts as evidence once
  *any* trigger re-runs the read) — leaves story 46's anti-gaming purpose (the entire reason
  Transfer Test exists) with a real, reachable gap rather than a documented trade-off.

### Option B: General `stage2Passed` column on `attempts`

Persist Stage 2's live-computed result on every attempt row, for every mode, then have the
Transfer Test read filter on both `attempts.outcome` and the new column.

- Benefits: more general — any future feature needing retrospective Stage 2 evidence gets it
  for free; keeps `transfer_test_exercises` schema-minimal (still a pure pointer).
- Costs and risks: touches the shared `attempts` insert path (`exercise.server.ts`'s
  `submitExercise`) and every existing test fixture that inserts `attempts` rows directly —
  a much wider blast radius than issue #17's actual need. No other current consumer needs
  retrospective Stage 2 evidence; Practiced's own transition is a one-time write
  (`advanceMastery`), not a retrospective read, so it doesn't need this either.

### Option C (chosen): `passed` boolean on `transfer_test_exercises`

Described in full under Decision above.

- Benefits: scoped entirely to this PR's own new table — no change to the shared `attempts`
  schema or its write path in `exercise.server.ts`; the write happens at the exact moment both
  stages are known (submission time, in-memory), which is also the only moment they ever will
  be known, given Stage 2 isn't persisted elsewhere; removes the `attempts` join entirely,
  simplifying the read.
- Costs and risks: `transfer_test_exercises` is no longer a pure pointer — it now also carries
  one bit of derived state. Accepted: the table's own doc comment already carries the
  "not a new entity" reasoning for its *existing* columns; one boolean recording this table's own
  gate outcome doesn't reopen that decision, since it's not exercise/attempt data duplicated
  elsewhere — it's data that exists nowhere else to duplicate.

## Consequences

### Positive

- Transfer Test's pass bar now matches Practiced's exactly (`stage1Passed && stage2Passed`),
  closing the anti-gaming gap Round 1 review found reachable.
- `promoteToDemonstrated`'s re-derivation is now correct regardless of which trigger (EA or TT)
  invokes it, since the read no longer depends on `attempts.outcome` at all.
- `hasPassedTransferTest` / `getPassedTransferTestConceptIds` lose their `attempts` join,
  simplifying both the query and this table's dependency surface.

### Negative

- One migration on `transfer_test_exercises`.
- `transfer_test_exercises` now holds derived state (`passed`) alongside its pointer columns,
  a small step away from "pure pointer" — scoped and justified above.

### Neutral / Risks

- If a future feature needs retrospective Stage 2 evidence for *ordinary* (non-Transfer-Test)
  attempts, Option B's broader `attempts.stage2Passed` column becomes the right call at that
  point — this ADR does not foreclose it, it only declines to build it now for a need that
  doesn't yet exist.

## Confirmation

- `recordAttemptOutcome` fires `recordTransferTestOutcome` only when both `stage1Passed` and
  `stage2Passed` are true for the learner's registered instance — asserted in
  `mastery.server.test.ts`'s "Transfer Test evidence" suite.
- `hasPassedTransferTest` / `getPassedTransferTestConceptIds` read `transfer_test_exercises
  .passed` directly, with no `attempts` join — reviewable in `learners/transfer-test.server.ts`.
- The migration adds exactly one `boolean NOT NULL DEFAULT false` column — reviewed in
  `drizzle/0016_*.sql`.

## Relationships and References

- Refines: [ADR-0010](./0010-core-v1-persistence-schema.md) — adds a `passed` column to the
  `transfer_test_exercises` table ADR-0010/issue #17 defines; every other column and the table's
  "pointer, not a new entity" framing stand unchanged.
- Related to: [ADR-0015](./0015-explanation-assessment-transfer-test-cadence.md) — this decision
  implements ADR-0015's Practiced → Demonstrated gate's Transfer Test half at its intended
  strength.
- Related to: [ADR-0021](./0021-attempts-rekey-reconciliation.md) — the `attempts.outcome`
  Stage-1-only scoping this decision works around rather than widens.
- Related to: [ADR-0017](./0017-stage2-rubric-storage.md), [ADR-0019](./0019-generated-test-source-storage.md),
  [ADR-0022](./0022-adversarial-exercises-debug-mode-generation.md),
  [ADR-0023](./0023-defect-metadata-persistence-for-fallback-labeling.md) — the column-addition
  precedent this decision follows.
- Supporting evidence: Round 1 review of PR #146 (issue #17) — the fabricated ADR-0008 citation
  and the retry-leak this decision closes; [docs/SPEC.md](../SPEC.md) story 46.
- Owning implementation package: `src/db/schema.ts`, `src/features/learners/transfer-test.server.ts`,
  `src/features/learners/mastery.server.ts`.
