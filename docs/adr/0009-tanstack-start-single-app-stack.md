# ADR-0009: TanStack Start (React), single deployable app — no separate Node backend

- **Date**: 2026-08-10
- **Status**: Accepted
- **Deciders**: Xaidel (sole maintainer)

## Context and Problem Statement

[ADR-0006](./0006-typescript-nextjs-stack.md) chose "TypeScript end-to-end: Next.js frontend with a Node backend orchestrating the Docker sandboxes." That reasoning — one shared language across dashboard, API, and orchestration layer, since the sandboxed languages (Rust/Go/Python, ADR-0003) run in isolated containers regardless of what the platform itself is written in — still holds and isn't reopened here.

What's changed is that this repository is actually scaffolded from a TanStack Start application template, not a blank slate: `arch_docs/architecture.md` states "this template organizes a TanStack Start application by business capability," and `arch_docs/adoption.md` documents the concrete adoption checklist (`pnpm run reset:sample`, the bundled Notes sample, `tpl-fsfba-ts` branding to search-and-remove). `arch_docs/dependency-rules.md`, `arch_docs/testing.md`, and `arch_docs/development-workflow.md` all describe TanStack Start-specific mechanics (file routes, `createServerFn` server functions, `*.server.ts` boundary enforcement, Start's import protection, the Vitest/Playwright/CI baseline) that are already built into the repo's tooling.

ADR-0006's stack choice — Next.js frontend plus a separately conceived Node backend — was never implemented (no code exists in this repo as of this writing), but it directly contradicts the template contract the repo is actually built on. The decision question: keep pursuing ADR-0006's Next.js/separate-backend shape, or align the application's stack decision with the template already in place, and account for what that changes architecturally (a single full-stack app, not a frontend calling a separate backend service)?

## Decision Drivers

- **Preference for TanStack Start's structure over Next.js**: file-route and server-function conventions fit how this codebase is meant to be organized better than Next.js's App Router/Server Actions model, without the additional framework surface area Next.js carries that this project doesn't need. This is the primary driver — the points below reinforce it rather than substitute for it.
- **The repo is already scaffolded from a TanStack Start template, not a blank slate**: building on Next.js instead means discarding or reimplementing tooling that already exists (dependency rules, import protection, test layout, Docker non-root multi-stage runtime, CI verification gates), rather than using it.
- **`arch_docs/` explicitly governs applications derived from this template**: its architecture, dependency-rule, and workflow contracts assume TanStack Start's file-route/server-function model; picking a different framework means the application's own ADRs (`docs/adr/`) and the template's ADRs (`arch_docs/adr/`) would describe two different systems.
- **No implementation cost yet to change course**: ADR-0006 was never built against — correcting the framework choice now costs a document change, not a migration.
- **ADR-0006's original rationale (shared TS language, sandboxed languages indifferent to host) is unaffected by which TypeScript framework is chosen**, so it doesn't need to be re-litigated — only the specific framework and backend shape do.

## Decision

We will build the platform as a **single TanStack Start application (React)** — one deployable app, not a Next.js frontend paired with a separately conceived Node backend.

- UI and routing use TanStack Start file routes (`src/routes/`), following `arch_docs/architecture.md`'s default source shape (routes as routing adapters, features owning business-facing UI and behavior).
- The API and Docker-sandbox-orchestration responsibilities ADR-0006 assigned to a "Node backend" are implemented as `createServerFn`-wrapped server functions and server-only feature modules (`*.server.ts`), per `arch_docs/architecture.md`'s runtime flow — not as a separately deployed service.
- Any raw HTTP contract need (webhooks, streaming) uses route `server.handlers`, per `arch_docs/dependency-rules.md`, rather than a bespoke backend endpoint.
- Persistence (ADR-0007), the AI Teacher Engine client (ADR-0004), and sandbox orchestration (ADR-0005) all live behind this server/browser boundary, enforced by TanStack Start's import protection rather than by convention across two codebases.
- v1 sandbox execution is request/response — submit, wait, get back one final result — matching the sandbox's bounded, forcibly-terminated execution model (10s timeout, ADR-0005/PRD Section 5.1), and is handled natively by `createServerFn`. Live-streaming execution output (e.g. real-time compiler/program output while code runs) is a deliberate future capability, not a v1 requirement; see Neutral/Risks for what changes if it's added later.
- To keep this decision cheap to reverse even after code exists, orchestration, persistence, and AI-client logic (ADR-0004, ADR-0005, ADR-0007) should live in plain, framework-agnostic TypeScript modules; `createServerFn` wrappers stay thin and delegate to those modules rather than embedding logic directly. This bounds the cost of any future framework change to the wrapper layer instead of the underlying engine.

This supersedes [ADR-0006](./0006-typescript-nextjs-stack.md) in full: both the frontend framework (Next.js → TanStack Start) and the backend shape (separate Node backend → server functions within the same app) change.

## Alternatives Considered

### Option A: Keep ADR-0006's shape — Next.js frontend, separate Node backend

Continue with a Next.js frontend calling a separately conceived Node/Express-style backend for API and Docker orchestration.

