# ADR-0029: Spaced Retrieval — queue semantics, schedule mechanics, and the Refresher Test

- **Date**: 2026-08-14
- **Status**: Accepted
- **Deciders**: Xaidel (sole maintainer)

## Context and Problem Statement

ADR-0010 fixed the `retrieval_queue` table shape (`learner_id`, `concept_id`, `schedule_stage` 0-4, `due_at`, `priority_score`) and its materialized/synchronous-upsert write-path coupling, and SPEC story 49 fixed the schedule itself (24h → 3d → 7d → 21d → 60d) with adaptive interval lengthening deferred. Neither fixed what the columns *mean* when a write path fires: how the five stages map onto the schedule over time, what a failed retrieval does to the interval, how priority is computed, when a concept enters and leaves the queue, and what the Refresher Test the issue #18 acceptance criteria describe does to mastery (promote to Retained on pass, revert status on fail, preserve history, route to remediation).

This ADR resolves those mechanics as ticket [#18](../../issues/18) on the [AI Learning Platform v1 map](../../issues/21).

## Decision Drivers

- **ADR-0010 fidelity**: the table shape, the synchronous-upsert invariant, and the "no background job in v1" constraint are settled — this ADR realizes them, not reopens them.
- **Fixed-schedule simplicity**: SPEC story 49 defers adaptive scheduling; every interval decision must be computable from the stored columns and the attempt being recorded, with no hidden state.
- **Evidence preservation**: SPEC story 50's "history preserved, mastery estimate lowered, routed to targeted remediation" must hold for a failed Refresher Test — nothing in this mechanism may delete or overwrite `attempts`.
- **Single-learner pragmatism**: v1 has one learner and one maintainer; priority is a stored, inspectable heuristic (ADR-0010's own framing), not a tuned model.
- **Downstream readiness**: ADR-0015's random review-shape selection plugs into the scheduled-review mechanism (tracked as issue #156, blocked on #18); the mechanics here must leave a clean seam for it without implementing it.

## Decision

### Queue membership and the write-path invariant

Every code path that records an attempt or mastery change — `recordAttemptOutcome`, `recordExplanationAssessmentOutcome`, `recordTransferTestOutcome` in `src/features/learners/mastery.server.ts` — upserts the queue for the concepts involved, synchronously, in the same request (ADR-0010's invariant). A row is created on a concept's **first interaction** (any attempt or assessment) at `schedule_stage` 0, due one 24h interval out. The queue therefore surfaces every concept the learner has interacted with; entries below Practiced appear as remediation items alongside retained ones, and the view annotates each entry with the learner's current mastery state so the distinction is visible.

### Schedule mechanics (SPEC story 49)

- **Success** (a full completion — Stage 1 *and* Stage 2 both pass, or a passed Explanation Assessment / Transfer Test): the concept advances **one** stage (capped at stage 4) and is due one interval of the new stage out — `due_at = now + schedule[stage]`, where `schedule = [24h, 3d, 7d, 21d, 60d]`. This is AC 2's "based on last successful retrieval": the stage *is* the record of successive successful retrievals, and a successful retrieval increases the interval (PRD §23.4).
- **Failure** (anything short of a full completion — a Stage-1-only pass counts as a failure, since it is not a successful retrieval): the stage **resets to 0** and the concept is due 24h out — a failed retrieval decreases the interval and schedules targeted remediation (PRD §23.4).
- The first-ever success on a fresh row creates it at stage 0 (the row is created by the first interaction, whatever its outcome); the *second* successful retrieval moves it to stage 1, and so on.

### Priority score

Stored at upsert time as an inspectable value (ADR-0010). The v1 heuristic, computed from the previous row's `due_at`, the concept's 1-5 difficulty, and the outcome being recorded:

```
priority_score = max(0, hoursOverdue) * 2 + difficulty * 10
              + (failedRetrieval ? 1_000_000 : 0)
```

- *recency* — hours the row is already overdue (0 until due), SPEC story 47;
- *importance* — the concept's difficulty as the only v1 proxy (SPEC story 47's "concept importance");
- *performance* — the remediation boost, sized so the recency term would need decades of overdue time to overtake it; a row whose last retrieval failed always sorts above any merely-overdue row, and the view derives its High Priority bucket ("Failed previous review", PRD §23.1) from the stored columns alone — a row is High Priority when its score carries the boost **and** the row is already due (`due_at <= now`); a not-yet-due row with the boost is not surfaced ahead of schedule. No extra read.

Hint dependency is deliberately absent: no scheduling consumer exists yet (ADR-0025 defers it to the same follow-up lane as the recurring-mistakes evidence).

### The Refresher Test

A Refresher Test is an **ordinary verified exercise** on the due concept, solved through the ordinary practice submission flow — no new submission surface, no new entity (ADR-0010's rejection of per-mode tables, same as Explanation Assessment and Transfer Testing). `retrieval_review_exercises` (learner_id, concept_id, exercise_id, unique on learner+concept) is a pointer table, mirroring `transfer_test_exercises`, that lets `recordAttemptOutcome` recognize a review submission and apply its semantics:

- **Start**: the review resolves to the most recently created Pre-Flight-verified exercise targeting the concept (reuse-first — deterministic, no AI cost); if the concept has none verified, it generates one through the existing generation + Pre-Flight pipeline as `guidance: 'independent'` (a retrieval test is solved unaided). A new session overwrites the pointer, so an abandoned review is simply replaced.
- **Pass** (full completion): the reviewed concept is promoted to **Retained** (`advanceMastery`'s rank-guarded upsert — never regresses; a Practiced concept that passes its review reaches Retained directly, since the review is exactly the mechanism by which progress becomes permanent, per ADR-0028's framing). The queue upsert records the successful retrieval.
- **Fail**: the concept's mastery **reverts to Practiced** — atomically, and only when it currently ranks above Practiced (`revertToPracticed`'s guarded update): a merely-Practiced concept is never kicked further down, and a concurrent advance is never clobbered. Prior `attempts` history is untouched (SPEC story 50). Remediation routing is carried by the queue itself: the failure upsert resets the stage to 0 (due 24h out) with the remediation boost, so the concept appears as High Priority ("Failed previous review") with a 24h requeue, and the view's entry carries the remediation marker.

A failed *recurring* review and a failed *initial-gate* attempt (Explanation Assessment / Transfer Test before Demonstrated) are distinguished as ADR-0015 requires: the review-failure mastery revert applies only to review submissions (keyed off `retrieval_review_exercises`), while failed initial-gate attempts leave mastery untouched (existing behavior) and only feed the queue's interval reset.

### Review shape

v1's Refresher Test is always the plain exercise shape. ADR-0015's random selection among {normal exercise, Explanation Assessment, Transfer Test} with the 60-day coverage floor is **not** part of this ticket — it is explicitly owned by follow-up issue #156 ("#18's ACs cover the Retrieval Queue and the plain Refresher Test only"), which plugs into this mechanism's review-selection seam.

## Alternatives Considered

### Option A: Queue rows only for mastered concepts (Practiced+), created on first full completion

- Benefits: the queue never lists concepts the learner hasn't successfully completed; "due for review" reads cleanly.
- Costs and risks: violates the AC's "upserted synchronously whenever an attempt or mastery change is recorded" for failed attempts — a failed attempt is an attempt and would leave the materialized table out of sync with the write path; failed-attempt remediation (PRD §23.4's entire reason for the reset) would have no queue representation at all.

### Option B (chosen): Rows for every interaction, view annotated with mastery

- Benefits: the table mirrors the write path exactly (the AC's invariant), failed-attempt remediation is representable, and the view's mastery annotation makes "remediate me" vs "retain me" legible in one flat read.
- Costs and risks: the queue includes sub-Practiced entries; mitigated by the annotation and by the priority ordering putting failures first.

### Option A: A failed retrieval decreases the stage by one (Retained at stage 4 → 3)

- Benefits: symmetric with success; the stage stays a "retention level".
- Costs and risks: "failed retrieval decreases the interval and schedules targeted remediation" (PRD §23.4) reads as *targeted* remediation — a one-step decrease does not schedule anything imminent, and there is no principled floor short of stage 0. The stage would also conflate "how many times have I succeeded" with "am I failing".

### Option B (chosen): Failure resets to stage 0 (24h)

- Benefits: the shortest interval is exactly the "schedule targeted remediation" behavior; deterministic and inspectable from the stored stage alone.
- Costs and risks: a learner who fails once on a well-retained concept is requeued at 24h rather than a gentler interval — acceptable for v1's fixed-schedule scope, and consistent with PRD §23.4's wording.

### Option A: Priority as a read-time query ordering (no stored formula)

- Benefits: no formula to document or keep consistent.
- Costs and risks: contradicts ADR-0010's chosen Option B ("priority is a stored, inspectable value"); the remediation marker would need a recomputation on every dashboard read.

### Option B (chosen): Stored score from the documented v1 heuristic

- Benefits: matches ADR-0010's materialized framing; the High Priority bucket derives from the stored column alone.
- Costs and risks: the heuristic is a v1 simplification (no hint-dependency or transfer-performance terms); documented as such, with adaptive scheduling already deferred by SPEC.

### Option A: The Refresher Test always generates a fresh exercise per review

- Benefits: "structurally different" reviews by construction; no repeat exercises.
- Costs and risks: an AI generation + Pre-Flight run per review — cost and latency in the ambient review loop; the ADR-0015 shape selection (issue #156) will need its own generation policy anyway.

### Option B (chosen): Reuse the most recent verified exercise for the concept; generate only when none exists

- Benefits: the ambient review loop stays deterministic, free of AI cost, and testable without AI mocks for the common case; generation remains available as the fallback for concepts with no verified exercise.
- Costs and risks: consecutive reviews may reuse the same exercise; acceptable for v1 (the plain exercise shape itself is scheduled for replacement by #156's random selection).

### Option A: A failed Refresher Test reverts mastery by exactly one state (Retained → Demonstrated)

- Benefits: symmetric "lower the estimate" semantics.
- Costs and risks: the *estimate* ADR-0015 asks to lower is "current mastery estimate lowered" — a one-step revert from Retained leaves the concept still Demonstrated, i.e. still claiming gate-earned mastery; "reverts the concept's status" (issue #18 AC 5) and PRD §3.1's "the module status reverts, requiring them to review the lesson and retake the exercise" both read as a real revert to the retryable state.

### Option B (chosen): A failed review reverts to Practiced (from Demonstrated/Retained; guarded not to touch Practiced or below)

- Benefits: a failed review returns the concept to the state where the learner must re-earn it (re-practice, re-pass the gates, re-review); history stays intact; the guarded update makes the floor explicit and race-safe.
- Costs and risks: re-earning Demonstrated requires re-passing both initial gates — a heavier but honest consequence of failing a retention check; recorded as accepted behavior.

## Consequences

### Positive

- The write-path invariant is one visible upsert loop in `recordAttemptOutcome` plus the two assessment entry points — a single place to audit, satisfying ADR-0010's Confirmation ("the `retrieval_queue` upsert call site existing in the attempt/mastery write path").
- The queue view is a flat, indexed `(learner_id, due_at)` read with only per-id PK lookups for annotation — the read cost does not grow with attempt volume (ADR-0010's Option B rationale).
- The review registration seam (`retrieval_review_exercises`) is where issue #156's random shape selection plugs in without changing the queue or the submission pipeline.
- Failed reviews and failed attempts both produce inspectable remediation state (stage 0 + boost), so "why is this top of the queue" is answerable from the stored row.

### Negative

- The queue's correctness still depends on every future write path calling the upsert (ADR-0010's acknowledged coupling) — now one documented loop rather than scattered calls.
- Sub-Practiced concepts appear in the queue; the mastery annotation is the mitigation.
- A review reuse policy that can repeat the same exercise until #156 lands is a known gap (memorization risk), explicitly scoped out.

### Neutral / Risks

- The first success after a failure re-advances from the reset stage 0 — a learner who fails then succeeds is back on the 24h → 3d → 7d ladder, not at a penalized lower stage; the penalty lives in the priority boost, which the success upsert clears.
- The priority formula's exact weights are v1 heuristics; nothing depends on their magnitude except the boost-dominance invariant, which a constant guards.

## Confirmation

- The `retrieval_queue` table exists per ADR-0010's shape (migration `0018_retrieval-queue`), with a check constraint pinning `schedule_stage` to 0-4 and an index on `(learner_id, due_at)`.
- `upsertRetrievalQueue` is called from `recordAttemptOutcome` (per exercise concept, once), `recordExplanationAssessmentOutcome`, and `recordTransferTestOutcome` — the three attempt/mastery write paths.
- The schedule/stage/priority semantics are unit-tested (`src/lib/retrieval-schedule.test.ts`) and the queue behavior integration-tested against real Postgres (`src/features/retrieval/retrieval.server.test.ts`): stage advance on success, reset + boost on failure, High Priority / Due / Upcoming bucketing, Refresher Test start (reuse, generation fallback, not-due rejection), promote-to-Retained on pass, guarded revert-to-Practiced on fail, history preserved.

## Relationships and References

- **Refines** [ADR-0010](./0010-core-v1-persistence-schema.md) — realizes the `retrieval_queue` shape and its synchronous-upsert invariant; adds `retrieval_review_exercises` as the review pointer (same pattern ADR-0010 chose for `transfer_test_exercises`).
- **Related to** [ADR-0014](./0014-single-learner-session-model.md) — the upsert runs inside the attempt/mastery write paths of the request that already resolved the learner once.
- **Related to** [ADR-0015](./0015-explanation-assessment-transfer-test-cadence.md) — its failed-recurring-review behavior is implemented here (revert + remediation); its random shape selection stays with issue #156.
- **Related to** [ADR-0025](./0025-recurring-mistakes-evidence-query.md) — hint-dependency priority term deferred to the same lane.
- **Related to** [ADR-0028](./0028-class-synchronization-sprint-grants-practiced.md) — the Refresher Test is the mechanism that makes sprint-granted (provisional) Practiced progress permanent.
- **Supporting evidence**: [docs/SPEC.md](../SPEC.md) (stories 47-50, 41, 9-10); [docs/INITIAL_PRD.md](../INITIAL_PRD.md) §3.1, §23; issue #156 (shape selection).
- **Owning implementation package**: `src/features/retrieval` + `src/features/learners/retrieval-queue.server.ts` + `src/lib/retrieval-schedule.ts`.
