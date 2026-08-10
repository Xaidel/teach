---
name: fullstack-coder
description: Use when coding, scaffolding, or reviewing TypeScript, React, or TanStack Start work — the org's fullstack standard (feature-based architecture, file routes, server functions, strict typing, semantic tokens), React 19 UI craft, framework-agnostic TS conventions, and the verification gauntlet. Fully standalone; no template repo or other skills required.
version: 1.1.0
author: gyud-internal
license: Apache-2.0
---

# Fullstack Coder

One self-contained reference for TypeScript, React, and TanStack Start
fullstack work. The org's fullstack standard: feature-based vertical
slices, thin file-route modules, typed server functions, strict
TypeScript, and semantic-token UI. The skill is fully standalone — no
template repos, no base language skills, no external material
required. Every fact it needs is in this package; the template repo
`tpl-fsfba-ts` and the generic TS/React skill cluster are optional
sources, never requirements.

## Entry flow — detect the repo shape, then load the minimum

Identify the shape before acting. One identification, then load only
the branch's references:

1. **New app?** Follow *Greenfield* below; the app you create is a
   fullstack app (branch 2).
2. **TanStack Start app** — `src/routes/` file routes plus
   `createServerFn`/`createFileRoute`, anything in the tpl-fsfba-ts
   family or scaffolded from it. This is the default fullstack shape;
   apply the binding contract in this SKILL.md and load
   `references/fullstack-app.md` for framework depth. In an
   existing app, load `references/change-workflows.md` and pick
   the change lane before editing.
3. **React frontend without a server** — Vite + React Router, no
   TanStack. Load `references/react-app.md`; apply the React/UI craft
   in `references/react-and-ui.md`.
4. **Framework-agnostic TypeScript** — libraries, CLIs, scripts,
   backend services without React. Load `references/typescript.md`.

**Done when:** the shape is identified, the matching references are
loaded, and — for an existing repo — its own conventions were checked
first: package manager, bundler, routes directory, validation
library, styling system, test commands. The repo's `AGENTS.md` wins
over this skill when they disagree.

## Greenfield — scaffold from the reference template

Create the new app from the `tpl-fsfba-ts` GitHub template, then
replace the example while keeping the app green:

1. Create the repo from the template; clone and install:
   `corepack enable && pnpm install --frozen-lockfile`.
2. Rename the package and visible application metadata (title, head
   meta, favicon, README).
3. Replace the Notes reference feature one vertical slice at a time —
   route → feature slice → server boundary — keeping
   `pnpm run verify` green after each slice. Once the replacement
   behavior is accepted, remove the unused template traces: Notes
   routes and `src/features/notes`, UI primitives no surviving
   feature uses, and Docker only when a different supported runtime
   is the deployment decision.
4. Replace `docs/specs/` with the new product contract: master PRD
   (vision) → focused normative PRD → owning technical design for
   significant work.
5. Keep `arch_docs/` as the reusable architecture; record
   application-specific decisions in `docs/adr/`.
6. Add deliberately, never as template defaults: a runtime-validated
   `src/lib/env.server.ts` before reading secrets; authentication
   only with a documented session/provider and authorization model;
   persistence only with migrations, transactions, and release
   sequencing; query caching only when route loaders and
   invalidation cannot express the cache requirements.
7. Final sweep: search for `Notes`, `Folio`, `tpl-fsfba-ts`, and
   `mvp` — remove stale example branding, requirements, environment
   names, and browser assertions; replace `.env.example` when the
   app gains runtime configuration.
8. Run the full gates: `pnpm run verify`, `pnpm run test:e2e`, and
   `docker build .` when deployment output changed.

**Done when:** package and metadata renamed, the Notes feature is
replaced by a real feature slice with its traces removed, specs and
ADRs reflect the new product, the final name sweep is clean, and all
three gates pass.

## The binding contract (fullstack apps)

### Source ownership

| Location | Owns | Must not own |
| --- | --- | --- |
| `src/routes` | File-route declarations, paths, loaders, search/param validation, guards, metadata, SSR options, route fallbacks, routing layouts, `server.handlers` | Feature UI, database access, secrets, business rules |
| `src/features/<feature>` | Feature pages, components, hooks, schemas, server functions, server-only operations, feature tests | URL registration, route-tree generation, another feature's internals |
| `src/shared/components` | Proven cross-feature rendered UI with no feature knowledge | Business behavior, loaders, server-only imports |
| `src/shared/hooks`, `src/shared/types` | Cross-feature React behavior / client-safe contracts with no single feature owner | Feature rules, route declarations, server-only types |
| `src/lib` | Focused app utilities and cross-cutting infrastructure glue | Feature components, feature rules, catch-all `utils.ts` collections |

