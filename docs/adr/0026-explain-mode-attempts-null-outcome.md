# ADR-0026: Explain-mode attempts write NULL `outcome` (amends ADR-0021)

- **Date**: 2026-08-14
- **Status**: Accepted
- **Deciders**: Xaidel (sole maintainer)

## Context and Problem Statement

ADR-0021's decision item 2 pins `attempts.outcome` as "Stage 1's verdict only" —
`pass` when the sandbox run passed, `fail` otherwise. ADR-0010, however, already
specified that an `explain`-mode attempt stores its score and findings in the
jsonb payload "in place of a pass/fail outcome". Issue #16 (Explanation
Assessment, PR #130) shipped the first explain-mode write path, and to keep the
code faithful to both records it documented explain-mode's NULL outcome by
appending a bolded note to ADR-0021's decision item 2 — an amendment made in
place, after the record had been accepted.

`docs/adr/README.md`'s change procedure forbids silently rewriting an accepted
ADR and prefers a **new** ADR for any change to an accepted decision. The
in-place note was made with that option explicitly on the table (PR #130's
Round 1 finding P2 offered "amend ADR-0010/0021 to bless the derived verdict"),
and it reads as clarification rather than a flip — but it still leaves the
record's provenance ambiguous: a reader of ADR-0021 cannot tell from the record
itself whether the note was part of the original decision or an amendment, or
under what authority.

This record is the reconciliation follow-up #137: it formally splits the
in-place clarification into its own ADR and amends ADR-0021 to point at it.

## Decision Drivers

- **ADR governance (`docs/adr/README.md`)**: accepted decisions change via a
  new ADR, never an in-place rewrite; the old record keeps its original content
  and gains a pointer note.
- **Evidence fidelity (ADR-0010)**: an explain-mode attempt has no Stage 1
  sandbox verdict; recording anything else in `outcome` would blur ADR-0008's
  Stage 1 authority and silently couple evidence reads to a verdict that has no
  deterministic source.
- **ADR-0015's gate honesty**: the Practiced → Demonstrated gate read must
  derive "passed" from the payload's own score, never from a re-purposed
  `outcome` value.

## Decision

We will:

1. **Formally record the explain-mode NULL-outcome rule in its own ADR** (this
   record), splitting the in-place note appended to ADR-0021's decision item 2
   during PR #130.
2. **Explain-mode attempts write NULL into `attempts.outcome`.** They have no
   Stage 1 sandbox verdict: their score and findings live in the
   `attempts.explanation_assessment` jsonb payload "in place of a pass/fail
   outcome" (ADR-0010), and the ADR-0015 gate read re-derives "passed" from
   that payload's `accuracyScore` against the shared threshold
   (`EXPLANATION_ACCURACY_PASS_THRESHOLD`, `src/lib/explanation-accuracy.ts`),
   never from `outcome`. For every non-explain attempt, ADR-0021's item 2
   remains the authority: `outcome` is Stage 1's verdict only.
3. **Revert ADR-0021's in-place note to a pointer.** ADR-0021's decision item 2
   keeps its original content; the bolded explain-mode note is replaced by a
   short pointer directing readers to this record, per `docs/adr/README.md`'s
   change procedure.

## Alternatives Considered

### Option A: Formally accept the in-place clarification

Keep the note inside ADR-0021 and record that the in-place amendment was
deliberate (the option PR #130's Round 1 finding P2 explicitly offered).

- Benefits: no new record; the clarification stays exactly where its readers
  already are.
- Costs and risks: leaves the accepted ADR carrying amendment content whose
  decision history is unrecoverable from the record itself — the precise
  erosion `docs/adr/README.md`'s "never silently rewrite" rule exists to
  prevent; every future reader must trust the note's framing without a
  decision record behind it.

### Option B (chosen): Split into a new ADR that Amends ADR-0021

- Benefits: matches the documented change procedure; the note's authority,
  rationale, and alternatives live in a dated record of its own; ADR-0021
  keeps its original decision content intact with a pointer.
- Costs and risks: one more record to maintain; the rule it formalizes is
  small enough that a reader might have been satisfied with the in-place note
  alone.

## Consequences

### Positive

- ADR-0021's decision item 2 is restored to its original, accepted content,
  with the amendment authority now recoverable from ADR-0026.
- The NULL-outcome rule is searchable and citable on its own (this record is
  what future write paths and gate reads reference).

### Negative

- The `attempts.outcome` column must stay nullable (migration
  `0014_explanation-assessment-payload-outcome-nullable`, PR #130) — a
  permanent NOT NULL on a column that legitimately carries NULL for explain
  mode.

### Neutral / Risks

- This ADR records an already-shipped decision (PR #130); nothing in it is a
  new behavioral change, only governance.

## Confirmation

- `src/features/explanation-assessment/explanation-assessment.server.ts`'s
  `submitExplanationAssessment` writes no `outcome` value for explain-mode
  attempts (the write omits the column).
- `src/features/learners/mastery.server.ts`'s
  `getPassedExplanationAssessmentConceptIds` predicates on
  `(explanation_assessment->>'accuracyScore')::double precision >=
  EXPLANATION_ACCURACY_PASS_THRESHOLD`, never on `outcome`.
- `src/db/schema.ts` declares `attempts.outcome` nullable; migration
  `0014_explanation-assessment-payload-outcome-nullable` applies it.

## Relationships and References

- Amends: [ADR-0021](./0021-attempts-rekey-reconciliation.md) — decision item
  2's outcome semantics, bounded to explain-mode attempts; ADR-0021's core
  (outcome = Stage 1's verdict only) remains authoritative.
- Related to: [ADR-0010](./0010-core-v1-persistence-schema.md) — the
  "in place of a pass/fail outcome" contract this decision makes concrete.
- Related to: [ADR-0015](./0015-explanation-assessment-transfer-test-cadence.md)
  — the gate read this decision keeps honest.
- Supporting evidence: PR #130 (issue #16) — the change that shipped the rule;
  follow-up ticket [#137](../../issues/137) — this record's owning work.
- Owning implementation package: `src/features/explanation-assessment/`,
  `src/features/learners/mastery.server.ts`, `src/db/schema.ts`.
