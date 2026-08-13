# Dependency Rules

Production imports form a directed acyclic graph.

| Importer                                | Allowed application imports                                          |
| --------------------------------------- | -------------------------------------------------------------------- |
| `src/routes`                            | client-safe feature APIs, feature pages, shared UI, `src/lib`        |
| `src/routes` (handlers-only routes)     | additionally: server-only feature modules (`*.server.ts`) and auth   |
| `src/features/<feature>/pages`          | same feature, shared UI/hooks/types, `src/lib`                       |
| `src/features/<feature>/components`     | same feature client-safe modules, shared UI/hooks/types, `src/lib`   |
| `src/features/<feature>/*.functions.ts` | same feature schemas and server-only operations                      |
| `src/features/<feature>/*.server.ts`    | same feature, server-only `src/lib`, private infrastructure packages, a narrow named entry point from another feature's `*.server.ts` (Feature Dependencies exception below) |
| `src/shared/*`                          | other shared code and `src/lib` only                                 |
| `src/db`                                | server-only `src/lib` modules                                       |
| `src/lib`                               | other focused `src/lib` modules only                                 |
| `scripts/`                              | client-safe or server-only `src` modules, `src/lib`                  |
| `src/router.tsx` and `src/start.ts`     | generated routes and `src/lib` framework glue                        |

Deployment tooling under `scripts/` may import application `src` modules — the seed
script validates the committed documents against the feature zod schema, for example.
Application modules never import `scripts/`.

**Handlers-only routes** — a route file that declares only `server.handlers` and no
component (public APIs, webhooks, streams: `api.auth.*`, `/plans/$planId/stream`) is
compiled server-side only and never enters the client bundle. It may import
server-only feature modules and the auth feature directly; it still delegates business
semantics to the owning feature (thin-route posture) and keeps internal authorization.

## Environment Rules

- Browser-reachable code must not import `*.server.ts`, Node-only modules, private SDKs,
  secret environment access, or `@tanstack/react-start/server`.
- Server function wrappers may be imported by routes and browser UI because Start
  transforms their implementation into RPC stubs.
- Static server-function imports are required. Dynamic server-function imports obscure
  the transform boundary and are unsupported by this contract.
- A client-safe barrel must not re-export a server-only value.

## Feature Dependencies

Avoid feature-to-feature imports. When a real capability dependency exists, expose a
narrow client-safe public module from the owning feature, document the direction, and
keep the graph acyclic. Move a contract to `shared` only when it has no single feature
owner.

A `*.server.ts` module may instead import a **named, narrow entry point** from another
feature's `*.server.ts` — not the whole module, not internal helpers — when: the
dependency is genuinely one-way (the owning feature never imports back), the graph stays
acyclic, and the import is documented with a comment at the call site naming this
exception and the direction. Both sides of the import are already server-only, so this
carries no client-bundling risk (unlike importing a browser-reachable module); the bar
exists to keep the coupling deliberate and reviewable rather than silent. Example:
`src/features/exercise/exercise.server.ts` importing
`recordAttemptOutcome` from `src/features/learners/mastery.server.ts` — exercise
completion is the one place attempt outcomes drive Learner Model mastery, and `learners`
exposes that as a single intent-level function rather than exercise reaching into
mastery's low-level primitives.

## Enforcement

TanStack Start import protection and production builds enforce runtime-sensitive
boundaries. TypeScript, ESLint, and source-boundary tests detect part of the wider import
graph; review enforces the remaining ownership rules. Fix the import graph rather than
weakening Start import protection.