- Benefits: Next.js has a larger ecosystem and community track record than TanStack Start; a genuinely separate backend service can be deployed, scaled, and rolled back independently of the frontend.
- Costs and risks: contradicts the template this repository is actually scaffolded from — every piece of already-built tooling (`arch_docs/dependency-rules.md`'s import boundaries, `arch_docs/testing.md`'s test layout, the Docker non-root multi-stage runtime, TanStack Start's own import protection) would need to be discarded or reimplemented for a framework it wasn't built for. Splits the application's own architecture decisions (`docs/adr/`) from the template's architecture contract (`arch_docs/`), which `arch_docs/adr/README.md` explicitly expects to compose, not diverge.

### Option B (chosen): TanStack Start, single app, server functions replace the separate backend

Build one TanStack Start application; API and orchestration logic live in server functions and server-only modules within it.

- Benefits: uses the template's already-built infrastructure directly instead of rebuilding it — dependency rules, import protection, test layout, CI gates, Docker runtime all apply without adaptation. Removes an entire architectural seam (a separately deployed backend service) that ADR-0006 required, while keeping ADR-0006's actual point (one shared TypeScript language, sandboxed languages indifferent to the host) intact. Aligns the application's ADRs with the template's architecture contract instead of contradicting it.
- Costs and risks: TanStack Start is a younger, less widely adopted framework than Next.js — a smaller ecosystem and fewer third-party integrations or community examples to lean on outside the template's paved path. Collapsing frontend and backend into one deployable app means the dashboard UI and the Docker sandbox orchestration logic now share one release/deploy lifecycle, and can no longer be scaled or rolled back independently the way a genuinely separate backend could be.

## Consequences

### Positive

- Removes an entire architectural seam ADR-0006 required (a separately deployed backend service) — one deployable unit, one dependency graph, one set of import-boundary rules, already enforced by the template.
- Reuses already-built template infrastructure directly: TanStack Start import protection, the Vitest/Playwright test layout, the Docker non-root multi-stage runtime, and `pnpm run verify` / `test:e2e` CI gates need no adaptation for a different framework.
- The server/browser boundary (`*.server.ts` protected from browser bundles, static-only server-function imports) is enforced by the framework itself, not by convention split across two separately deployed codebases.
- The application's own ADRs now compose with `arch_docs/`'s template contract instead of contradicting it.

### Negative

- TanStack Start's smaller ecosystem (relative to Next.js) means less community prior art to draw on if a need arises outside the template's paved path.
- The dashboard UI and Docker sandbox orchestration logic now share one release/deploy lifecycle. They cannot be scaled or rolled back independently the way a genuinely separate Next.js frontend + Node backend could be. Given v1 runs on the local machine for a single learner (ADR-0001, SPEC.md), this is accepted for v1 — but is not left open-ended: **revisit when multi-user work begins**, since ADR-0001 already states multi-learner support is a real future intent, not hypothetical.
- Orchestration code (which drives Docker execution of learner-submitted code) and the public-facing web server now run in the same process, with no process-level isolation between them — a Docker sandbox escape or an orchestration bug is no longer walled off in a separate service. Accepted for v1 because the platform runs locally for a single learner (ADR-0001) with no other party at risk; revisit alongside the deploy-coupling trigger above once multi-user work begins.
- Any prior planning, familiarity, or external material built around Next.js specifically (from ADR-0006's original acceptance) doesn't transfer.

### Neutral / Risks

- No code exists yet, so this correction costs nothing in migration or rewrite terms — that is specifically why it's being made now rather than left for ADR-0006 to be implemented against first.
- Live-streaming execution output is not a v1 requirement (see Decision) — v1's request/response execution model is handled natively by `createServerFn`, so there is no open technical unknown blocking v1. If real-time output is added in a future revisit, `server.handlers` (`arch_docs/dependency-rules.md`) is the mechanism; confirming it's sufficient for that specific capability is deferred to that future work, not resolved here.
- TanStack Start is open-source and built on React, so this is not vendor lock-in in the proprietary-dependency sense — the platform, business logic, and data don't disappear if TanStack Start does. What is framework-specific is the route/server-function glue, and a future framework change would cost real rewrite effort proportional to how much logic is embedded directly in that glue rather than in the framework-agnostic modules described in Decision. That structure is what keeps this decision reversible without treating it as a permanent commitment.

## Confirmation

- No code implements this yet as of this writing; there is no automated check to point to today.
- Once built: `pnpm run verify`, `pnpm run test:e2e`, and `docker build .` (`arch_docs/development-workflow.md`) confirm the template's baseline continues to pass. TanStack Start's import protection and `arch_docs/dependency-rules.md`'s environment rules (browser-reachable code must not import `*.server.ts`, Node-only modules, or `@tanstack/react-start/server`) are enforced by the build itself, not only by review.

## Relationships and References

- Supersedes: [ADR-0006](./0006-typescript-nextjs-stack.md) — see that record for the (still-valid) original rationale for TypeScript end-to-end, and its own now-superseded framework/backend choice.
- Related to: [ADR-0004](./0004-openai-compatible-single-model-adjustable-effort.md) — the AI Teacher Engine client lives behind the same server/browser boundary this ADR establishes.
- Related to: [ADR-0005](./0005-docker-sandbox-isolation.md) and [ADR-0007](./0007-postgres-storage.md) — sandbox orchestration and persistence both live in server-only feature modules under this ADR's app shape.
- Supporting evidence: `arch_docs/architecture.md`, `arch_docs/adoption.md`, `arch_docs/dependency-rules.md`, `arch_docs/development-workflow.md`, `arch_docs/testing.md`.
- Owning implementation package: none yet — no code implements this as of this writing.
