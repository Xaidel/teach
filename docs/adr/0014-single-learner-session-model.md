# ADR-0014: Single-learner session model — query-based resolution, no session layer

- **Date**: 2026-08-11
- **Status**: Accepted
- **Deciders**: Xaidel (sole maintainer)

## Context and Problem Statement

ADR-0001 already fixed the *schema* shape: every learner-scoped table carries a `learner_id`
foreign key into a real `learners` table, seeded with exactly one row for the entire MVP
period. ADR-0013 already fixed *how that row gets there*: `pnpm run db:seed`, a script
separate from `db:migrate`. Neither ADR fixes the *runtime* question — with no auth and no
session concept (`docs/SPEC.md`'s Out of Scope already rules those out for v1), how does
server code actually obtain a `learner_id` value to satisfy that foreign key on every write,
and does anything resembling a "current learner" need threading through requests to get it.

`docs/SPEC.md` names auth/sessions as out of scope but does not say what replaces the
"whose data is this" question that every learner-scoped write still has to answer. This ADR
was resolved as wayfinder ticket [#27](../../issues/27) ("Single-learner session model") on
the [AI Learning Platform v1 map](../../issues/21), and gates build tickets
[#1](../../issues/1) and [#10](../../issues/10), both of which assume a learner identifier is
available without saying where it comes from.

## Decision Drivers

- **ADR-0001's forward-compatibility intent**: the whole point of the multi-user-ready schema
  is that application code is "written against a `learner_id` boundary from day one" so the
  query shape is already correct once a second learner exists. The runtime mechanism chosen
  here must actually honor that intent, not quietly reintroduce a single-user shortcut at the
  code layer that ADR-0001 declined to take at the schema layer.
- **Solo-maintainer operability / no premature complexity**: v1 has no auth and one learner;
  building request-scoped context/middleware machinery ahead of any real per-request identity
  to inject would be exactly the speculative session infrastructure ADR-0001 already deferred.
- **Correctness within a single request**: a request that writes to more than one
  learner-scoped table (e.g. recording an attempt and upserting the Retrieval Queue per
  ADR-0010) must use the same learner id for every write in that request.
- **Fail-fast setup**: ADR-0013's fresh-setup sequence is explicit, ordered steps
  (`db:migrate` → `db:seed` → ...); a runtime fallback that silently papers over a skipped
  step would undermine that.

## Decision

- **Resolution is query-based, not a constant.** A shared helper, `getCurrentLearnerId()`,
  resolves the current learner by querying the `learners` table (`SELECT id FROM learners
  LIMIT 1`) — not a hardcoded or env-configured UUID. This is the seam later replaced with
  real session/auth resolution without changing any call site.
- **No request-scoped context or middleware layer in v1.** Each top-level server function
  calls `getCurrentLearnerId()` once, then passes the resolved `learnerId` down as a plain
  function parameter to everything else it calls within that request. No inner function
  re-derives it by calling the helper itself.
- **Multiple rows are a hard error.** If `learners` ever contains more than one row,
  `getCurrentLearnerId()` throws rather than picking one (e.g. earliest `created_at`). Any
  context that legitimately seeds multiple learners (lower-level schema/query tests per
  ADR-0001's "seeded in test fixtures" allowance) bypasses this helper and passes `learner_id`
  explicitly instead of relying on it.
- **A missing row is a hard error.** If `learners` is empty, `getCurrentLearnerId()` throws
  with a message pointing at `pnpm run db:seed`, rather than lazily creating a row.

This decision governs only the runtime resolution mechanism. It does not add auth, sessions,
or any user-facing identity surface — those remain out of scope per `docs/SPEC.md`.

## Alternatives Considered

### Option A: Hardcoded or env-configured constant learner id

Seed a fixed, known UUID (or read one from an env var) and reference it directly wherever a
`learner_id` is needed, with no query involved.

- Benefits: zero query overhead; trivial to implement.
- Costs and risks: bakes a magic constant into every call site, which then all need editing
  when real auth ships — the opposite of the "code shape already correct" property ADR-0001
  was written to guarantee. Reintroduces, at the code layer, exactly the single-user shortcut
  ADR-0001 explicitly declined to take at the schema layer.

### Option B (chosen): Query-based shared helper, resolved once per request

`getCurrentLearnerId()` queries `learners` for its single row; called once per request, result
threaded down as a plain parameter.

- Benefits: no magic constant — the seed script generates a normal UUIDv7 like any other row;
  the helper's call site is the exact seam swapped for real session lookup later; resolving
  once per request guarantees every write in that request uses the same id, and avoids
  redundant identical queries as more learner-scoped write paths are added.
- Costs and risks: one extra query per request (a single indexed row lookup — negligible);
  requires the discipline of threading `learnerId` as a parameter rather than re-querying,
  which is a convention to hold in code review, not something enforced automatically yet.

### Option A: Request-scoped context/middleware injects `learnerId`

A TanStack Start middleware layer resolves the current learner once per request and makes it
available via request context, rather than an explicit parameter.

- Benefits: call sites don't need `learnerId` threaded explicitly through every function
  signature; would look identical in shape to how a real session-based resolver would inject
  an authenticated user later.
- Costs and risks: is itself a piece of session infrastructure with no real per-request
  identity yet to justify it — the exact premature complexity ADR-0001's drivers warn against
  building ahead of need. Deferred until real auth actually exists to make request-scoped
  identity meaningful.

### Option B (chosen): Direct helper calls, explicit parameter threading

No context/middleware. Each top-level server function calls the helper once and passes
`learnerId` down explicitly.

- Benefits: no infrastructure to build or reason about for a single always-known learner;
  keeps v1's "there is exactly one learner" reality visible in the code rather than hidden
  behind a context abstraction built for a multi-identity world that doesn't exist yet.
- Costs and risks: when real sessions arrive, every server function's signature (not just the
  helper's implementation) will need to change to accept/thread the resolved id — a wider
  surface than swapping out a context provider would have been. Accepted: revisit if/when real
  auth work actually starts, per this ADR's Confirmation.

## Consequences

### Positive

- Build tickets #1 and #10 have a concrete, unambiguous way to obtain `learner_id` instead of
  improvising a constant or an ad hoc query shape independently.
- A single request that writes to multiple learner-scoped tables (attempt + Retrieval Queue
  upsert, per ADR-0010) is guaranteed to use one consistent learner id throughout, since it's
  one resolved value passed as a parameter, not re-derived per call.
- The resolution mechanism (query the `learners` table) matches ADR-0001's forward-compat
  intent literally: the call site (`getCurrentLearnerId()`) doesn't change when real auth
  ships, only what runs inside it.

### Negative

- When real session/auth support is built, every top-level server function's signature needs
  to change to accept a resolved identity instead of calling `getCurrentLearnerId()`
  internally — broader than swapping a single context provider implementation would have been.
- The "resolve once, thread as a parameter" discipline is a code-review convention, not an
  automated check, in v1 — nothing currently prevents a future call site from calling
  `getCurrentLearnerId()` redundantly instead of accepting a passed parameter.

### Neutral / Risks

- The hard-throw behavior on zero or multiple rows means any test or script that seeds more
  than one `learners` row must not exercise code paths that call `getCurrentLearnerId()` —
  it must pass `learner_id` explicitly instead. This constraint isn't enforced automatically.
- This ADR does not address what happens to the seeded learner's historical data once real
  auth ships and that row needs to become a real user account — ADR-0001 already flagged that
  as an open question for a future auth-focused ADR, unchanged here.

## Confirmation

No code implements this yet as of this writing; there is no automated check to point to
today. Once built: code review confirming (a) a single `getCurrentLearnerId()` implementation
exists and is the only code that queries `learners` for "the current learner," (b) every
top-level server function calls it at most once and threads the result as a parameter rather
than each inner function re-calling it, and (c) it throws (not defaults) on zero or multiple
rows. Revisit this ADR's "no context/middleware" decision specifically once real auth/session
work actually begins, per the Negative consequence above.

## Relationships and References

- Related to: [ADR-0001](./0001-single-user-mvp-multi-user-ready-data-model.md) — this ADR's
  runtime resolution mechanism implements ADR-0001's forward-compatibility intent at the code
  layer, the way ADR-0010 implements it at the schema layer.
- Related to: [ADR-0010](./0010-core-v1-persistence-schema.md) — the `learners` table this ADR
  queries, and the `retrieval_queue` synchronous-upsert write path this ADR's single-resolution
  guarantee keeps consistent within one request.
- Related to: [ADR-0013](./0013-local-dev-deploy-environment.md) — the `pnpm run db:seed` step
  this ADR's missing-row error message points a developer back to.
- Supporting evidence: [docs/SPEC.md](../SPEC.md) (Out of Scope: auth/sessions); wayfinder
  ticket [#27](../../issues/27) on map [#21](../../issues/21) (resolution session this ADR
  records).
- Owning implementation package: none yet — no code implements this as of this writing.
