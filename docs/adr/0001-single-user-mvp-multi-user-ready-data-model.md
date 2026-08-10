# ADR-0001: Single-user MVP on a multi-user-ready data model

- **Date**: 2026-08-10
- **Status**: Accepted
- **Deciders**: Xaidel (sole maintainer)

## Context and Problem Statement

The platform is being built primarily for the author's own use as a solo learner, but the product is intended to eventually serve other learners with the same problem. v1 has no authentication, no billing, and no per-tenant isolation — there is exactly one learner and no concept of a session or account.

At the same time, v1 already produces data that is inherently learner-specific: attempt history, hint usage, mastery/progress state (the Learner Model), and Retrieval Queue entries. If that data is modeled without any notion of "whose data this is," introducing a second learner later requires a schema migration that retrofits an ownership column onto tables that, by then, hold real historical data — coupling a risky backfill migration to the same release that introduces auth.

The decision question: should the v1 schema model learner ownership from the first migration even though v1 has only one learner and no auth, or should that modeling be deferred until multi-user support is actually built?

## Decision Drivers

- **Migration risk and reversibility**: retrofitting an ownership column onto already-populated tables (attempts, hint history, mastery state, retrieval queue) is materially riskier than establishing it before any data exists.
- **Delivery cost for a confirmed single-user MVP**: auth, session handling, tenant-isolation enforcement, and billing have no confirmed user or requirement yet beyond the author; building them now would be speculative.
- **Stated product intent**: the platform is explicitly intended to serve other learners eventually (not a hypothetical) — this is a known future requirement, not a guess.
- **Minimizing premature complexity**: avoid building infrastructure (auth, tenant isolation) that has no current consumer, while still avoiding decisions that are expensive to reverse.

## Decision

We will build the v1 schema as single-tenant in **access** (no auth, no billing, no per-tenant isolation) but multi-tenant-ready in **data model**: every table holding learner-produced or learner-specific state carries a `learner_id` foreign key to a `learners` table from its first migration. The `learners` table is real and exists from v1 — it is seeded with exactly one row for the entire MVP period.

This scoping applies to: attempt history, hint usage/hint history, mastery/progress state (Learner Model), and Retrieval Queue entries.

Shared, non-learner-owned entities — the Concept Graph (concepts, prerequisites, relations) — must **not** carry a `learner_id`. They remain global across all learners regardless of how many exist.

Auth, session handling, tenant-isolation enforcement at the query/API layer, and billing remain fully out of scope for v1 and are not addressed by this decision — only the schema shape is decided here.

## Alternatives Considered

### Option A: Single-user schema, retrofit multi-tenancy later

Model v1 tables with no learner ownership concept at all. Add a `learner_id` (or equivalent) only when real multi-user support is built.

- Benefits: fastest to build for v1; no unused columns or joins while there is exactly one learner; no design work spent on a requirement that isn't being exercised yet.
- Costs and risks: requires a backfill migration across every learner-scoped table (attempts, hint history, mastery state, retrieval queue) at the same time auth is introduced, coupling two risky changes into one release. This is the exact schema-rewrite scenario the product's stated multi-learner intent (see Context) makes likely, not hypothetical.

### Option B: Full multi-user from v1 (real auth, tenant isolation, billing scaffolding)

Build identity, sessions, per-request tenant-isolation enforcement, and billing plumbing alongside the core product from the start.

- Benefits: no future migration of any kind; exercises multi-tenant code paths from day one; produces a "real" product architecture immediately.
- Costs and risks: meaningfully more delivery cost (identity provider integration, session handling, enforced tenant isolation, billing) for a system whose only user for the foreseeable future is the author. Risks over-engineering against unconfirmed multi-user usage patterns before the core learning product (AI Teacher, sandbox, evaluation loop) is even validated, and delays that validation behind infrastructure not yet needed.

### Option C (chosen): Single-user MVP, multi-user-ready data model

Skip auth, billing, and tenant isolation entirely for v1, but give every learner-scoped table a real `learner_id` foreign key from its first migration, backed by an actual (single-row) `learners` table.

- Benefits: avoids the one piece of Option A that is expensive to reverse (schema-level ownership on populated tables) while avoiding all of Option B's access-layer delivery cost. Adding real multi-user support later is additive — new auth/session tables and enforcement logic — rather than a migration of already-populated data.
- Costs and risks: pays a small, permanent per-query tax (every learner-scoped query joins/filters through `learner_id`) even though, for the entire MVP period, `learners` holds exactly one row. Does not reduce the real future cost of building auth, session handling, and tenant-isolation enforcement — it only avoids the data-migration slice of that future work.

## Consequences

### Positive

- Attempt history, hint usage, mastery state, and Retrieval Queue data never need a backfill migration when real auth ships — a second learner is just new rows against the same schema.
- Application code is written against a `learner_id` boundary from day one, so the query shape is already correct once a second learner exists, rather than needing to be retrofitted alongside auth.
- Multiple learners can be seeded in test fixtures or local dev without any further schema change, if that becomes useful before auth exists.

### Negative

- Every learner-scoped query carries a join/filter on `learner_id` for the entire MVP period even though exactly one row in `learners` will ever match — real, if small, overhead with no functional payoff until a second learner exists.
- Nothing in v1 enforces the `learner_id` boundary at an API or session layer, because there is no session concept yet. Code that queries by the seeded learner's ID directly (instead of resolving it properly) would work correctly today purely because there is nothing else to find — a latent correctness gap that stays invisible until a second learner exists to expose it.
- This decision does not reduce the cost of the future auth, session-handling, and tenant-isolation work itself — only the data-migration portion of introducing it.

### Neutral / Risks

- No migration plan yet exists for attaching the current seeded learner's historical data to a real user account once auth ships. That is an open question for a future auth-focused ADR, not resolved here.
- The Concept Graph and other shared entities must stay outside this scoping pattern. Applying `learner_id` to genuinely shared data would be an over-correction this decision does not call for.

## Confirmation

- Schema/migration review: any new migration that introduces a table for learner-produced or learner-specific state must add a `learner_id` foreign key to `learners` before merge. A migration that omits it must state in its description why the table is shared rather than learner-scoped.
- No automated architecture check enforces this yet — v1 has no schema linter or dependency test for it. Confirmation is manual review until that automation is judged worth building.

## Relationships and References

- Related to: [ADR-0007](./0007-postgres-storage.md) — the Learner Model tables this ADR scopes by `learner_id` are the same tables ADR-0007 places in Postgres.
- Supporting evidence: [docs/SPEC.md](../SPEC.md) ("Multi-user readiness" and "Out of scope" sections cite this decision as already governing architecture).
- Owning implementation package: none yet — the schema has not been implemented in code as of this writing. Link the migrations directory here once it exists.
