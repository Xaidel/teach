# ADR-0002: Class A and Class B ship together in v1

- **Date**: 2026-08-10
- **Status**: Accepted
- **Deciders**: Xaidel (sole maintainer)

## Context and Problem Statement

The product is a dual-track learning platform: Class A (Structured Path) is a sequential, Concept-Graph-driven curriculum; Class B (Tactical Sprint) turns a pasted AI-generated snippet the learner doesn't understand into a targeted 5-to-10-minute exercise. A third mechanism, Class Synchronization & Spaced Refresher, couples the two: a passed Class B sprint grants provisional ("Practiced") progress toward the matching Class A concept, which only becomes permanent once the learner passes a scheduled Refresher Test.

`docs/INITIAL_PRD.md`'s Functional Summary Matrix already marks "Dual-Class Track: Class A + Class B" as **Approved** product scope — whether both tracks exist in the product at all is a product-scope decision already settled by the PRD, not open here. What was open is a **build-sequencing** question: does v1's architecture need to support both tracks and their synchronization from the start, or can Class B be built and validated alone first, with the Concept Graph, curriculum authoring, and Class Synchronization/Spaced Refresher engine (PRD Section 3.1) added in a later phase?

Class B alone is a materially smaller system to build first: it doesn't need the Concept Graph's prerequisite structure, curriculum authoring, or the cross-track synchronization logic — just the AI Teacher Engine, sandbox execution, and the two-tier evaluation pipeline, which are also the most technically novel, highest-uncertainty parts of the system.

## Decision Drivers

- **Product scope is fixed by the PRD**: both tracks are already Approved v1 scope; this decision is about what v1's *architecture* must support to deliver that scope, not whether to build both eventually.
- **De-risking the novel core**: the AI Teacher Engine, sandboxed real-compiler execution, and two-tier (compile/test + qualitative rubric) evaluation pipeline are the least-proven parts of the system and would benefit from isolated validation before more is built on top of them.
- **Integration risk of the synchronization mechanic**: Class Synchronization is not additive glue — a Class B pass writes provisional progress directly into Class A's mastery state, and Class A's Refresher Test can revert it. Building the two tracks in separate phases risks a costly integration/rework pass at the point they're joined, rather than exercising that coupling from the start.
- **Test-seam design**: `docs/SPEC.md` already commits to one integration-test seam covering Class A, Class B, the evaluation pipeline, and the Learner Model together, rather than one seam per subsystem — that seam only exists once both tracks exist.
- **What the MVP needs to validate**: per the PRD's own problem statement, the product's differentiation is closing the gap between "solved it once" and "actually retained it" — a claim the Class B-only slice cannot exercise, since retention only becomes real through the Class A ↔ Refresher Test loop.

## Decision

We will build Class A (Structured Curriculum), Class B (Tactical Sprint), and the Class Synchronization/Spaced Refresher engine together as part of v1's initial architecture, not as a Class B vertical slice followed by a second phase.

This means the following are in scope for v1's first release, not deferred:

- the per-language Concept Graph (prerequisites, related concepts, difficulty) that Class A's curriculum sequencing depends on;
- curriculum authoring (lesson, guided exercise, independent exercise, transfer test per curriculum step);
- the Class Synchronization mechanic (Class B pass → provisional Class A progress) and the Spaced Refresher Test that converts provisional progress to permanent, including the revert-on-failure behavior.

This decision governs v1's build scope only. It does not reopen the PRD's product-scope approval of the Dual-Class Track, and it does not mandate a specific delivery order for the individual pieces within that combined scope.

## Alternatives Considered

### Option A: Class B alone first, as a vertical slice

Build only the Tactical Sprint track — AI Teacher Engine, sandbox execution, two-tier evaluation — first, to prove out the riskiest technical core before adding curriculum sequencing. Add the Concept Graph, curriculum authoring, and Class Synchronization/Spaced Refresher engine in a later phase.

