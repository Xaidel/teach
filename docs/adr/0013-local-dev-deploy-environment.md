# ADR-0013: Local dev/deploy environment — native app, composed Postgres, ad hoc sandbox

- **Date**: 2026-08-11
- **Status**: Accepted
- **Deciders**: Xaidel (sole maintainer)

## Context and Problem Statement

`docs/SPEC.md`'s Implementation Decisions already state v1 runs on the local machine, with the TanStack Start server talking to the local Docker daemon (ADR-0009), and that orchestration code should not assume a local daemon specifically. What's left unspecified is the mechanics: how the app process, Postgres, and the per-language sandbox images actually get started together for local dev, what environment configuration is needed, and where secrets live.

This matters now because the repo is a from-scratch scaffold — no `src/`, Dockerfile, `.env*`, or compose file exist yet — and ADR-0011 already fixed the sandbox side (ephemeral, one container per submission via `dockerode`, never a long-lived compose service), which constrains what "starting the stack" can mean for the other two pieces.

This ADR was resolved as wayfinder ticket [#26](../../issues/26) ("Dev/deploy environment setup") on the [AI Learning Platform v1 map](../../issues/21), and gates build ticket [#1](../../issues/1) ("Walking skeleton: Rust sandbox submit & pass/fail").

## Decision Drivers

- **ADR-0011's Sandbox Workspace mechanic**: each submission bind-mounts a per-run *host* temp directory into its sandbox container. Any path handed to `dockerode` for that mount must resolve on the machine actually running the Docker daemon — a hard constraint on whether the app itself can live inside its own container without extra plumbing.
- **`arch_docs/adoption.md`'s prescribed conventions**: `.env.example` when the app gains runtime config, a runtime-validated `src/lib/env.server.ts` before reading secrets, `pnpm` scripts, and the template's Docker non-root multi-stage runtime "when Node container deployment remains valid" (i.e., reserved for deployment builds, not asserted as the dev-loop shape).
- **Solo local developer, no deployment target yet**: `docs/SPEC.md`'s Out of Scope already excludes cloud/remote deployment for v1 — the environment only needs to serve one machine, one developer.
- **ADR-0011's forward-compatibility guarantee** ("should not assume a local daemon specifically") is about orchestration code shape, not a requirement that a remote-daemon config knob exist before it's needed.

## Decision

- **App runtime: native, not containerized.** The TanStack Start app runs via `pnpm run dev` directly on the host. It talks to the host's Docker daemon directly, so any Sandbox Workspace path it creates is already a real host path — no container boundary to bridge. The template's Dockerfile remains a deployment/CI build artifact (`docker build .`), not part of the local dev loop.
- **Postgres: `docker-compose.yml` with a single `postgres` service.** Pinned version, named volume for data, mapped port. Brought up with `docker compose up -d`, torn down with `docker compose down`.
- **Sandbox images: explicit build step, not lazy.** A dedicated script (e.g. `pnpm run sandbox:build`) builds all three `sandbox/<lang>/Dockerfile`s once during setup, and is re-run when a Dockerfile changes. Matches ADR-0011's "pre-compiled at build time" framing — a learner's first submission never eats a cold image build inside the 10s execution watchdog.
- **Env config: plain `.env` + `.env.example`, validated by `src/lib/env.server.ts`.** Minimum variable set: `DATABASE_URL`, an AI API key, and an AI API base URL (ADR-0004's OpenAI-compatible client). `.env` is gitignored; `.env.example` is checked in as the template a developer copies. No external secrets manager — unwarranted overhead for one local developer with no deployment target.
- **No Docker-connection env var yet.** `dockerode` uses its platform default (Unix socket on Mac/Linux, named pipe on Windows). A `DOCKER_HOST`-style override is added only when a remote daemon is actually introduced, not speculatively now.
- **Migrations and seed data are separate scripts.** `pnpm run db:migrate` (Drizzle Kit) applies schema migrations only. `pnpm run db:seed` applies the one seeded `learners` row (ADR-0001) separately, so migration history stays purely schema-shape and replayable.
- **Fresh-setup sequence**: `docker compose up -d` → `pnpm run db:migrate` → `pnpm run db:seed` → `pnpm run sandbox:build` → `pnpm run dev`.

## Alternatives Considered

### App runtime: native vs. containerized

**Option A: containerize the app too** (single `docker-compose.yml` bringing up app + Postgres, sandbox images built separately).
- Benefits: one command (`docker compose up`) boots everything; a new developer needs only Docker installed, not Node/pnpm.
- Costs and risks: the app needs `/var/run/docker.sock` bind-mounted in to reach the host daemon from inside its own container — a known pattern, but it introduces a real mechanical problem, not just a security question. Any Sandbox Workspace path the app creates is, from inside its own container, a path in *that* container's filesystem — meaningless to the host daemon it's talking to over the socket. Making it work requires a host directory bind-mounted into the app container at a matching path, so the app's internal path and the host path the daemon actually resolves line up. Also loses native HMR/dev-loop ergonomics (Vite file-watching through a container filesystem layer) for no offsetting benefit at this stage.

**Option B (chosen): native.**
- Benefits: no container boundary between the app and the host Docker daemon it drives — a Sandbox Workspace path the app creates already is a host path, nothing to bridge. Full native HMR/dev-loop speed. No socket-mount trust surface to reason about.
- Costs and risks: a developer needs Node/pnpm installed locally, not just Docker. Accepted — this is already assumed by every other `pnpm run ...` script in `arch_docs/development-workflow.md`.

Two further shapes were raised and rejected without changing the outcome:

- **App + Postgres fused into one container**: doesn't remove the app-in-a-container problem above (the app is still containerized, still needs the socket mount and path-matching plumbing) and adds a new one — two unrelated lifecycles (long-running Postgres daemon with persistent data vs. constantly-rebuilt app code) forced to restart/rebuild/reset together, against Docker's one-process-per-container convention.
- **Docker Swarm or Kubernetes**: doesn't solve the path-matching problem, it worsens it — a Swarm service or K8s Pod can be scheduled onto any node, so there's no longer a guaranteed single host filesystem to resolve a bind-mount path against at all (short of pinning scheduling or adding a shared network filesystem). Both also solve for a multi-machine fleet that doesn't exist here; `docs/SPEC.md`'s Out of Scope already excludes cloud/remote deployment and multi-node operation for v1.

### Sandbox image builds: explicit vs. lazy

**Option A: lazy, built by `dockerode` on first submission.**
- Benefits: no separate setup step to remember.
- Costs and risks: a learner's first submission in a fresh environment would pay a cold Docker build inside the 10s execution watchdog — risking a spurious timeout on a machine that hasn't warmed its image cache yet, and contradicting ADR-0011's "pre-compiled at build time" framing.

**Option B (chosen): explicit `sandbox:build` script.**
- Benefits: images are ready before the first real submission; matches ADR-0011's pre-compiled-image assumption exactly; one obvious place to re-run after editing a `Dockerfile`.
- Costs and risks: one more step in the fresh-setup sequence — accepted, it's a single command.

### Docker-connection config: explicit env var now vs. default until needed

**Option A: add a `DOCKER_HOST`-style env var now**, unset by default.
- Benefits: the seam ADR-0011 promised ("should not assume a local daemon specifically") is visibly already there in `env.server.ts`.
- Costs and risks: speculative config surface for a need (remote daemon) that doesn't exist yet — nothing in v1 exercises it, nothing tests it.

**Option B (chosen): rely on `dockerode`'s default; add the var when a remote daemon actually appears.**
- Benefits: ADR-0011's guarantee is about orchestration code not baking in local-daemon assumptions, not about a config knob existing in advance. No unused surface to maintain.
- Costs and risks: none material — adding the var later is a small, isolated change confined to `env.server.ts` and wherever `dockerode` is constructed.

## Consequences

### Positive

- Build ticket #1 (walking skeleton) has a concrete, ready-to-follow local setup sequence instead of an unspecified "runs locally" assumption.
- No Docker-in-Docker-adjacent plumbing (socket mounts, host-path-matching) to build, test, or reason about for v1.
- Native dev loop keeps the fastest possible edit-reload cycle for the app.
- Postgres via compose gives a pinned, reproducible version and a stable up/down pair without over-engineering a single-service setup.
- Env/secrets handling reuses the template's own prescribed convention (`.env.example` + `env.server.ts`) rather than inventing a new one.

### Negative

- A developer needs Node and pnpm installed locally, not just Docker — a slightly higher local setup bar than "clone and `docker compose up`."
- Fresh setup is five sequential commands (compose up, migrate, seed, sandbox:build, dev), not a single one. Acceptable for a solo v1 developer; worth revisiting (e.g. a wrapping `pnpm run setup` script) if onboarding more developers becomes relevant.

### Neutral / Risks

- If the app is ever containerized later (e.g. multi-developer or deployment needs change), the Sandbox Workspace host-path-matching problem identified here will need solving at that point — not before.
- The `DOCKER_HOST`-style config seam is deliberately deferred, not built now; revisit when a remote daemon is actually introduced.

## Confirmation

- No code implements this yet as of this writing; there is no automated check to point to today.
- Once built: a fresh clone following the setup sequence (`docker compose up -d` → `pnpm run db:migrate` → `pnpm run db:seed` → `pnpm run sandbox:build` → `pnpm run dev`) reaches a working walking skeleton (build ticket #1) end to end, confirming the sequence as documented.

## Status note (2026-08-12)

CI/CD now exists via `.github/workflows/verify.yml` (GitHub Actions): every `pull_request` and
`push` to `main` runs `pnpm run verify` against a `postgres` service container, after
`pnpm run db:migrate`, `pnpm run db:seed`, and `pnpm run sandbox:build`. Since 2026-08-13 the
job also runs `pnpm exec playwright install --with-deps chromium` then `pnpm run test:e2e`
after `pnpm run verify` (PR #84). This ADR's local-dev decisions (native app, composed
Postgres, explicit sandbox build step, fresh-setup sequence) remain authoritative and
unchanged; its "no CI/CD" framing is now historical context.

## Relationships and References

- Related to: [ADR-0009](./0009-tanstack-start-single-app-stack.md) — this ADR's local-machine/local-daemon framing is the starting point this ADR makes concrete.
- Related to: [ADR-0011](./0011-sandbox-orchestration-mechanics.md) — the Sandbox Workspace host-path mechanic is the primary constraint driving the native-vs-containerized app decision here.
- Related to: [ADR-0001](./0001-single-user-mvp-multi-user-ready-data-model.md) — the seeded single-learner row this ADR's `db:seed` script applies.
- Amended by: [ADR-0018](./0018-per-language-dependency-set-mechanism.md) — broadens this ADR's `sandbox:build` rebuild trigger from "when a Dockerfile changes" to "when anything under `sandbox/<lang>/` changes"; this ADR's core (explicit build step, fresh-setup sequence, native app / composed Postgres, no CI/CD) remains authoritative and unchanged otherwise.
- Supporting evidence: `arch_docs/adoption.md` (`.env.example`, `env.server.ts`, `pnpm` conventions), `arch_docs/development-workflow.md` (verification commands); wayfinder ticket [#26](../../issues/26) on map [#21](../../issues/21) (resolution session this ADR records).
- Owning implementation package: none yet — no code implements this as of this writing.
