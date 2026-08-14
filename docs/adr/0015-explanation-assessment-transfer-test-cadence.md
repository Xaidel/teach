# ADR-0015: Explanation Assessment / Transfer Test cadence — dual promotion gate and randomized recurring review shape

- **Date**: 2026-08-11
- **Status**: Accepted
- **Deciders**: Xaidel (sole maintainer)

## Context and Problem Statement

`docs/SPEC.md` user stories 44 and 46 say Explanation Assessment and Transfer Testing happen
"periodically" without defining the trigger. User story 41 fixes the five mastery states
(Unknown → Introduced → Practiced → Demonstrated → Retained) but not what causes each
transition. Story 49 already fixes a *separate* mechanism — the spaced-retrieval schedule
(24h → 3d → 7d → 21d → 60d) — for retention review, without saying whether Explanation
Assessment and Transfer Testing are part of that schedule or something else entirely.

The two pre-existing build tickets that depend on this were already pulling in different
directions. Ticket [#17](../../issues/17) (Transfer Testing) commits its result to
"contribute toward Demonstrated state" — implying a gate a learner passes *on the way to*
Demonstrated. This ticket's own drafted example text ("triggered at specific mastery-state
transitions, e.g. on reaching Demonstrated, before Retained") implied the opposite — a gate
standing *after* Demonstrated, before Retained. Both can't be literally true for the same
single occurrence; this ADR resolves which (or whether both, at different points) is correct.

This ADR was resolved as wayfinder ticket [#28](../../issues/28) ("Explanation Assessment /
Transfer Test cadence") on the [AI Learning Platform v1 map](../../issues/21), and gates build
tickets [#16](../../issues/16) (Explanation Assessment) and
[#17](../../issues/17) (Transfer Testing), neither of which currently specifies when it fires.

## Decision Drivers

- **Story 46's own stated purpose**: transfer testing exists "so that passing one exercise
  pattern isn't mistaken for conceptual mastery" — this is a definition of what separates
  Practiced from real mastery, which points at the Practiced→Demonstrated boundary specifically,
  not a later checkpoint on an already-Demonstrated concept.
- **Story 45's own stated purpose**: explanation is scored "so that 'explained it' is itself a
  scored signal" — same shape of reasoning as above, about what counts as mastery in the first
  place.
- **Anti-gaming**: a learner should not be able to predict which review will ask them to
  explain or transfer a concept and selectively prepare only for that occasion — the whole
  point of story 46 is catching mastery that doesn't actually generalize.
- **Coverage**: story 42 requires the Learner Model to track explanation accuracy and transfer
  performance per concept; a mechanism that could statistically skip a concept entirely
  undermines that requirement.
- **Single-purpose spaced-retrieval schedule**: story 49 already fixes the 24h/3d/7d/21d/60d
  schedule as the retention mechanism; overloading its cadence with an unrelated, separately
  invented EA/TT frequency was avoided in favor of reusing it as a review-shape source instead.
- **Solo-maintainer scope discipline**: retry/remediation mechanics for a failed initial gate
  attempt are left to build tickets #16/#17 (the same deferral pattern ticket
  [#23](../../issues/23) used for the explanation-accuracy scoring formula), rather than
  designed here past what "cadence" requires.

## Decision

- **Trigger type is mastery-state transitions**, not a fixed schedule of its own and not a
  simple "every Nth exercise" counter.
- **Initial gate (Practiced → Demonstrated)**: both Explanation Assessment and Transfer Test
  are required, independently and in no fixed order, before a concept is promoted from
  Practiced to Demonstrated. A concept becomes eligible as soon as it reaches Practiced (its
  first passed exercise) — no additional exercise-count threshold gates eligibility.
- **Recurrence after Demonstrated**: Explanation Assessment and Transfer Test are not
  one-time-only. They can also recur as the *shape* of a scheduled spaced-retrieval review
  (the existing fixed 24h/3d/7d/21d/60d schedule, story 49) — alongside plain re-exercises.
  This is what resolves the tension in the Context: EA/TT is both the promotion gate to
  Demonstrated (ticket #17's existing framing) and a recurring review shape on the way through
  Retained (this ticket's own example text) — not either/or.
- **Shape selection per scheduled review is random, not deterministic.** Each time a review
  comes due, the platform randomly selects among {normal exercise, Explanation Assessment,
  Transfer Test} rather than mapping shape to schedule stage deterministically. This is
  deliberate: a fixed stage→shape mapping would let a learner memorize "the 7-day review is
  always the transfer test" and selectively prepare, defeating the anti-gaming purpose above.
- **Coverage floor**: if a concept reaches its final scheduled review (the 60-day stage) having
  never randomly drawn an Explanation Assessment or Transfer Test shape, the platform forces
  one in on that final review. This guarantees every concept eventually produces at least one
  explanation-accuracy and one transfer-performance data point (story 42) without making any
  of the earlier reviews predictable.
- **Explanation Assessment and Transfer Test share one cadence mechanism** (same initial gate,
  same random-recurrence model) but are **independent draws** — passing or drawing one implies
  nothing about the other. Both are still separately required at the initial gate; each
  scheduled review independently rolls its own shape.
- **Failure handling**: a failed *recurring* (post-Demonstrated) EA/TT review reuses story 50's
  existing behavior as-is — prior history preserved, current mastery estimate lowered, learner
  routed to targeted remediation. A failed *initial-gate* attempt (pre-Demonstrated) simply
  leaves the concept at Practiced with a retry available; the exact retry/remediation flow is
  left to build tickets #16 and #17 when picked up, not designed by this ADR.

This decision governs only *when* and *how often* Explanation Assessment and Transfer Test
fire. It does not change what either assessment evaluates (owned by ticket
[#23](../../issues/23)'s AI Teacher Engine interface contract) or the exact scoring formula for
explanation accuracy (explicitly left to ticket #16).

## Alternatives Considered

### Option A: Tied directly to the spaced-retrieval schedule, deterministic stage mapping

Every review at a fixed schedule stage is always the same shape (e.g. 7d review is always a
Transfer Test, 21d is always an Explanation Assessment), with no separate initial gate — a
concept reaches Demonstrated through ordinary exercises alone.

- Benefits: simplest to implement and test — no randomness, no separate gate mechanism, one
  schedule handles everything.
- Costs and risks: contradicts ticket #17's existing "contributes toward Demonstrated state"
  commitment outright, which this ADR chose not to overrule without cause; a fixed stage→shape
  mapping is fully memorizable, directly undermining story 46's anti-gaming purpose; ties EA/TT
  frequency to the schedule's five fixed stages regardless of how many exercises a learner
  actually does on a concept.

### Option B: Every Nth completed exercise on a concept

Explanation Assessment and/or Transfer Test fire automatically after every N regular exercises
completed on a concept, independent of mastery state or the retrieval schedule.

- Benefits: simple counter, easy to reason about and implement.
- Costs and risks: no natural tie to what Demonstrated is supposed to mean; a learner could
  reach N exercises without yet showing any sign of real understanding, or take far longer than
  N to reach genuine mastery on a harder concept, making the count arbitrary rather than
  meaningful. Doesn't address story 42's coverage requirement any better than random selection
  does, without random selection's anti-gaming benefit.

### Option C (chosen): Dual mechanism — mandatory initial gate at Practiced→Demonstrated, random recurring review shape thereafter

Described in full under Decision above.

- Benefits: honors both existing signals (ticket #17's Demonstrated-gate framing and this
  ticket's post-Demonstrated example) instead of picking one and contradicting the other;
  randomized shape selection directly serves the anti-gaming driver; the coverage floor
  satisfies story 42 without sacrificing unpredictability on every other review; reuses story
  49's existing schedule and story 50's existing failure-handling behavior rather than
  inventing parallel mechanisms.
- Costs and risks: two distinct trigger mechanisms (one mandatory gate, one probabilistic
  recurrence) is more surface to implement and test than a single unified rule; random
  selection requires a seedable RNG in the review-generation code path so tests can pin
  outcomes deterministically, and requires explicit floor logic to avoid relying on chance
  alone for coverage.

## Consequences

### Positive

- Build tickets #16 and #17 have a concrete trigger to implement instead of improvising one
  independently, and their acceptance criteria can now state exactly when each fires.
- The contradiction between ticket #17's acceptance criteria and this ticket's own example
  text is resolved without weakening either — both hold true, at different points in a
  concept's lifecycle.
- Every concept is guaranteed at least one explanation-accuracy and one transfer-performance
  signal in the Learner Model (story 42) by the time it exits the spaced-retrieval schedule,
  regardless of how the random draws land.
- A learner cannot memorize which scheduled review will ask them to explain or transfer a
  concept, preserving story 46's anti-gaming intent for the life of that concept, not just at
  first promotion.

### Negative

- Two separate trigger mechanisms (mandatory gate + probabilistic recurrence) must both be
  built and tested, rather than one simpler unified rule.
- The review-generation code path needs a seedable random source and explicit floor-tracking
  state (has this concept ever drawn an EA or TT shape?) that a purely deterministic design
  would not have required.
- The exact retry/remediation flow for a failed initial-gate attempt is left undecided here —
  build tickets #16 and #17 must still resolve it before implementation is complete. Resolved
  for Explanation Assessment by the [Addendum](#addendum-2026-08-14-explanation-assessment-initial-gate-remediation-path)
  below; Transfer Test's initial-gate failures needed no parallel resolution (see the addendum's
  Scope note).

### Neutral / Risks

- The 60-day floor forces a shape on that specific review regardless of the random draw,
  meaning the *final* scheduled review is technically predictable in a way the others aren't
  (a learner could infer "if I haven't been asked to explain or transfer this yet, the last
  review guarantees it"). Accepted: this only affects a learner tracking that state across many
  concepts and reviews, and only for the last review in a concept's schedule — a narrower gap
  than a fully deterministic mapping.
- This ADR does not decide what happens to a concept's schedule after the 60-day review
  completes (whether reviews continue indefinitely at that cadence or stop) — that gap predates
  this ADR and is not created or resolved by it.

## Confirmation

No code implements this yet as of this writing; there is no automated check to point to today.
Once built: code/test review confirming (a) a concept cannot reach Demonstrated without a
passed Explanation Assessment and a passed Transfer Test recorded against it, (b) the scheduled
review-generation path draws its shape from a seedable random source (not a fixed stage
mapping), (c) a concept's final scheduled review forces an EA or TT shape if neither has fired
for it yet, and (d) a failed recurring EA/TT review triggers the same history-preserved,
mastery-lowered, remediation-routed behavior as any other failed retrieval review (story 50).

## Addendum (2026-08-14): Explanation Assessment initial-gate remediation path

**Status**: Accepted. Resolves the gap the Negative consequence above left open, for
Explanation Assessment's half of it.

### Context

Ticket [#16](../../issues/16) shipped (PR #130) with the simplest possible floor for a failed
initial-gate Explanation Assessment attempt: the concept stays at Practiced, retry is
immediately available with no limit, and every attempt is recorded as evidence. Whether that
floor is itself "the remediation path" this ADR deferred, or whether something more active needed
to be built, was left open — filed as follow-up [#132](../../issues/132) and resolved via
wayfinder ticket [#157](../../issues/157) using `/grilling`.

### Decision

#132 ships remediation infrastructure on top of the existing floor — the floor alone was judged
insufficient; something active is added, but it stays optional and non-blocking:

- **Trigger**: every failed attempt, no streak or threshold. **Visibility**: only on a failed
  attempt — a pass never shows it, even with minor findings.
- **Gating**: optional, non-blocking. Retry stays immediately available; remediation is a
  pointer, not a gate — nothing about it forces the learner to act before retrying.
- **Content**: no new AI call, no new generation pipeline, no new persisted state. The
  destination is the existing curriculum step page (`generateCurriculumLesson`, cached per
  ADR-0025's sibling ticket #135).
  - **Baseline** (unconditional on any failure): the assessed concept's own curriculum page —
    this is what covers `incorrect` findings, which name no other concept.
  - **Per-finding resolution**: each `missing`/`conflated` finding additionally contributes the
    concept(s) it names, when the finding's freeform string normalizes (trim + lowercase) to a
    slug already in `{assessed concept, prerequisiteSlugs, relatedSlugs}` — the same graph
    vocabulary already loaded for the `analyzeMisconceptions` call, so no prompt or schema
    change to that AI contract (issue #23's boundary stays intact). `relatedSlugs` are included
    even though a related (non-prerequisite) concept's own curriculum page can still be locked
    for the learner — the locked page itself renders informatively (which prerequisite is
    blocking it) rather than erroring. Findings that don't resolve to a known slug still render
    as plain text (unchanged behavior) — resolution only ever adds a pointer, never removes
    information.
- **Presentation**: one deduplicated "Concepts to review" section below the findings list (not
  inline per-finding), links opening in a new tab so an in-progress retry draft isn't lost.
- **Architecture**: resolution lives server-side in `submitExplanationAssessment`, reusing the
  `ConceptGraphDefinition` it already builds for the AI call — no extra graph load. Returned as
  a new `remediationConcepts: string[]` field on `ExplanationAssessmentResult`, derived at
  request time from data already captured on the attempt row (mirrors the "recurring mistakes"
  read-time-aggregation pattern, ADR-0025) — no new DB column or table.
- **Scope**: Explanation Assessment only. Transfer Test's initial-gate failures are ordinary
  failed exercise attempts and already get the existing hint-ladder remediation through the
  normal exercise flow (issue #17) — no parallel gap there, so no companion ticket was needed.
- **Explicitly rejected** (considered during grilling, ticket #157): any streak/threshold gating
  on when remediation appears, forced (blocking) remediation that would delay a retry, and
  persisted remediation-engagement tracking. All three would have added state or friction this
  ADR's own initial-gate framing (unlimited immediate retry, non-blocking) does not call for.

### Consequences

- The Negative consequence's gap above is closed for Explanation Assessment: #132 defines and
  ships the "something more" a failed initial-gate attempt gets beyond bare retry.
- No new AI contract surface, no new persistence, and no change to the accuracy formula
  (ticket #16) or the `analyzeMisconceptions` schema (issue #23) — the remediation list is a
  pure read-time derivation from data those already produce.
- Transfer Test's initial-gate remediation gap (ticket #17's half of the original deferral) is
  confirmed closed by inspection rather than by a parallel build — normal exercise attempts
  already have hint-ladder remediation, so nothing else was owed there.

### Confirmation

Code/test review confirming: `submitExplanationAssessment` returns a non-empty
`remediationConcepts` containing the assessed concept's slug on every failed attempt and an
empty array on every passed attempt; a `missing`/`conflated` finding whose string resolves
(normalized) against the assessed concept's prerequisites or related concepts contributes its
real slug; a non-resolving finding contributes nothing and still renders as plain text; results
are deduplicated; `ExplanationAssessmentCard` renders "Concepts to review" only when
`!result.passed && result.remediationConcepts.length > 0`, with links opening in a new tab.

## Relationships and References

- Related to: [ADR-0010](./0010-core-v1-persistence-schema.md) — the `retrieval_queue` table's
  `schedule_stage` this ADR's review cadence rides on, and the `exercises.mode` enum this ADR's
  shape selection assigns at generation time.
- Related to: [ADR-0014](./0014-single-learner-session-model.md) — no direct dependency, but
  both are wayfinder resolutions on the same map narrowing `docs/SPEC.md`'s remaining gaps.
- Related to: [ADR-0025](./0025-recurring-mistakes-evidence-query.md) — the addendum's
  `remediationConcepts` derivation reuses its read-time-aggregation pattern (no new storage).
- Supporting evidence: [docs/SPEC.md](../SPEC.md) user stories 41, 42, 44, 45, 46, 49, 50;
  wayfinder ticket [#28](../../issues/28) on map [#21](../../issues/21) (resolution session
  this ADR records); build tickets [#16](../../issues/16) and [#17](../../issues/17) (gated by
  this decision). Addendum: wayfinder ticket [#157](../../issues/157) and build ticket
  [#132](../../issues/132).
- Owning implementation package: none yet for the core cadence decision — no code implements
  that as of this writing. The addendum's remediation path is owned by
  `src/features/explanation-assessment/explanation-assessment.server.ts` and
  `src/features/explanation-assessment/components/explanation-assessment-card.tsx` (issue #132).