- Benefits: smaller initial build; isolates and validates the most technically novel, highest-uncertainty subsystem (AI-driven exercise generation, pre-flight validation, sandboxed execution, two-tier evaluation) before investing in curriculum-sequencing engineering on top of it; faster path to a first working exercise loop.
- Costs and risks: defers the Concept Graph, curriculum authoring, and Class Synchronization/Spaced Refresher engine to a second phase, meaning the platform's stated core differentiation — provisional progress that only becomes permanent via a passed Refresher Test — isn't built or validated until that second phase. Conflicts with the PRD's Functional Summary Matrix, which already scopes Dual-Class Track as Approved v1, not a phase-two addition. Defers the riskiest integration point (Class B writing into Class A's mastery state) rather than retiring that risk early, and risks a costly rework pass when the two tracks are eventually joined.

### Option B (chosen): Both tracks together in v1

Build Class A, Class B, and Class Synchronization/Spaced Refresher as one v1 architecture from the start.

- Benefits: builds directly toward the PRD's already-approved v1 scope without a second integration phase to wire Class B into an existing Class A architecture (or vice versa); the Class Synchronization/Spaced Refresher coupling — the platform's central retention mechanic — is exercised and tested from the start rather than retrofitted; matches SPEC.md's stated single integration-test seam across Class A, Class B, evaluation, and the Learner Model.
- Costs and risks: v1's surface area is larger before any part of it is validated with real use. The higher-risk, more-novel AI Teacher/Sandbox/Evaluation core does not get an isolated, standalone validation pass before the Concept Graph and curriculum-sequencing machinery is layered on top of it — if that core needs significant rework, the rework happens after curriculum infrastructure has already been built on top of it, not before.

## Consequences

### Positive

- The Class Synchronization/Spaced Refresher mechanic — where the PRD locates the product's actual differentiation — is part of v1 from the start, not a deferred phase-two integration.
- No second integration phase is needed to retrofit Class B's output into Class A's mastery state; the coupling is designed in from the first migration/build, consistent with [ADR-0001](./0001-single-user-mvp-multi-user-ready-data-model.md)'s schema-first approach to learner-scoped state.
- Matches the single integration-test seam SPEC.md already commits to (Class A + Class B + evaluation + Learner Model in one seam), avoiding a second, separately-designed test seam for a later Class A phase.

### Negative

- The AI Teacher Engine, sandbox execution, and two-tier evaluation pipeline — the least-proven parts of the system — do not get an isolated validation pass before the Concept Graph and curriculum-sequencing machinery is built on top of them. If that core needs significant rework once real use starts, the rework now has curriculum infrastructure built on top of it.
- v1's build scope is larger before any of it has been exercised by a real learner, compared to a phased approach that would have produced a working (if narrower) product sooner.

### Neutral / Risks

- This decision fixes *what* is in v1's architecture, not the order in which the pieces get built within that scope — a phased internal build order (e.g. core loop first, curriculum authoring second) remains possible without violating this decision, as long as both tracks and their synchronization ship together in the v1 release.
- If the AI Teacher/Sandbox/Evaluation core turns out to need substantial redesign once exercised end-to-end, that redesign now has more surrounding architecture (Concept Graph, curriculum authoring) to account for than Option A would have produced. This is the accepted trade-off, not a hidden one.

## Confirmation

- No code implements this yet as of this writing; there is no automated check to point to today.
- Once built, confirmation is the integration-test seam SPEC.md already commits to: the backend integration suite (real Postgres, real Docker sandbox, evaluation pipeline, AI Teacher client swapped for a deterministic test double) must exercise Class A, Class B, and the Class Synchronization/Spaced Refresher mechanic together — not as separate suites — before v1 is considered complete.
- Release/PR review: a v1 release checklist item confirming Concept Graph, curriculum authoring, and Class Synchronization/Spaced Refresher are present and tested, not deferred.

## Relationships and References

- Related to: [ADR-0003](./0003-multi-language-from-v1.md) — both ADRs fix v1 build-scope breadth (track breadth here, language breadth there) against the same PRD-approved scope.
- Related to: [ADR-0001](./0001-single-user-mvp-multi-user-ready-data-model.md) — the Class Synchronization mechanic writes into the same learner-scoped Learner Model tables ADR-0001 governs.
- Supporting evidence: [docs/INITIAL_PRD.md](../INITIAL_PRD.md) Section 3.1 (Dual-Track Learning System) and Section 6 (Functional Summary Matrix — Dual-Class Track: Approved); [docs/SPEC.md](../SPEC.md) (primary integration-test seam).
- Owning implementation package: none yet — no code implements this as of this writing.
