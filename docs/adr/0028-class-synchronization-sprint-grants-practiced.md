# ADR-0028: Class Synchronization — a passed Class B sprint grants at most Practiced

- **Date**: 2026-08-14
- **Status**: Accepted
- **Deciders**: Xaidel (sole maintainer)

## Context and Problem Statement

Issues #13 (Class B: Tactical Flow) and #14 (Class A: Structured Curriculum) built the two
tracks as separate features: a Tactical Sprint banked a 5-10 minute, Pre-Flight-verified
`sprintScoped` exercise for the learner's weakest identified concept, and the Class A
curriculum gated step-by-step progression on Practiced-or-better prerequisite mastery.
Issue #15 (Class Synchronization) asks how the two tracks couple: a passed Class B sprint
must grant provisional ("Practiced") progress toward the matching Class A concept, but
never mark it Demonstrated or Retained outright (SPEC story 8-9, ADR-0002's "third
mechanism"). SPEC story 9's Refresher Test that would promote Practiced to permanent is a
separate capability (the Retrieval Queue / spaced-refresher work, issues #18+); #15's scope
is only the synchronization grant itself.

The tension: Class A's no-skip-ahead gate exists precisely so a learner can't reach a
concept's Practiced state out of curriculum order. Class Synchronization deliberately
punctures that gate — a sprint on a concept whose prerequisites aren't mastered is
*expected* (SPEC story 8: a passed sprint accelerates the curriculum, it doesn't wait for
it). Issue #13/#14 already threaded this as the `sprintScoped` exemption at generation and
submission (ADR-0010's `exercises.sprint_scoped` column). The remaining decision is what the
**Learner Model** does with a sprint completion: where does the write happen, how far can it
advance, and how does Class A's own Demonstrated-gate interact with a sprint-granted
Practiced state.

## Decision Drivers

- **Learner Model stays the single write owner**: ADR-0010 names `learner_concept_mastery`
  as the current-state record and `recordAttemptOutcome` (`src/features/learners/
  mastery.server.ts`) as the intent-level entry point exercise completion reports into
  (arch_docs/dependency-rules.md's Feature Dependencies exception). A sync mechanic that
  wrote mastery from the `tactical-sprint` feature would create a second writer.
- **The sync must never exceed Practiced on its own**: SPEC story 9 is explicit that Class B
  progress stays provisional until a Refresher Test; Demonstrated/Retained are Class A's own
  evidence-driven states (ADR-0015's dual gate), not things a sprint can claim.
- **Class A's own progression must keep working on top**: a concept Practiced via a sprint is
  still a real Practiced concept for Class A's gate — the EA + Transfer Test promote path
  (`promoteToDemonstrated`) must not care how Practiced was reached.
- **No new state in the shared pipeline**: the sync is a *grant floor*, not a distinct
  "provisional" state column — an extra `is_provisional` flag or a separate sync table would
  need reconciliation everywhere the Learner Model is read, for a distinction only the
  (still unbudgeted) Refresher Test would consume.

## Decision

- A passed Class B sprint grants the matched concept **at most Practiced**, recorded by the
  **existing Learner Model write path**: the `sprintScoped` exercise is an ordinary
  `exercises` row joined to its concept, so its submission flows through `submitExercise` →
  `recordAttemptOutcome` exactly like any other exercise (issue #13's AC 5), which advances
  the concept to `practiced` on a full Stage 1 + Stage 2 pass. No new code in
  `tactical-sprint` writes mastery; the sprint needs no special call site.
- `advanceMastery`'s atomic rank-guarded upsert (never regress) is the entire enforcement of
  "at least, if not already higher": a concept already at or past Practiced stays put, and a
  sprint completion can never demote it.
- Nothing in the synchronization path ever calls `promoteToDemonstrated` or writes to
  `transferTestExercises`/`explanation_assessment` evidence: the ceiling is structural.
  Class B completion alone can therefore never produce Demonstrated or Retained.
- Class A's own Demonstrated progression applies on top unchanged: after a sprint-granted
  Practiced state, a passed Explanation Assessment plus passed Transfer Test promote the
  concept to Demonstrated the same as if Class A itself had Practiced it (`mastery.server.ts`'s
  `recordExplanationAssessmentOutcome`/`recordTransferTestOutcome` read state, not origin).

## Alternatives Considered

### Option A: Sprint-specific mastery write in `tactical-sprint`

`runTacticalSprint` (or a new sync helper it calls) directly upserts the matched concept to
`practiced` at sprint completion, inside the tactical-sprint feature.

- Benefits: the sync is visible in the Class B feature's own code; the grant doesn't depend
  on the exercise flowing through the generic submission path.
- Costs and risks: creates a second `learner_concept_mastery` writer outside the Learner
  Model's documented intent-level entry point, splitting the "one write owner" invariant
  (ADR-0010, the dependency-rules exception); would write before the actual submission even
  happens unless it fires on submission rather than generation; races the generic
  `recordAttemptOutcome` write for the same `(learner_id, concept_id)` row.

### Option B: Sync writes a separate "provisional Practiced" marker

The sprint completion sets a distinct flag/column (e.g. `exercises.sprint_scoped` already
exists, but a `learner_concept_mastery.sync_granted` or a review-state distinction) so the
UI can label sprint-granted progress as provisional separately from Class-A-granted progress.

- Benefits: the "provisional" semantic is explicit in data, matching SPEC story 9's wording.
- Costs and risks: the only consumer of that distinction would be the Refresher Test
  (issues #18+), which is not built; every read of mastery state would have to maintain and
  present the flag; it reopens the concept-level vs. lesson-level mastery model ADR-0010
  chose, for a distinction the current UI and gate never query.

### Option C (chosen): Reuse the shared Learner Model write path

Described in full under Decision above.

- Benefits: zero new write code; the grant sets Practiced with the same bar and atomic
  never-regress semantics as every other exercise; the structural ceiling (nothing calls the
  Demonstrated gate) is provable by reading `recordAttemptOutcome`'s call sites; Class A's
  gate is methodless origin-agnostic and "just works" on a sprint-granted Practiced state.
- Costs and risks: the sync is implicit — a reader of `tactical-sprint` alone sees no
  mastery write; the elegance depends on the generic pipeline and on future features
  remembering that `sprintScoped` submissions reach `recordAttemptOutcome` like all others.
  Mitigated by the explicit AC tests in `tactical-sprint.server.test.ts` locking the three
  #15 behaviors at the sprint seam.

## Consequences

### Positive

- The sync grant, the at-most-Practiced ceiling, and the still-working Class A gate are now
  each covered by an explicit test at the sprint seam (`tactical-sprint.server.test.ts`,
  issue #15 AC 1-3), so the mechanism can't silently drift.
- No schema change and no second mastery writer: ADR-0010's current-state table and the
  dependency-rules exception stay untouched.
- `recordAttemptOutcome` remains the single place exercise completion drives mastery,
  keeping the Feature Dependencies acyclic.

### Negative

- The coupling is implicit: a contributor reading only `tactical-sprint.server.ts` will not
  see the sync. It is documented here and in `runTacticalSprint`'s comment, but the
  enforcement lives in the generic submission path.
- A sprint-granted Practiced is indistinguishable in data from a Class-A-granted one until
  the (future) spaced-refresher work decides how "provisional" should be represented.

### Neutral / Risks

- If a future feature ever wants to label sprint-granted progress distinctly (the Refresher
  Test, issues #18+), it will need its own representation decision — this ADR only declines
  to build it now for the unbudgeted consumer.
- Risk of accidental promotion creep: any future change to `recordAttemptOutcome` that adds a
  `promoteToDemonstrated` call for ordinary completions would also grant it to sprint
  completions. The AC 2 test (never beyond Practiced) is the guard.

## Confirmation

- `tactical-sprint.server.test.ts`'s issue-#15 tests: (1) a passed Class B sprint grants the
  matched concept Practiced (AC 1); (2) a sprint completion after an already-Practiced
  concept leaves it exactly Practiced — never Demonstrated/Retained (AC 2); (3) a
  sprint-granted Practiced concept still promotes to Demonstrated once a passed Explanation
  Assessment and passed Transfer Test are recorded (AC 3).
- The no-new-writer invariant is reviewed in `tactical-sprint.server.ts`: it imports
  `getMasteryStates` read-only from `learners` and never writes `learner_concept_mastery`
  itself.

## Relationships and References

- Related to: [ADR-0002](./0002-both-tracks-in-v1.md) — this implements the
  "Class B pass → provisional Class A progress" half of the synchronization mechanic
  ADR-0002 names as v1's differentiating coupling.
- Related to: [ADR-0010](./0010-core-v1-persistence-schema.md) — the `learner_concept_mastery`
  current-state table and the `sprint_scoped` column this decision reuses.
- Related to: [ADR-0015](./0015-explanation-assessment-transfer-test-cadence.md) — the
  Practiced → Demonstrated gate that remains how a sprint-granted Practiced concept moves on.
- Related to: [ADR-0021](./0021-attempts-rekey-reconciliation.md), [ADR-0027](./0027-transfer-test-exercises-passed-column.md) —
  the attempt/mastery pipeline `recordAttemptOutcome` is built on.
- Supporting evidence: [docs/SPEC.md](../SPEC.md) stories 8-9; issue #15's acceptance
  criteria 1-3; [docs/INITIAL_PRD.md](../INITIAL_PRD.md) §3.0 "Concept Mastery Index" /
  §10 "Tactical Learning → Structured Curriculum".
- Owning implementation package: `src/features/tactical-sprint`, `src/features/learners/mastery.server.ts`.