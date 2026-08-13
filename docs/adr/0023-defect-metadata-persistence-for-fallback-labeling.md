# ADR-0023: Defect metadata persistence on `exercises` for fallback labeling fidelity

- **Date**: 2026-08-13
- **Status**: Proposed
- **Deciders**: Xaidel (sole maintainer)

## Context and Problem Statement

ADR-0022 decided that adversarial (debug-mode) generations keep their declared `defect` in the generation contract only — the `exercises` row records `mode = 'debug'` and nothing else, and a future consumer "adds a `defect` column following the ADR-0017/0019 precedent when it actually needs the metadata" (ADR-0022, Option B, Negative consequences).

That consumer has now arrived. The verified-fallback path (SPEC story 34) serves a stored verified exercise row as-is when all Pre-Flight attempts fail. That row may be an adversarial one — `mode = 'debug'` — but the fallback output carries no defect, so the generation card renders it without the adversarial label ("Fell back to a previously verified exercise — …" with no "adversarial (kind) …" suffix), while a freshly generated adversarial exercise renders the label. A stored adversarial row re-served via fallback is thus mislabeled against its own `mode`, the mirror of the #117 contradiction (which was rejected at generation time but never covered the fallback read path).

Issue #120 asks to surface the defect on the fallback path so the card renders the adversarial label consistently. The defect is not persisted, so the fallback path cannot surface it without a schema change.

## Decision Drivers

- **Labeling fidelity on the fallback path (issue #120)**: a stored adversarial row served via fallback must render the adversarial label, consistent with a freshly generated one.
- **Follow the repo's column-addition precedent (ADR-0017, ADR-0019, ADR-0022)**: generated-exercise metadata columns are added when a consuming feature lands, as nullable jsonb/text columns populated by the generation path, each with its own ADR.
- **Zero-migration delivery is no longer possible**: the fallback consumer exists now, so the "contract-only" zero-migration cost of ADR-0022 Option B is exactly the gap this decision closes.

## Decision

If accepted, we will:

- Add a **nullable `defect` jsonb column** on `exercises`, typed to the generation contract's `ExerciseDefect` shape (`{ kind, description, location, expectedBehavior }`, ADR-0022).
- Populate it at generation time from the adversarial generation's `defect` declaration — written by the same `persistVerifiedExercise` path that writes `mode = 'debug'` — and leave it `NULL` for `implement`/`explain` rows.
- Surface it on the **verified-fallback** output: `findVerifiedFallback` includes the stored row's `defect` when present, so the generation card renders the adversarial label on the fallback branch exactly as on the generated branch.
- Keep the fallback **mode-agnostic** selection (ADR-0022): the fallback may still serve a non-adversarial row for an adversarial request — the change is labeling fidelity for whatever verified row is served, not mode preservation.

## Alternatives Considered

### Option A: Contract-only, document the fallback trade-off (do nothing)

Keep the defect out of the store; the fallback output stays without a defect and the card renders no adversarial label on the fallback branch.

- Benefits: no migration; ADR-0022's zero-migration delivery is preserved.
- Costs and risks: the #117-adjacent mislabeling the issue names stays forever; the card contradicts the stored `mode` every time an adversarial row is re-served; the defect is unrecoverable server-side at any later read (hint/review/play flows), so the "add the column when a consumer needs it" deferral would only push the same migration to the next consumer.

### Option B (chosen): Persist `defect`, surface on the fallback path

- Benefits: closes the labeling gap at its source — the store now carries the defect, the fallback read path and any future consumer (play flow, hint context) can render it; follows the ADR-0017/0019/0022 column precedent exactly (nullable, typed jsonb, populated by the generation path, own ADR).
- Costs and risks: one migration; the defect shape is committed to storage before the play flow validates it — but it is the same shape the generation contract already commits to (ADR-0022), so storage adds no new shape commitment. Pre-existing debug rows (created before this migration) have `NULL` defect and will still render without the label until regenerated — accepted, no backfill; the invariant going forward is defect presence ⟺ `mode = 'debug'` on newly generated rows.

### Option C: Fallback serves only same-mode rows (mode-preserving fallback)

Make `findVerifiedFallback` skip rows whose `mode` mismatches the requested mode.

- Benefits: an adversarial request never receives a non-adversarial row.
- Costs and risks: reverses ADR-0022's deliberate mode-agnostic contract (SPEC story 34 is "never block the learner", not "preserve the requested mode"); a concept with only a non-adversarial verified row would fall through to the simplified regeneration for every adversarial request, adding generation load; and it does not solve the labeling problem at all — a stored adversarial row served to a non-adversarial request would still need the label rendered. Rejected: out of scope of issue #120, which is labeling fidelity, not mode preservation.

## Consequences

### Positive

- A stored adversarial row served via verified-fallback renders the adversarial label, consistent with freshly generated ones (issue #120's acceptance).
- The defect outlives the generation response — the next consumer (the play flow, per ADR-0022) reads it from the store instead of chasing the response.
- The defect gains a real persistence home: ADR-0022 kept it contract-only, so `persistVerifiedExercise` never wrote it to `exercises` — it lived only in the generation contract. This decision adds the column and the write together, so the contract's defect is no longer lost after the generation response.

### Negative

- One migration on `exercises`.
- Pre-existing debug rows carry `NULL` defect and remain unlabeled until regenerated — no backfill in v1 (single-learner, early-stage data; the invariant is guaranteed for all newly generated rows).

### Neutral / Risks

- The defect shape is now stored, so a future shape change needs a migration — the same cost the play flow would have paid anyway.
- The fallback stays mode-agnostic (ADR-0022): an adversarial request may still be served a non-adversarial row, and the card will render it without the adversarial label — correct, because that row is not adversarial.

## Confirmation

- A generated adversarial exercise persists `mode = 'debug'` **and** the declared `defect` — asserted by extending the adversarial persistence test in `exercise-generation.server.test.ts` to assert the stored `defect` column.
- A stored adversarial row served via verified-fallback surfaces its defect — asserted by a fallback test seeding a `mode = 'debug'` row with a defect and asserting the fallback output carries it.
- The generation card renders the adversarial label on the fallback branch when the fallback output carries a defect — asserted by the card component test.
- The migration adds exactly one nullable jsonb column — reviewed in `drizzle/0011_*.sql`.

## Relationships and References

- Refines: [ADR-0022](./0022-adversarial-exercises-debug-mode-generation.md) — reverses only its "contract-only defect metadata" clause; keeps its targeting, gating, and mode-agnostic-fallback decisions intact.
- Related to: [ADR-0017](./0017-stage2-rubric-storage.md), [ADR-0019](./0019-generated-test-source-storage.md) — the column-addition precedent this decision follows; [ADR-0010](./0010-core-v1-persistence-schema.md) — the `exercises` table and `debug` mode discriminator this decision activates the persistence of.
- Supporting evidence: issue #120 (fallback labeling fidelity); [docs/SPEC.md](../SPEC.md) story 34 (verified-exercise fallback); issue #117 (symmetric defect rejection — the generation-time half this decision's read-path mirror completes).
- Owning implementation package: `src/db/schema.ts`, `src/features/exercise/exercise-generation.server.ts`, `src/features/exercise/exercise-generation.schema.ts`, `src/features/exercise/components/exercise-generation-card.tsx`.