Create folders only when code needs them. Keep code feature-local
until cross-feature reuse is real; a feature is a business capability
that may serve several routes.

### Dependency direction

```text
routes -> features -> shared/lib
entrypoints -> routes/lib
shared/lib -> never features/routes
```

- Avoid feature-to-feature imports; when a real dependency exists,
  expose a narrow client-safe API from the owning feature and keep
  the graph acyclic.
- Unsuffixed modules are client-safe. `*.server.ts` may import
  databases, private SDKs, filesystem, and secrets; components,
  hooks, loaders, and client-safe barrels never import it directly,
  and a client-safe barrel never re-exports a server-only value.

### TanStack Start boundaries

- `getRouter()` returns a fresh router instance; `src/routes/__root.tsx`
  renders the document shell with `<HeadContent />` and `<Scripts />`.
- `tanstackStart()` precedes the React Vite plugin; the template
  order is `tailwindcss(), tanstackStart(), viteReact(), nitro()`.
- Loaders are isomorphic — they run during SSR and client
  navigation, so they call client-safe server functions instead of
  databases, secrets, filesystem, or private SDKs.
- Use validated `createServerFn` wrappers for app-internal server
  work; use route `server.handlers` for public APIs, webhooks, and
  exact `Request`/`Response` semantics. Keep server-function imports
  static.
- GET for idempotent reads, POST for mutations and forms. Validate
  every untrusted input with a Zod schema at the server boundary.
- Private server functions and server routes authorize internally;
  route guards are navigation UX, never the only security boundary.
- `src/start.ts` retains server-function CSRF protection.

### TypeScript and React

- Strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.
- Never `any` in maintained source; narrow `unknown`. Prefer `type`
  over `interface` except framework declaration merging. Annotate
  public function/component params and returns; TSDoc exported APIs.
- Infer types from runtime schemas at I/O boundaries. Named exports,
  type-only imports.
- Extracted feature pages use `getRouteApi()` — never import a
  route's `Route` object (circular dependency).
- Semantic HTML, visible focus, correct labels, accessible status
  messages, reduced-motion fallbacks; semantic tokens only, never
  raw palette colors.
- Do not hand-edit `src/routeTree.gen.ts`; dev/build tooling
  regenerates it.

### Testing

- Co-locate feature unit and component tests with their feature;
  route integration and source-boundary tests live under
  `tests/routes` — never under `src/routes`.
- Component tests opt into jsdom with a
  `// @vitest-environment jsdom` header and
  `import '@testing-library/jest-dom/vitest'`.
- Cover happy paths, meaningful failures, and edge conditions; unit
  tests isolate external I/O. Browser tests exercise the built app
  through the public UI and fail visibly when prerequisites are
  absent. An in-process route test is not browser E2E. Targeted
  runs: `pnpm run test:unit` (src) and `pnpm run test:routes`
  (tests/routes) before the full `test`.

### Anti-patterns (the positive targets)

- **Thin routes**: paths and route lifecycle behavior live in route
  files; forms, state, schemas, and business rules live in their
  feature slice.
- **Server-only work behind suffixes**: `*.server.ts` plus Start
  import protection is the runtime boundary — folder names like
  `server/` protect nothing.
- **One capability per feature**: a feature may back several routes;
  a route may compose several features.
- **Promote to shared only on real reuse**; speculative shared code
  stays feature-local.
- **Focused utilities**: `env.server.ts`, `logger.ts`, `cn.ts` —
  never a catch-all `services/` or `utils.ts` dumping ground.
  TanStack's own docs propose a `utils/` folder for feature-file
  modules — the anti-pattern is accumulation, not the folder name.
- **Loaders call server functions**; infrastructure never enters a
  loader directly.
- **No premature platform defaults**: databases, auth providers,
  analytics, query caches, and cloud adapters enter only through an
  approved application requirement and design.

## Decision points

