# ADR-NNNN: Shield-blocked hint requests recorded on `submission_hints` as ladder exhaustion

- **Date**: 2026-08-12
- **Status**: Accepted
- **Deciders**: Xaidel (sole maintainer)
- **Scope**: implementation deferred beyond v1 — this decision is approved but the feature is parked for a v2 effort (2026-08-12). The record is deliberately unnumbered until v2 work begins; it receives the next available number then.

## Context and Problem Statement

Hints are generated per request by the AI Teacher Engine (ADR-0004: one LLM call per hint, `low` reasoning effort). Every request is a paid roundtrip with real cost and latency. The deterministic Prompt Shield (ADR-0008, ADR-0012) blocks any hint that would leak the reference solution above the learner's current level — near-zero tolerance at levels 0–3, ~45% at level 4, unchecked at 5.

When a hint request is shield-blocked, today's behavior is: the LLM call has already been paid, the blocked hint is replaced with a generic fallback (`src/lib/ai/functions.server.ts` — "I cannot safely share that hint at this level right now…"), the fallback is persisted at the requested level (`src/features/exercise/exercise.server.ts` — the level slot is consumed), and the ladder simply continues: the next "Request Level N+1" click triggers another LLM call that will very likely block again.

For a simple exercise (e.g. "is it even?", whose entire crux is `n % 2 == 0`), the ladder effectively dies by level 2–3: any further hint is essentially the answer and the shield blocks it. Every subsequent request is a wasted roundtrip — cost paid, nothing served. The learner also cannot distinguish "no more hints exist" from "generation failed", because both surface the same generic message.

The decision question: when the shield blocks a hint request at any level, how do we (a) record that the ladder is exhausted, and (b) change escalation so no further LLM roundtrips are wasted — without silently bypassing the explicit opt-in gate on the full solution (SPEC story 23)?

## Decision Drivers

- **LLM roundtrip cost (ADR-0004)**: every wasted hint request is a paid call. The core motive is to stop paying for requests that are near-certain to block again.
- **Determinism (ADR-0008)**: the exhaustion signal must not require an extra LLM call; the shield block itself is the deterministic signal.
- **Pedagogical gate (SPEC story 23)**: level 5 (full solution) is reachable only by explicit learner opt-in; a dead ladder must not bypass that gate silently.
- **State derivation**: hint state is derived server-side from persisted `submission_hints` rows; exhaustion must survive page reloads or the savings are lost.

## Decision

We will:

