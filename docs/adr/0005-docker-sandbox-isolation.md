# ADR-0005: Docker containers for sandbox execution

- **Date**: 2026-08-10
- **Status**: Accepted
- **Deciders**: Xaidel (sole maintainer)

## Context and Problem Statement

`docs/INITIAL_PRD.md` Section 15 states the sandbox "must assume submitted code is malicious" and lists minimum isolation requirements: CPU limit, memory limit, process/PID limit, execution timeout, network isolation, filesystem isolation, output size limit, ephemeral workspace, automatic cleanup. Section 5.1 gives concrete default values (512MB memory, 1 CPU, 64 PIDs, 10s timeout, network disabled, 1MB output cap, ephemeral filesystem). None of this specifies which isolation *technology* satisfies "assume malicious" — that choice is what this ADR makes.

Whatever technology is chosen also has to run real compiler/interpreter toolchains for all three v1 languages (ADR-0003: Rust, Go, Python) — the platform's evaluation is only authoritative if `cargo test`, `go test`, and `pytest` actually run, not a simulated approximation of them.

The decision question: which sandbox isolation technology satisfies the PRD's threat model and resource-control requirements, runs all three v1 languages' toolchains natively, and is operationally sustainable for a solo-maintained v1 with exactly one learner (ADR-0001)?

## Decision Drivers

- **Threat model is a mandatory constraint, not a preference**: the PRD requires assuming submitted code is malicious; this rules out any isolation technology that can't enforce the listed resource and access controls.
- **Toolchain compatibility across all three v1 languages**: the chosen technology must run Rust/cargo, Go, and Python natively and well — a gap in any one language undermines ADR-0003's premise that the abstraction is proven across genuinely different toolchains.
- **Operational cost proportional to actual exposure**: v1 has exactly one learner — the platform's author (ADR-0001) — running their own code (or AI-generated code they pasted), not an adversarial multi-tenant population. Isolation strength should match that exposure, not a future one.
- **Reversibility given the platform's stated multi-user intent**: ADR-0001 explicitly keeps the data model ready for multi-user support later; whatever is chosen here should be revisitable without being prohibitively expensive to change once real multi-tenant exposure exists.

## Decision

We will use plain **Docker containers** for sandbox execution, with **one pinned image per language** (Rust/cargo, Go, Python), enforcing resource limits via standard container runtime flags (`--memory`, `--pids-limit`, `--network none`, read-only/tmpfs rootfs) that directly implement every control listed in PRD Section 5.1.

This decision must be **revisited before learner code execution is exposed to untrusted multi-tenant traffic** — Docker's namespace/cgroup boundary is accepted here specifically because current exposure is limited to the platform's single, trusted learner (ADR-0001), not because it is judged sufficient for an adversarial multi-tenant population.

## Alternatives Considered

### Option A: Firecracker/gVisor micro-VM isolation

Run submitted code inside Firecracker micro-VMs or gVisor's intercepted-syscall sandbox instead of standard container namespaces.

- Benefits: a materially stronger isolation boundary than container namespaces — matches the PRD's "assume submitted code is malicious" threat model most directly, and is the isolation technology real multi-tenant code-execution products use at scale.
- Costs and risks: real operational cost — VM/sandbox runtime infrastructure, kernel/image management, and often bare-metal or nested-virtualization-capable hosts — that isn't justified by v1's actual exposure. It defends against a threat (an adversarial *other* learner) that doesn't exist yet in a single-learner v1, at the cost of infrastructure complexity a solo maintainer has to operate before that threat is real.

### Option B: WASM sandboxing

Compile and run submitted code inside a WebAssembly runtime, which is sandboxed by construction rather than relying on OS-level isolation.

- Benefits: memory-safe execution boundary without operating a separate container or VM runtime; sandboxing is a property of the execution model itself, not a configuration that has to be gotten right.
- Costs and risks: real toolchain gaps for two of the three v1 languages. WASM compilation and runtime support is mature for Rust, but materially weaker for a native Go toolchain (cgo, goroutine/runtime behavior under WASM) and for Python (CPython is not WASM-native; WASM-based Python runtimes have real behavioral and library gaps). This risks the "real compiler feedback, not simulated" requirement not holding uniformly across all three v1 languages, undermining ADR-0003's premise.

### Option C (chosen): Docker containers, one pinned image per language

Run each language's code inside a pinned Docker image for that language, with resource limits enforced via standard container runtime flags.

- Benefits: all three v1 languages support Docker natively and well — no toolchain gaps to work around, unlike WASM. Standard container runtime flags (`--memory`, `--pids-limit`, `--network none`, read-only/tmpfs rootfs) implement every PRD Section 5.1 requirement directly, without a custom isolation layer. Operationally simple for a solo maintainer — no VM or specialized kernel infrastructure to run.
- Costs and risks: namespace/cgroup isolation is a weaker security boundary than a micro-VM or gVisor's syscall interception — a container-escape vulnerability has a larger blast radius than a VM boundary would. This is accepted as proportional to v1's actual exposure, not as a judgment that it's sufficient indefinitely.

## Consequences

### Positive

- Every PRD Section 5.1 resource-control requirement (CPU, memory, PID, network, filesystem, output cap, ephemeral workspace, timeout) is satisfiable directly through standard container runtime flags — no custom isolation layer needs to be built.
- All three v1 languages (ADR-0003) run their real toolchains natively inside Docker, with no per-language workaround needed the way WASM would require for Go and Python.
- Operationally simple for solo maintenance — Docker is the only infrastructure dependency added, with no VM or specialized kernel management.

### Negative

- The isolation boundary is real but weaker than a micro-VM or gVisor's syscall interception: a container-escape vulnerability affects the host directly, with a larger blast radius than a VM boundary would allow. This is an accepted, not eliminated, risk.
- Docker itself becomes a hard runtime dependency — whatever host runs the platform must have a working container runtime present and maintained.

### Neutral / Risks

- This decision must be revisited before learner code execution is exposed to untrusted multi-tenant traffic — the point at which the threat model shifts from "assume malicious code, single trusted operator" to "assume malicious code, untrusted population." No specific trigger (learner count, or "any second real learner") is defined here; that threshold is an open question for whoever picks up multi-user work.
- Docker's isolation strength is not re-evaluated by this ADR against any threat beyond the PRD's stated "assume malicious code" baseline — e.g. it does not address supply-chain risk in the pinned per-language images themselves, which is out of scope for this decision.

## Confirmation

- No code implements this yet as of this writing; there is no automated check to point to today.
- Once built: the sandbox orchestration layer launches each language's pinned image with the exact runtime flags corresponding to PRD 5.1 (`--memory 512m`, `--pids-limit 64`, `--network none`, read-only/tmpfs rootfs, 10s execution timeout enforced) on every launch, not opt-in per exercise — verifiable with a sandbox-configuration test asserting those flags are always present regardless of language or exercise.

## Relationships and References

- Related to: [ADR-0003](./0003-multi-language-from-v1.md) — this ADR's one-pinned-image-per-language requirement is the concrete implementation of ADR-0003's per-language runtime abstraction.
- Related to: [ADR-0001](./0001-single-user-mvp-multi-user-ready-data-model.md) — same "acceptable now, must revisit before multi-user" shape; this ADR's stated revisit trigger is ADR-0001's eventual multi-user phase.
- Supporting evidence: [docs/INITIAL_PRD.md](../INITIAL_PRD.md) Section 5 (System Safety & Reliability Guardrails), Section 5.1 (Sandbox Resource Controls), Section 15 (Interactive Sandbox — "must assume submitted code is malicious").
- Owning implementation package: none yet — no code implements this as of this writing.
