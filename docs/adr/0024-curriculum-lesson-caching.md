# ADR-0024: Curriculum lesson caching — persist generated lessons keyed by generation inputs

- **Date**: 2026-08-14
- **Status**: Accepted
- **Deciders**: Xaidel (sole maintainer)

## Context and Problem Statement

Each Class A curriculum step's lesson (SPEC story 2) is generated on demand by the AI
Teacher Engine via `explainConcept`, phrased at the learner's explanation depth and
optional reference frame (issue #12). The lesson is presentation-only content — it has no
deterministic evaluation role, so issue #14 shipped it regenerated-from-scratch on every
request. Issue #135's problem: a learner revisiting an already-generated step pays a fresh
AI generation call (and its cost and latency) each time, for content that is identical
given the same generation inputs. The decision question: where (if anywhere) is a generated
lesson cached, and how does that cache stay correct?

Settled product scope that this ADR does not touch: the lesson is still generated only on
explicit user action (never auto-generated), and `explainConcept` still picks the content
at the learner's current settings (issue #12).

## Decision Drivers

- **Revisit cost is the whole point**: the cache must make a repeat visit — same learner,
  same concept, same explanation settings — free of an AI call.
- **Correctness of presentation**: the lesson text depends on the learner's explanation
  depth and reference frame (issue #12); a lesson cached under one setting must never be
  served to a request at a different setting.
- **Never poison on failure**: a failed `explainConcept` call must not be cached as a
  lesson, or every retry would surface the failure text instead of retrying generation.
- **Schema-first persistence (ADR-0007, ADR-0010)**: the platform persists learner-facing
  state in Postgres; a session-scoped in-memory cache would vanish on restart and duplicate
  the durability the data model already provides.

## Decision

Persist each successfully generated lesson in a `curriculum_lessons` table in Postgres
(ADR-0007/0010), keyed by the complete set of generation inputs: `(learner_id,
concept_id, explanation_depth, reference_frame)`. The cache is read-through: on a request,
the row matching the learner's *current* preferences is served if it exists; otherwise the
lesson is generated, and only a successful generation is inserted.

- The key includes the generation inputs, so a change in explanation depth or reference
  frame naturally misses the cache and regenerates at the new settings — the old row
  remains and serves again if the learner switches back. No TTL is needed: the content is
  deterministic given the inputs, and input change is the only staleness that matters.
- `reference_frame` is nullable; the uniqueness key coalesces it to a non-null sentinel so
  two rows without a frame cannot collide.
- Only successful generations are persisted. A failed call surfaces the existing stable
  `LESSON_GENERATION_FAILED` error and leaves any previous cached lesson untouched (the
  request never reaches the insert on failure).
- Duplicate rows cannot accumulate: the unique key (with the coalesced frame) admits at
  most one row per input tuple.

## Alternatives Considered

### Option A: per-session in-memory cache

The step view's React state holds the generated lesson for the current page visit.

- Benefits: zero schema change, trivially simple.
- Costs and risks: the cache is lost on navigation away and on server restart — the
  expensive revisits (returning to a step on a later day) still pay full generation.
  Contradicts ADR-0007/0010's durable-persistence shape for learner-facing state, and
  nothing in the AI call's cost profile justifies treating the lesson as ephemeral.

### Option B (chosen): durable Postgres rows keyed by generation inputs

- Benefits: survives restarts; correct by construction (the key is exactly what the text
  depends on); one small table following the schema-first data model; failure never
  poisons it.
- Costs and risks: a cached lesson is stale across a model/`explainConcept` prompt
  migration (a redeploy would serve old text until a setting change forces regeneration) —
  accepted because lessons are presentation-only with no evaluation role, and this risk
  applies equally to any cache that outlives a request.

### Option C: TTL-based cache

Rows expire after a fixed window regardless of settings.

- Benefits: bounds staleness after prompt/model changes automatically.
- Costs and risks: reintroduces AI calls for content that did not actually change, and the
  TTL is arbitrary — the only real invalidation trigger (settings change) is already
  captured by the key in Option B. Added complexity for no correctness benefit.

## Consequences

### Positive

- A revisiting learner is served the cached lesson with no AI call — the exact cost and
  latency win issue #135 asks for.
- Correctness is structural: the cache key *is* the generation input tuple, so serving the
  wrong settings is impossible by construction.
- Schema-first and durable per ADR-0007/0010; testable against Postgres like the rest of
  the data model.

### Negative

- A lesson persisted before a model or `explainConcept` prompt change stays cached until
  the learner's settings change or the row is cleared — accepted for presentation-only
  content; a future content-versioning scheme would make this explicit (see Risks).

### Neutral / Risks

- A learner with the same settings across two different lesson-request surfaces shares one
  cache row per concept — intended, but worth noting if lesson presentation ever varies by
  something outside the key (e.g. a future learner persona not stored on `learners`).
- No content versioning: the key captures settings, not the prompt/model that produced the
  text. If `explainConcept`'s output contract ever needs versioning, add a prompt/model
  version to the key (and to the ADR).

## Confirmation

- `src/features/curriculum/curriculum.server.test.ts`: a revisit serves the cached lesson
  with no second `explainConcept` call; a depth change regenerates (two calls); a
  reference-frame change takes the `eq(referenceFrame, …)` lookup branch; and the failed
  call test asserts both the stable `LESSON_GENERATION_FAILED` error and that no cache row
  was written — a failed call never persists a lesson.
- Migration `drizzle/0014_*.sql` creates `curriculum_lessons` with the coalesced unique
  key, reviewed as part of the PR.

## Relationships and References

- Related to: [ADR-0007](./0007-postgres-storage.md) (Postgres for all persistent
  storage), [ADR-0010](./0010-core-v1-persistence-schema.md) (schema-first learner data),
  [ADR-0014](./0014-single-learner-session-model.md) (learner-scoped state).
- Supporting evidence: issue [#135](https://github.com/Xaidel/teach/issues/135) (follow-up
  from PR #124's Round 1 review note on lesson non-persistence).
- Owning implementation package: `src/features/curriculum` (`curriculum.server.ts`,
  `src/db/schema.ts`, `drizzle/0014_nebulous_proteus.sql`).