| Need | Use | Avoid |
| --- | --- | --- |
| Page URL with UI | Route module importing the feature page | Feature UI in `src/routes` |
| Route-coupled data | Route `loader` calling a feature server function | DB/secrets in loaders |
| Extracted page needs route data/params/search | `getRouteApi()` with the route ID | Importing the route `Route` object |
| Typed search params | `.validateSearch()` with a schema | Manual URL parsing |
| Reusable feature-agnostic UI | `src/shared/components` after real reuse | Premature promotion |
| Reusable boilerplate/glue | `src/lib` app utility | A catch-all `src/services` layer |
| App-internal server work | `createServerFn` | Public API semantics |
| External/raw endpoint | Route `server.handlers` returning `Response` | Forcing external callers through server functions |
| Mutation from UI | POST server function + validation + pending state | GET mutations, trusting client validation |
| Refresh route data after mutation | `router.invalidate()` | Stale loader cache assumptions |
| Private data | Server functions/routes authorize internally | Route `beforeLoad` alone |
| Cross-cutting request context | `createMiddleware` (+ `src/start.ts` when global) | Duplicating auth/logging in every route |

## Verification gauntlet

- Full gate: `pnpm run verify` (format:check → lint → typecheck →
  test → build). Run `pnpm run test:e2e` for browser acceptance and
  `docker build .` when deployment output changes; the image runs as
  the non-root `node` user and exposes `GET /api/health` for
  liveness.
- Sequence for a working session: edit → `pnpm exec prettier
  --write` on touched files → `format:check` → `lint` → `typecheck`
  → `test` → `build`. Prettier reflows JSX and shifts lint line
  numbers; format before lint.
- Visual checks drive the project's installed Playwright chromium
  with a throwaway script run from the repo root; capture console
  errors and `pageerror`s, assert zero. Probe interaction state with
  DOM assertions, not screenshots; reserve vision for layout
  questions. See `references/pitfalls-and-verification.md`.
- Restart the dev server fresh before each visual verification — a
  long check run SIGTERMs it silently. Wait for `ready in`; on
  `Port 3000 is already in use`, reuse the surviving instance.
- The pnpm `Unsupported engine` warning on host Node 24 vs the
  template's `>=22.13 <23` is benign noise; ignore it.

**Done when:** all gates are green — or the failing gate and its
blocker are reported precisely, never silently skipped.

## Completion checklist

- [ ] Every business capability has a clear feature owner under
      `src/features`.
- [ ] Routes keep paths/loaders/guards/options; feature pages import
      via `getRouteApi()`.
- [ ] Imports follow the directed graph; no client code depends on
      `*.server.ts` or `@tanstack/react-start/server`.
- [ ] All untrusted inputs and environment values are runtime
      validated; private data is authorized at the server boundary.
- [ ] UI uses the shared `ui/` primitives and semantic tokens; new
      visual values extend the token set, not raw colors.
- [ ] Tests match the changed risk; verification commands pass.
- [ ] New shared abstractions show real cross-feature reuse.
- [ ] Significant work is authorized by current product and
      technical contracts (PRD → technical design → implementation →
      acceptance evidence).

## Reference files

Load these as needed — do not pre-load all of them:

- **[fullstack-app.md](references/fullstack-app.md)** — the
  fullstack branch in depth: architecture and ownership details,
  skeleton and entries, routing/loaders, server functions and
  boundaries, forms/auth/middleware, UX/build/deploy. Load when
  working in a TanStack Start app, before adding routes, server
  work, auth, or deployment config.
- **[change-workflows.md](references/change-workflows.md)** — the
  existing-app branch's lanes: new feature, maintenance, and
  significant addition, each with steps and completion criteria.
  Load in an existing TanStack Start app before editing.
- **[pitfalls-and-verification.md](references/pitfalls-and-verification.md)** —
  verified template pitfalls (search-param typing, lint strictness,
  tool quirks), throwaway prototype routes, and the browser
  verification loop. Load when a check fails for no obvious reason,
  before visual verification, or when building prototype routes.
- **[react-and-ui.md](references/react-and-ui.md)** — React 19
  patterns, component conventions, semantic-token styling,
  accessibility, visual states. Load for UI work in either React
  branch.
- **[react-app.md](references/react-app.md)** — the non-fullstack
  React branch: atomic design, React Router v7, pnpm tooling, design
  token pipeline. Load only when the repo is a plain React
  frontend.
- **[typescript.md](references/typescript.md)** — strict TypeScript
  conventions, Zod at boundaries, tsconfig and lint shape, tooling
  matrix. Load for framework-agnostic TS work and as the baseline
  for both React branches.