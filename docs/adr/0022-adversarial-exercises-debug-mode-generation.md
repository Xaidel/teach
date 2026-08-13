# ADR-0022: Adversarial exercises as debug-mode generation with contract-only defect metadata

- **Date**: 2026-08-13
- **Status**: Proposed
- **Deciders**: Xaidel (sole maintainer)

## Context and Problem Statement

SPEC stories 51-52 and PRD §20 establish adversarial exercises: some exercises must intentionally contain a known, verified defect (incorrect ownership, race conditions, broken invariants, …) so the learner practices debugging, and every such exercise must carry a known defect, known target concept, known reference solution, and verified tests — the AI must never ship an invented, unverified bug. Issue #11 is the build ticket; it lands on top of the exercise generation + Pre-Flight pipeline (issue #8, PR #88), which already produces implement-mode exercises where `starterCode` is a plausible-but-wrong implementation and `referenceSolution` is the correct one.

Three questions were not settled by the spec: (1) how an adversarial exercise is *targeted* at generation time; (2) whether the declared defect metadata is persisted in the exercise store; (3) whether adversarial generations get any extra verification beyond the existing Pre-Flight gate. ADR-0010's `exercises.mode` enum already contains `debug` — an empty discriminator the generation pipeline never writes.

## Decision Drivers

- **No invented, unverified bugs (SPEC story 52)**: the deterministic guarantee must be that an adversarial exercise's broken state actually fails and its reference actually passes — model prose alone is never the verification.
- **One gate (SPEC story 52)**: adversarial exercises go through the same Pre-Flight Validation as any other exercise, not a second, adversarial-only gate.
- **Follow the repo's column-addition precedent (ADR-0017, ADR-0019)**: generated-exercise metadata columns (`evaluation_rubric`, `test_source`) were added only when a consuming feature landed, each with its own ADR — not speculatively at generation time.
- **Zero-migration delivery**: the `debug` mode value already exists in the `exercise_mode` enum (ADR-0010), so adversarial generation can ship without a schema change.

## Decision

If accepted, we will:

- Target adversarial generation with a boolean `adversarial` flag on the generation input, threaded through the whole stack — UI toggle → server function → feature input schema → AI input schema — with no adversarial-specific branching in Pre-Flight itself.
- Extend the generated-output contract with an optional `defect` declaration — `{ kind, description, location, expectedBehavior }`, where `kind` is one of `ownership | lifetime | race_condition | broken_invariant | error_handling | api_misuse | other` (mirroring PRD §20's examples) — and reject an adversarial call whose output omits it as invalid model output. The defect is thus always *declared* (the "known defect") and always *behaviorally verified* by the unchanged Pre-Flight gate (the "verified defect"); no invented, undeclared bug can ship.
- Persist adversarial rows with `mode = 'debug'` (ADR-0010's existing discriminator); keep the defect declaration in the generation contract only — no new column in v1. A future consumer (the exercise play flow) adds a `defect` column following the ADR-0017/0019 precedent when it actually needs the metadata.
- Run adversarial generations through the exact same Pre-Flight checks (`reference_passes`, `broken_state_fails`, `failure_matches_concept`), the same 3-attempt retry loop with diagnostics-feed-forward, the same circuit breaker, and the same discard-on-failure behavior as non-adversarial ones. The `adversarial` flag survives the retry loop and the simplified fallback regeneration; the verified-fallback path (SPEC story 34) stays mode-agnostic — its contract is that a learner is never blocked by a failed generation, not that the fallback preserves the requested mode.

## Alternatives Considered

### Option A: Persist the defect as a jsonb column on `exercises` now

Add a nullable `defect` column alongside `evaluation_rubric`/`test_source`, written by the same generation path.

- Benefits: the defect metadata outlives the generation response without a later migration; the play flow can render the defect without schema work.
- Costs and risks: no consumer of the column exists in v1 (no exercise-play route yet), so it would be speculative storage; every other generated-exercise metadata column in this repo (ADR-0017, ADR-0019) was added by its consuming feature, and the learner-facing prompt already carries the defect framing at play time. Column added now would need an ADR, a migration, and would commit the defect shape before any consumer validates it.

### Option B (chosen): Contract-only defect metadata, `debug` mode persisted

The defect lives in the structured generation output; the row records `mode = 'debug'`; Pre-Flight verifies behaviorally.

- Benefits: zero migration; the "known defect" is explicit in the generation contract where the spec's guarantee lives; verification stays deterministic (broken state fails, reference passes) rather than judging model prose; the retry loop's diagnostics-feed-forward works unchanged because the draft shape is unchanged.
- Costs and risks: the defect prose is not queryable from the store in v1 — the play flow will add the column (with an ADR, per precedent) when it lands; a reader of the `exercises` table cannot tell *what* defect a debug row carries, only that it is debug-mode.

### Option C: LLM-based defect verification for adversarial generations

After the deterministic gate, have the model review its own defect declaration against the code.

- Benefits: could catch a declared-but-mismatched defect that the deterministic gate cannot (the gate verifies the *broken state*, not the prose).
- Costs and risks: violates SPEC story 28's authority principle — the model that generated the exercise would grade its own output; adds a model call per generation; is non-deterministic and cannot be a "verified" guarantee. Rejected because PRD §20's "verified" is behaviorally defined (Pre-Flight passes), and prose correctness is not deterministically verifiable at all.

## Consequences

### Positive

- Adversarial generation ships with no migration and no second gate: targeting is a flag, the contract carries the declaration, and Pre-Flight stays the single deterministic authority.
- An adversarial draft that fails Pre-Flight is discarded and retried exactly like any other — the "never an invented, unverified bug" guarantee is enforced by the existing loop, not by a new mechanism.
- The `debug` mode discriminator ADR-0010 reserved from day one finally gets a writer, at zero schema cost.

### Negative

- Defect metadata is not persisted in v1; when the exercise play flow needs it, a `defect` column + ADR must follow (the documented precedent).
- A generated adversarial exercise can declare a defect whose prose doesn't perfectly describe the code (the gate cannot verify prose); the deterministic guarantee is behavioral, not textual.

### Neutral / Risks

- Verified-fallback (SPEC story 34) may serve a non-adversarial exercise for an adversarial request — accepted as in-scope of the fallback's "never block the learner" contract; revisit if the play flow needs mode-preserving fallback.
- The defect-kind enum will likely grow (e.g. `transaction_behavior`) when Go/Python generation (issues #19/#20) lands — extending the enum is a schema-only change.

## Confirmation

- A generated exercise with `adversarial` input persists with `mode = 'debug'` and the generation response carries a `defect` declaration — asserted by `exercise-generation.server.test.ts` (adversarial success, retry, and simplified-fallback cases).
- An adversarial call whose output omits `defect`, or declares an unknown kind, is rejected as `invalid_output` — asserted by `src/lib/ai/functions.server.test.ts`.
- Pre-Flight runs the same three checks and the same retry/discard loop for adversarial and non-adversarial generations — the adversarial server tests assert the identical sandbox-call sequence and attempt log.

## Relationships and References

- Refines: [ADR-0010](./0010-core-v1-persistence-schema.md) — activates the `debug` value of the `exercise_mode` enum it defined, without changing the schema.
- Related to: [ADR-0017](./0017-stage2-rubric-storage.md), [ADR-0019](./0019-generated-test-source-storage.md) — the column-addition precedent this decision defers to; a future `defect` column will follow their pattern.
- Supporting evidence: [docs/SPEC.md](../SPEC.md) stories 51-52 (Adversarial Exercises); [docs/INITIAL_PRD.md](../INITIAL_PRD.md) §20 (Adversarial Exercises); issue #11.
- Owning implementation package: `src/features/exercise/exercise-generation.server.ts`, `src/lib/ai/schemas.ts`, `src/lib/ai/prompts/generate-exercise.prompt.ts`, `src/features/exercise/components/exercise-generation-card.tsx`.
