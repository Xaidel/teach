# ADR-0011: Sandbox orchestration mechanics

- **Date**: 2026-08-11
- **Status**: Accepted
- **Deciders**: Xaidel (sole maintainer)

## Context and Problem Statement

ADR-0005 decided *which* isolation technology the sandbox uses — plain Docker containers, one pinned image per v1 language — and fixed the resource limits (PRD Section 5.1). It explicitly left the orchestration layer's implementation unaddressed: how the TanStack Start server (ADR-0009) actually talks to Docker, how submitted code and test results cross the process/container boundary, how the three pinned images are built and versioned, and how each language's native test output becomes one shape the rest of the platform can consume.

`docs/SPEC.md`'s user story 17 ("every sandbox workspace destroyed automatically after the run") and story 14 ("real compiler/interpreter... so that pass/fail feedback is authoritative, not simulated") describe requirements this mechanism must satisfy, but neither names the mechanism. No code implements any of this yet.

This ADR was resolved as wayfinder ticket [#24](../../issues/24) ("Sandbox orchestration mechanics") on the [AI Learning Platform v1 map](../../issues/21), and gates build ticket [#1](../../issues/1) (the walking skeleton, where sandbox orchestration is first implemented).

## Decision Drivers

- **Consistency with ADR-0009**: orchestration logic must live in plain, framework-agnostic TypeScript modules behind thin `createServerFn` wrappers, not embedded directly in route/server-function glue — whatever is chosen here needs to fit that shape cleanly.
- **The "assume submitted code is malicious" threat model (ADR-0005)**: mechanisms that reduce the chance of a misconfigured resource-limit flag or an orphaned container should be preferred over ones that require getting string-built CLI flags exactly right.
- **The fixed 10-second execution timeout (PRD 5.1) is non-negotiable**: any mechanism must fit real compiler/interpreter feedback inside that window, including for compiled languages (Rust, Go) where dependency compilation time is real.
- **v1 is a single learner, occasional-burst load (ADR-0001)**: mechanisms should match that exposure — standing infrastructure (warm container pools, streaming APIs) isn't justified without a demonstrated need.
- **Uniform downstream consumption**: Stage 1 evaluation and the Socratic Hint Engine both need one pass/fail + diagnostics shape regardless of which language produced it.

## Decision

The sandbox orchestration layer works as follows:

- **Docker interface**: [`dockerode`](https://github.com/apocas/dockerode) (a Docker Engine API client), not shelling out to the `docker` CLI. The TanStack Start server is a long-lived process; `dockerode` keeps a persistent connection to the daemon and exposes typed `HostConfig` (resource limits as structured fields, not string flags) and typed container handles (`.kill()`/`.remove()` directly on the object returned from creation), rather than requiring string-built CLI arguments and stderr-parsed errors.
- **Container lifecycle**: one **ephemeral container per submission**, created fresh and destroyed after the run — never a reused/pooled container. Each pinned image is pre-compiled at build time against its language's fixed allowed-dependency set (see Neutral/Risks), so a submission's run only compiles the learner's own file against an already-warm cache, keeping per-run compilation inside the 10-second timeout without needing standing warm containers.
- **Code entry / result exit — the Sandbox Workspace**: a per-run host temp directory, created and destroyed alongside the container, bind-mounted into it. The learner's submission and the exercise's test harness are written into it before the container starts; the toolchain writes its structured test-output file into the same mount, which the orchestrator reads back from the host side after the container exits. Chosen over `dockerode`'s `putArchive` (tar-streaming files into a running container) because the orchestrator already owns the host filesystem — one `Binds` entry at container-create time is simpler than a separate archive-write step — and over stdin, which has no way to represent a multi-file project tree that compiled toolchains (`Cargo.toml`+`src/`, `go.mod`+`.go` files) require on disk.
- **Container cleanup**: every container gets a deterministic name (`sandbox-<run-id>`). The 10-second timeout is enforced by an explicit watchdog in the orchestration code — not solely by a client-side call timeout — which calls `.kill()` on the container directly. Teardown (`.remove()`) always runs in a `finally`, regardless of whether the run succeeded, failed, or was killed for timeout; this is the actual cleanup guarantee, since a killed client-side operation doesn't reliably guarantee the container itself has exited.
- **Image build & versioning**: one `Dockerfile` per language, in-repo (`sandbox/<lang>/Dockerfile`), built to a fixed local tag (e.g. `teach-sandbox-rust:v1`), bumped when the Dockerfile changes. Each Dockerfile installs a non-root user, the exact pinned toolchain version, any harness scripts, and pre-compiles the warm-cache skeleton described above.
- **Test-output normalization — the Sandbox Result**: each language keeps its most robust *native* structured test-output format rather than being forced through one common wire format — `go test -json` for Go (stable, built-in), `cargo-nextest`'s JUnit XML for Rust (the only GA structured option on a stable toolchain; its JSON output is still experimental), and pytest's built-in `--junit-xml` for Python. One per-language normalizer function in the orchestration code maps each into a shared in-process shape (`{ passed: boolean, tests: [{ name, status, message?, output? }] }`) — the **Sandbox Result** — that Stage 1 evaluation and the Socratic Hint Engine both consume identically.

## Alternatives Considered

### Docker interface: CLI shell-out vs. dockerode

**Option A: shell out to the `docker` CLI** (via `execa`/`child_process`).

- Benefits: no extra dependency; every operation maps directly onto a documented `docker` command; familiar for debugging (the same commands work by hand in a terminal).
- Costs and risks: resource limits become string-built CLI flags, which is a bad place for a subtle mistake to hide in a "must assume malicious code" feature. The CLI process and the container it starts are two different things — killing the CLI process (e.g. on timeout) does not reliably stop the container, requiring manual named-container tracking plus a second explicit `docker kill`/`docker rm -f` step to actually guarantee cleanup. Errors surface as exit codes and free-text stderr rather than typed responses.

### Option B (chosen): dockerode

- Benefits: typed `HostConfig` for resource limits instead of string flags; a container handle returned directly from creation, with `.kill()`/`.remove()` callable on it — no name-string indirection to look up a second time; structured API errors instead of parsed stderr; a persistent daemon connection suited to the TanStack Start server's own long-lived-process shape, instead of forking a new CLI process per submission.
- Costs and risks: one additional dependency; slightly less "look at a terminal command and know what it does" transparency than the CLI when debugging by hand. The explicit-watchdog-plus-guaranteed-teardown pattern is still required regardless of which interface is chosen — dockerode does not remove the need for it, only makes the container reference easier to act on.

### Container lifecycle: ephemeral-per-run vs. reused pool

**Option A: a pool of pre-warmed containers per language**, reused across submissions.

- Benefits: avoids per-run container-creation and toolchain warm-up latency entirely.
- Costs and risks: contradicts SPEC.md story 17's per-container ephemeral-workspace guarantee — a reused container carries real risk of one submission's state leaking into the next unless carefully reset between runs. Standing containers consume memory/CPU while idle, which is unjustified overhead for v1's single-learner, occasional-burst load (ADR-0001). Container start itself is not the expensive part (namespace/cgroup setup + mounting cached layers, typically sub-second) — so pooling optimizes a cost that isn't actually the dominant one; the dominant one (cold dependency compilation) is solved more directly by baking a warm cache into the image itself.

### Option B (chosen): ephemeral per-run, warm cache baked into the pinned image

- Benefits: gives SPEC.md story 17's per-run isolation guarantee for free, with zero cross-submission state risk. Solves the actual cost driver (dependency compilation time, not container start time) at image-build time instead of via standing runtime infrastructure — no pool lifecycle to manage, no idle resource cost between a single learner's submissions.
- Costs and risks: requires each pinned image's Dockerfile to include a cache-warming build step (pre-compiling a skeleton project against the language's allowed-dependency set), which only works if that dependency set is fixed and known — see Neutral/Risks below for what isn't yet decided here.

### Code entry / result exit: bind-mounted Sandbox Workspace vs. `putArchive` vs. stdin

**Option A: stdin.**

- Benefits: no filesystem coordination needed; simplest possible interface for a single-file submission.
- Costs and risks: exercises need more than one file (the learner's solution plus the hidden test harness at minimum) — stdin has no natural way to represent a multi-file project tree, and compiled toolchains need real files on disk to build against, not a stream. Rejected outright, not seriously in contention.

**Option B: `dockerode`'s `putArchive`** (tar-stream files into a running container after creation).

- Benefits: works with any container lifecycle, including a reused/pooled one; no host-side temp-directory bookkeeping.
- Costs and risks: an extra archive-construction step for no benefit here, since the orchestrator already owns the host filesystem directly — writing files to a temp directory and mounting it is simpler than serializing them into a tar stream and a second API call.

### Option C (chosen): bind-mounted per-run Sandbox Workspace

- Benefits: one `Binds` entry at container-create time; input and output share the same mount, so result retrieval needs no second channel; the workspace's lifecycle matches the container's (Q2/create-once, destroy-after-run), so cleanup is a single `rm -rf` alongside container teardown rather than a separately tracked resource.
- Costs and risks: ties code entry specifically to the ephemeral-per-run lifecycle decision — a pooled-container design would need a different mechanism (this is acceptable since ephemeral-per-run was already chosen on its own merits).

### Image build & versioning: in-repo Dockerfile vs. public image pinned by digest

**Option A: pull a public per-language base image, pinned by digest, no repo-owned Dockerfile.**

- Benefits: zero build step; "pinned" is a digest, which is unambiguous.
- Costs and risks: cannot satisfy the warm-cache decision above — pre-compiling a skeleton against a fixed dependency set requires an explicit build step, which only exists in a Dockerfile. Also has nowhere to add the non-root user and harness scripts the sandbox needs without a build step regardless.

### Option B (chosen): one Dockerfile per language, in-repo, built to a fixed local tag

- Benefits: the repo controls exactly what's in each pinned image end-to-end — toolchain version, non-root user, harness scripts, and the warm-cache pre-compile step all live in one place; "pinned" means a tag the repo bumps deliberately, not a digest that happened to be current when ADR-0005 was written.
- Costs and risks: the repo now owns image maintenance (rebuilding when toolchain versions need bumping), rather than inheriting that from an upstream-maintained public image.

### Test-output normalization: forced common wire format vs. per-language native format

**Option A: force every language through one common wire format** (JUnit XML for all three, converting Go's native `go test -json` through an extra tool like `go-junit-report`).

- Benefits: one parser to write and maintain, since all three inputs share a format.
- Costs and risks: Go already has the most robust structured option available natively, with no extra binary needed; routing it through a converter trades a better format for a worse one, purely for wire-level uniformity that the actual requirement (one shape *after* normalization) doesn't need.

### Option B (chosen): per-language native format, normalized in code to a shared shape

- Benefits: each language uses its most robust available option (`go test -json` for Go, no extra tooling; `cargo-nextest`'s JUnit XML for Rust; pytest's built-in `--junit-xml` for Python) — Stage 1 evaluation and the Socratic Hint Engine still see one uniform shape, because uniformity is enforced at the normalizer output, not the toolchain input.
- Costs and risks: three separate parsers to write and maintain instead of one, though each is a well-documented, stable format specific to its language.

## Consequences

### Positive

- Build ticket #1 (the walking skeleton) has a concrete orchestration mechanism to implement against instead of improvising one during the first-ever sandbox integration.
- Resource-limit configuration is typed (`dockerode`'s `HostConfig`) rather than string-built CLI flags, reducing the risk of a silent misconfiguration in a "must assume malicious code" feature.
- The ephemeral-per-run-plus-warm-cache combination satisfies both SPEC.md story 17's per-run isolation guarantee and the fixed 10-second timeout, without standing pool infrastructure.
- Stage 1 evaluation and the Socratic Hint Engine share one Sandbox Result shape regardless of language, without forcing any language through a worse test-output format than the one it natively supports.

### Negative

- Guaranteed container cleanup requires explicit application-level logic (named containers, a watchdog timer, `finally`-block teardown) rather than being handled entirely by Docker's own `--rm`-equivalent behavior — this is real code the orchestration layer must get right, not a configuration flag.
- Three separate test-output normalizer functions must be written and kept correct against their respective formats, rather than one shared parser.
- Each pinned image's Dockerfile owns a cache-warming build step that must be re-run (image rebuilt, tag bumped) whenever the underlying allowed-dependency set changes — see Neutral/Risks.

### Neutral / Risks

- **The warm-cache mechanism assumes a fixed, pre-vetted set of dependencies each language's exercises are allowed to use — that set, and who curates it, is not decided anywhere in `docs/SPEC.md` or `CONTEXT.md`.** This ADR's mechanism is correct for whatever that set turns out to be, but the set itself, and the process for rebuilding a pinned image's warm cache when it changes, remains open. Tracked as fog on the [AI Learning Platform v1 map](../../issues/21)'s "Not yet specified," not resolved here.
- `dockerode` is an additional third-party dependency the orchestration layer now relies on; it is actively maintained and widely used, but is not a zero-dependency choice the way shelling out to a CLI already present on the host would have been.
- The Sandbox Result shape (`{ passed, tests: [...] }`) is sketched at decision granularity here, not fully typed; the exact TypeScript/zod schema is an implementation detail for whoever picks up build ticket #1, not re-litigated by this ADR.

## Confirmation

- No code implements this yet as of this writing; there is no automated check to point to today.
- Once built: a sandbox-orchestration test suite (per `docs/SPEC.md`'s Testing Decisions, run against real Docker containers) asserting (a) a killed/timed-out run always results in no running or stopped-but-not-removed container left behind, (b) each language's normalizer produces a well-formed Sandbox Result from both a passing and a failing fixture submission, and (c) the pinned image build for each language completes and produces a warm-cache hit on a trivial submission (i.e. the trivial case compiles well under the 10-second timeout).

## Relationships and References

- Related to: [ADR-0005](./0005-docker-sandbox-isolation.md) — this ADR implements ADR-0005's chosen isolation technology (Docker, one pinned image per language) as concrete orchestration mechanics; ADR-0005's resource-limit values and threat model are inherited unchanged.
- Related to: [ADR-0009](./0009-tanstack-start-single-app-stack.md) — this ADR's orchestration module is exactly the kind of plain, framework-agnostic TypeScript module ADR-0009's server-function-wrapper pattern expects; it also inherits ADR-0009's v1 request/response (no streaming) execution model, which is why `dockerode`'s streaming capabilities are not exercised here.
- Related to: [ADR-0003](./0003-multi-language-from-v1.md) — the per-language pinned-image and normalizer-function decisions here are the concrete implementation of running all three v1 languages' real toolchains.
- Refined by: [ADR-0018](./0018-per-language-dependency-set-mechanism.md) — fills the "who curates the allowed-dependency set, where it lives, what triggers rebuild" gap this ADR left open (see Neutral/Risks above); this ADR's core decision (dockerode, ephemeral-per-run containers, warm cache, image build/versioning, Sandbox Result normalization) remains authoritative and unchanged.
- Related to: [ADR-0019](./0019-generated-test-source-storage.md) — supplies the storage location for "the exercise's test harness" this ADR names but leaves unlocated; this ADR's own decision (bind-mounted Sandbox Workspace, per-language native test-output formats) is unchanged.
- Supporting evidence: `docs/SPEC.md` user stories 14 and 17 (Sandbox); wayfinder ticket #24 on map #21 (resolution session this ADR records).
- Owning implementation package: none yet — no code implements this as of this writing.
