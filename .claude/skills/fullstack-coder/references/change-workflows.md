# Change workflows — lanes for existing fullstack apps

The existing-app branch of the fullstack standard. Load this when the
entry flow identifies a TanStack Start app that is already running:
pick the change lane, then run the lane's workflow. The binding
contract, decision points, and verification gauntlet live in SKILL.md;
framework depth in `fullstack-app.md`; failing-check lore in
`pitfalls-and-verification.md`.

## Lane triage — one question before editing

What kind of session is this?

| Session | Lane |
| --- | --- |
| A business capability the app doesn't have yet, or grows significantly | New feature |
| A fix, refactor, or small change to existing behavior | Maintenance |
| Auth, persistence, public contracts, migrations, deployment, or security boundaries added or changed | Significant addition |

Then run the **significance check** — the spec-flow rule
(`fullstack-app.md` → Specification flow): significant work starts
with master PRD → focused PRD → owning technical design →
implementation → acceptance evidence before any code; routine fixes
and isolated refactors use ordinary issue/review flow when they
preserve current contracts.

**Done when:** the lane is named, and the significance check routed
the work to the spec flow or to the lane's steps below.

## New feature — add a capability

The feature slice carries the business logic; the route adapts it to
the URL.

1. **Significance check** — a major feature that changes public
   contracts starts with the spec flow (lane triage).
2. **Mirror the app's own patterns** — the entry flow confirmed the
   repo's conventions; the new slice matches the existing feature
   slices' shape (schema / functions / server split, folder layout,
   naming) before any new convention is invented.
3. **Build the feature slice first** — `src/features/<feature>/`:
   client-safe schema (Zod), server-function wrappers, server-only
   operations, pages and components only as the routes need them
   (source-ownership contract). Feature-first respects dependency
   direction: routes import features, never the reverse.
4. **Add the thin route** — a file route under `src/routes`
   importing the feature page; the loader calls the feature server
   function; search/param validation, guards, fallbacks, metadata
   (decision points). Extracted pages use `getRouteApi()`, never the
   route's `Route` object.
5. **Wire the write path** — POST server function with `.validator`,
   pending state in the UI, `router.invalidate()` when the current
   page shows affected loader data.
6. **Match tests to the change** — co-located unit/component tests
   in the feature (`// @vitest-environment jsdom` for component
   tests), route integration under `tests/routes`; targeted
   `test:unit` and `test:routes` before the full gate.
7. **Run the verification gauntlet** — SKILL.md's sequence end to
   end; `test:e2e` when UI behavior changed; `docker build` when
   deployment output changed.

**Done when:** the completion checklist passes scoped to this change
— the feature has a clear owner, the route is thin, the dependency
graph holds, inputs are validated, the UI is on tokens, tests match
the risk, and all gates are green.

## Maintenance — change existing behavior

Scope first, fix in the smallest slice, verify targeted then full.

1. **Significance check** — a fix that changes the contract
   surface — schemas, routes, public API shape — is significant
   work: take the Significant addition lane instead.
2. **Scope the blast radius** — the owning feature (or `src/lib`
   for glue), the routes importing it, the tests covering it. The
   change touches what the task needs and nothing more — no
   drive-by restructuring.
3. **Fix in the smallest slice** — the owning feature's modules, the
   thinnest route change, the narrowest server-function edit that
   achieves the behavior.
4. **Verify targeted then full** — `test:unit` and `test:routes`
   around the touched area, then the full verification gauntlet;
   `test:e2e` when UI behavior changed; `docker build` when
   deployment output changed. A check failing for no obvious reason:
   `pitfalls-and-verification.md`.
5. **Confirm contracts held** — schemas, routes, and behavior are
   unchanged except where the task intended them; the diff shows
   only the scoped change.

**Done when:** the gates verify the fix — or the failing gate and
its blocker are reported precisely — the diff is scoped to the task,
and current contracts are preserved.

## Significant addition — cross-cutting infrastructure

Auth, persistence, public contracts, migrations, deployment, and
security boundaries in a running app. The spec flow decides the
design; `fullstack-app.md`'s owning sections carry the depth.

1. **Spec flow first** — the lane triage's significance check
   applies in full: the design is approved before code, and
   implementation follows it.
2. **Implement per the owning sections** — `fullstack-app.md` →
   Auth and persistence extensions, Sessions and authorization,
   Middleware types, UX states, build, and deploy. Cross-cutting
   pieces land in `src/lib` with `.server.ts`/`.client.ts` suffixes
   per the source-ownership contract.
3. **Build the business features the addition enables** — follow the
   New feature lane once the infrastructure exists.
4. **Run the verification gauntlet** — `test:e2e` when UI behavior
   changed; `docker build` when deployment output changed.
5. **Record the decisions** — durable reusable decisions in
   `arch_docs/adr/`, application decisions in `docs/adr/`
   (`fullstack-app.md` → Specification flow).

**Done when:** the spec flow authorized the work, the implementation
matches the approved design, decisions are recorded in the ADRs, and
all gates are green.