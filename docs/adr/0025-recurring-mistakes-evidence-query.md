# ADR-0025: "Recurring mistakes" evidence — read-time aggregation, no dedicated storage

- **Date**: 2026-08-14
- **Status**: Accepted
- **Deciders**: Xaidel (sole maintainer)

## Context and Problem Statement

SPEC story 42 names "recurring mistakes" among the evidence types the Learner Model
should track. Issue #10's acceptance criteria copied that list verbatim, but
[ADR-0010](./0010-core-v1-persistence-schema.md) — the schema ADR that same AC line cites
as authoritative — never scoped a column or table for it, unlike `demonstrated`/`retained`
which ADR-0010 explicitly named and ADR-0021 explicitly deferred to later tickets.

The raw evidence already exists once issue #10's `attempts` schema lands:
repeated `attempts.outcome = 'fail'` rows for the same learner + concept (via the
`exercise_concepts` join), the `attempts.compiler_errors` diagnostics on those failed rows
(Sandbox Result detail, clusterable into repeated error *patterns*), and `attempt_hints`
escalation (repeatedly needing hints on the same concept). The decision question: how does
"recurring mistakes" get surfaced from the Learner Model, when no concrete consumer of it
exists yet (the remediation/scheduling features — issues #16-#18, Retrieval Queue — are
still open)?

## Decision Drivers

- **No speculative storage**: a dedicated column or table would be built against guessed
  consumer shapes (failure-count vs. pattern clustering vs. hint escalation), with no real
  query to justify it — the exact trap issue #113 warns about.
- **AC requires the decision now**: issue #113's acceptance criterion is "recurring
  mistakes evidence is queryable... either via a documented query pattern or a new
  column/table, decided against a real consumer", plus the decision recorded. The decision
  itself cannot wait for the consumer even if the speculative parts can.
- **Read-time recompute is cheap and consistent**: the platform already recomputes
  read-time projections elsewhere (the usable Concept Graph projection recomputes Concept
  Validation on every read — `getUsableConceptGraph`), and this aggregation is a single
  indexed join over the learner's own attempts.

## Decision

Surface "recurring mistakes" as a **read-time aggregation over the persisted `attempts`
rows — no new column, no new table**: `getRecurringMistakeEvidence(learnerId)` in
`learners/mastery.server.ts` counts the learner's failed attempts per concept via the
`exercise_concepts` join and returns every concept with **two or more failed attempts**,
sorted by failure count descending, with the latest failure timestamp. This is the
documented query pattern for "recurring mistakes": a concept is recurring when the learner
has failed it repeatedly, reconstructed from evidence issue #10 already persists.

- **Deferred, explicitly**: comparing/clustering `compiler_errors` across failed attempts
  to detect repeated failure *patterns*, and consuming `attempt_hints` escalation as
  "recurring mistakes" evidence, are **not** implemented — both are speculative until a
  remediation/scheduling consumer (issues #16-#18, Retrieval Queue) names the shape it
  actually needs. When one lands, it extends this entry point (or replaces it), never
  retrofits the schema.
- **Scope of the aggregation**: attempts with no `exercise_concepts` row (hardcoded v1
  seed exercises) are excluded — they carry no concept to attribute a mistake to.
- **Counting semantics**: a failed attempt on a multi-concept exercise is counted once
  per `exercise_concepts` row it joins to — the count is per concept, not per attempt.
  One failed attempt on a two-concept exercise contributes one to each of its concepts;
  the number of concepts an exercise targets scales the join rows, not the per-concept
  count. A future consumer that needs per-attempt attribution should dedupe at the
  `attempts` level instead.
- **The threshold is a query detail, not a schema contract**: "two or more" is the current
  read-side choice; a consumer with different sensitivity changes the query, not the data
  model.

## Alternatives Considered

### Option A: dedicated aggregation column/table (e.g. `recurring_mistakes`)

A persisted per-(learner, concept) structure, written when a failure is recorded.

- Benefits: constant-time reads for a future scheduling feature.
- Costs and risks: entirely speculative — the shape (count vs. pattern vs. escalation) is
  guessed; every plausible consumer is still open. Duplicates evidence already derivable
  from `attempts`, adding write-path complexity and a reconciliation burden for zero
  current readers. Rejected for the same reason ADR-0010 scoped `time_to_solution`/`outcome`
  but not this: the raw evidence is the durable truth, aggregations are derived.

### Option B (chosen): read-time aggregation, no new storage

`getRecurringMistakeEvidence` computes the recurrence over `attempts` on demand.

- Benefits: no speculative schema; the query is the documentation; cheap at v1 scale
  (single learner, indexed by learner); easily evolved when a consumer lands.
- Costs and risks: a future high-frequency consumer (e.g. per-attempt scheduling reads)
  might want a materialized form — that decision belongs to the consumer ticket, not now.

### Option C: pattern clustering of `compiler_errors` now

Detect repeated error *patterns* from the failed attempts' diagnostics.

- Benefits: the closest reading of "recurring mistakes" as *patterns*, not just counts.
- Costs and risks: no consumer exists to say what a "pattern" is or how it feeds
  remediation; the clustering algorithm (string similarity? structured comparison of the
  `tests`/`message` shape?) is a design of its own. Explicitly deferred per issue #113's
  own guidance to wait for a consumer.

## Consequences

### Positive

- The AC is satisfied without speculative schema: "recurring mistakes" is queryable via a
  documented query pattern, and the decision is recorded here.
- Zero migration; the evidence stays derivable from the durable `attempts` rows
  (ADR-0010/0021) and can never drift from them.

### Negative

- The query is only as good as its failure-count signal: two failures of the same concept
  count as "recurring" regardless of whether they share a root cause — pattern detection
  is explicitly deferred (Option C).
- A future consumer with a different recurrence threshold or a pattern-based definition
  will change this query or supersede this ADR's read-side choice.

### Neutral / Risks

- `getRecurringMistakeEvidence` has no caller yet (v1 — presentation, scheduling, and
  remediation consumers are all future tickets). It is shipped as the tested, documented
  surface — the same "tested future surface" pattern ADR-0016/issue #78 established for
  `getUsableConceptGraph` — not as dead speculative storage.
- If issue #16/#17/#18's eventual consumer needs per-concept failure *patterns*, the
  `compiler_errors` clustering work returns here as its own decision (Option C), extending
  this entry point.

## Confirmation

- `src/features/learners/mastery.server.test.ts` — `getRecurringMistakeEvidence`: reports
  concepts failed at least twice sorted by count; excludes single-failure concepts;
  excludes attempts with no `exercise_concepts` row; counts each failed attempt once per
  joined concept row on a multi-concept exercise.
- No migration: the query reads only tables ADR-0010/0021 already define.

## Relationships and References

- Related to: [ADR-0010](./0010-core-v1-persistence-schema.md) (the `attempts` schema the
  aggregation reads), [ADR-0021](./0021-attempts-rekey-reconciliation.md) (pins
  `outcome`/`compiler_errors` semantics the query relies on), [ADR-0014](./0014-single-learner-session-model.md)
  (learner-scoped state).
- Supporting evidence: issue [#113](https://github.com/Xaidel/teach/issues/113) (follow-up
  from PR #111's Round 1 review), SPEC story 42.
- Owning implementation package: `src/features/learners` (`mastery.server.ts`,
  `mastery.server.test.ts`).
