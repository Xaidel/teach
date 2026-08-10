# Teach — AI Learning Platform

An interactive, AI-driven learning platform that converts AI-generated code a
learner doesn't fully understand into active, evaluated practice — pairing an
AI Teacher with a real sandboxed compiler and a deterministic evaluation gate.

This repository currently implements the **walking skeleton** (build ticket #1):
one hardcoded Rust exercise, submitted through a TanStack Start server function,
evaluated by `cargo test` in an isolated Docker sandbox, with the submission
and its pass/fail result persisted in Postgres.

## Stack

- **App**: TanStack Start (React), file routes + `createServerFn` server functions
- **Persistence**: Postgres via Drizzle (UUIDv7 keys, learner-scoped rows)
- **Sandbox**: Docker via `dockerode`, one pinned image per language, per-run
  ephemeral containers with enforced resource limits

## Prerequisites

- Node.js 22 LTS, pnpm 10
- Docker Desktop (or any Docker engine) running
- No local Postgres required — it runs in a container

## Fresh setup

```sh
cp .env.example .env            # fill in DATABASE_URL and the AI placeholders
docker compose up -d            # Postgres
pnpm install --frozen-lockfile
pnpm run db:migrate             # schema migrations
pnpm run db:seed                # the single learner row + the hardcoded exercise
pnpm run sandbox:build          # build teach-sandbox-rust:v1
pnpm run dev                    # http://localhost:3000
```

Re-run `pnpm run sandbox:build` whenever anything under `sandbox/rust/` changes
(a Dockerfile or a skeleton manifest edit — see ADR-0018).

## Scripts

| Script                   | Purpose                                                                     |
| ------------------------ | --------------------------------------------------------------------------- |
| `pnpm run dev`           | Development server on port 3000                                             |
| `pnpm run verify`        | format:check → lint → typecheck → test → build                              |
| `pnpm run test:e2e`      | Browser E2E through the built app (needs Postgres + Docker + sandbox image) |
| `pnpm run db:generate`   | Generate a new Drizzle migration from `src/db/schema.ts`                    |
| `pnpm run db:migrate`    | Apply pending migrations                                                    |
| `pnpm run db:seed`       | Seed the learner row and the hardcoded exercise (idempotent)                |
| `pnpm run sandbox:build` | Build the Rust sandbox image to `teach-sandbox-rust:v1`                     |

## Architecture

- Routes stay thin; the exercise feature owns the UI, schemas, server functions,
  and server-only operations (`src/features/exercise/`).
- Sandbox orchestration lives in plain TypeScript behind the server boundary
  (`src/lib/sandbox/`): `dockerode` with typed `HostConfig` resource limits, a
  bind-mounted per-run Sandbox Workspace, a watchdog enforcing the 10-second
  timeout, and guaranteed container teardown.
- The current learner resolves once per request via `getCurrentLearnerId()`
  (`src/features/learners/`) and threads down as a plain parameter.
- Decisions live in `docs/adr/`; the reusable template contract in `arch_docs/`.

## Test plan

The suite spans pure unit tests (JUnit normalizer, UUIDv7), component tests
(editor and result UI), sandbox integration tests against a real Docker daemon
(skip when the daemon is down), Postgres-backed server-operation tests (skip
when the database is unreachable), and a browser E2E journey.

```sh
pnpm run test:e2e
docker build .
```