1. **Add a column to `submission_hints`** (the staging table from ADR-0010's deviation note) marking a served hint row as shield-blocked — a boolean or kind discriminator whose only two values are "served hint" and "blocked refusal". The marker is set exactly when `generateHint` returns the shielded fallback; it is not derivable from `content`. Existing rows default to "served hint".
2. **Treat a blocked row as ladder exhaustion.** When a request at any level 0–4 is shield-blocked, the ladder is dead: the "Request Level N+1" button is no longer offered and no further `next` requests are accepted. The refusal message — an authored constant, e.g. "I can't give you any more hints — it would reveal the answer" — is served as the content of the level-N row, replacing today's generic fallback. At most one blocked row exists per submission: the ladder dies at the first block.
3. **Unlock the level-5 CTA after exhaustion.** The normal rule "full solution only after level 4 served" gains a carve-out: a submission whose ladder is exhausted may be offered level 5. The offer is gated by a confirmation dialog warning that proceeding reveals the answer. Declining leaves the ladder dead and the warned CTA visible; the learner simply keeps working with what they have.
4. **Persist no separate refusal record** — the blocked row *is* the record. No new table.

## Alternatives Considered

### Option A (chosen): New column on `submission_hints`

- Benefits: explicit, queryable state derived server-side without string matching; the marker survives page reloads; the existing unique index `(submission_id, hint_level)` and CHECK constraint are unaffected (the blocked row simply occupies the level-N slot); the ADR-0010 rekey migration (`submission_hints` → `attempt_hints`) carries the column over when the real attempts model lands.
- Costs and risks: a schema change on a table already flagged as a staging deviation awaiting rekey — the deviation note in ADR-0010 must be updated so the rekey preserves the column; a new migration for a table that will itself be re-keyed.

### Option B: Content marker — compare served `content` against the authored refusal constant

- Benefits: zero schema change.
- Costs and risks: deriving state from content is fragile — the marker and the message are coupled, and any wording change silently invalidates the historical rows that state derivation depends on; content is not a state channel.

### Option C: Session-only exhaustion, no persistence

- Benefits: nothing stored.
- Costs and risks: a page reload resets the ladder; level N+1 becomes requestable again, paying the very roundtrips this decision exists to eliminate. Violates the state-derivation driver outright.

### Option D: LLM-generated refusal text (no new column, no exhaustion)

- Benefits: conversational, question-aware refusal; no schema change.
- Costs and risks: the roundtrip at the blocked level is already paid, so the LLM adds no cost saving; the response is nondeterministic; and a refusal must *know the answer to refuse it*, so at levels 0–3 the shield (near-zero tolerance) would likely block the refusal itself, landing on the generic fallback — the exact UX being fixed. Rejected on determinism and cost grounds.

### Option E (do nothing): keep generic fallback, ladder continues

- Costs and risks: every blocked level still pays a roundtrip; the generic fallback keeps misleading the learner into thinking generation failed; the cost motive is unaddressed.

## Consequences

### Positive

- Wasted roundtrips are eliminated: after the first shield block, no further LLM calls are made for that submission's ladder.
- Exhaustion survives reloads because it is persisted state, so the savings hold across sessions.
- The learner receives a clear, deterministic refusal instead of a confusing generic failure — and a deliberate, warned path to the full solution.
- No extra LLM call and no nondeterminism — consistent with ADR-0008's philosophy.

### Negative

- A schema change lands on the staging table, and the ADR-0010 rekey migration must now preserve the new column when `submission_hints` merges into `attempt_hints` — the reconciliation record must carry it.
- Pedagogical trade on complex questions: a shield block at level N < 4 kills the ladder even though level 4's ~45% tolerance could have served a useful partial solution. Accepted as a deliberate cost trade — the whole point is not paying for a roundtrip we believe will be wasted.
- SPEC story 23's precondition ("full solution only after level 4 served") now has a carve-out; `docs/SPEC.md` needs a corresponding refinement. This is a product-level change, surfaced here rather than silently rewritten.

### Neutral / Risks

- **Auto Level-0 hint blocks do not exhaust the ladder.** The best-effort Level 0 hint generated on Stage 1 failure (`exercise.server.ts`) stays silent when shield-blocked — nothing persisted, ladder untouched; only a learner-initiated request can trigger exhaustion. The first real request starts the ladder normally, and if it too is blocked, the ladder dies at that level at the learner's initiative.
- **Redundant `next` requests after exhaustion return the persisted refusal row.** A `next` request arriving when the ladder is dead (stale UI, double-click) re-serves the already-persisted refusal content — idempotent, no LLM call, no `HINT_ESCALATION_INVALID`. The error remains only for genuinely invalid actions (redundant `full_solution`, duplicate concurrent same-level requests).
- The refusal wording is an authored constant; exact copy is a product detail, not architecture.

## Confirmation

- Migration review: `submission_hints` gains the marker column defaulting to "served hint"; existing rows are unaffected.
- Integration tests on the shared seam (ADR-0002, ADR-0009): a shield-blocked request at level N persists a blocked row; the ladder logic then rejects `next` and allows `full_solution`; a `next` request after exhaustion never reaches the AI client test double (ADR-0004).
- Fixture-based shield tests (per ADR-0008's Confirmation): a blocked hint returns the refusal content plus the marker, at each shield-checked level.

## Relationships and References

- Related to: [ADR-0004](./0004-openai-compatible-single-model-adjustable-effort.md) — LLM cost per task is the driver; [ADR-0008](./0008-deterministic-prompt-shield.md) — the deterministic block is the exhaustion signal; [ADR-0012](./0012-prompt-shield-near-match-algorithm.md) — per-level block semantics (near-zero at 0–3, ~45% at 4); [ADR-0010](./0010-core-v1-persistence-schema.md) — `submission_hints` staging table and its rekey reconciliation record.
- Supporting evidence: [docs/SPEC.md](../SPEC.md) stories 22–24 (ladder shape; explicit opt-in for level 5 — story 23's precondition gains the exhaustion carve-out noted above); [docs/INITIAL_PRD.md](../INITIAL_PRD.md) Section 19.
- Owning implementation package: none yet — feature not built; staging surface is `src/features/exercise/`, `src/db/schema.ts`, `src/lib/ai/`.
