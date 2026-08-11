# ADR-0018: Per-language allowed dependency set — curation & cache-rebuild mechanism

- **Date**: 2026-08-11
- **Status**: Accepted
- **Deciders**: Xaidel (sole maintainer)

## Context and Problem Statement

ADR-0011 (Sandbox orchestration mechanics) assumes each Pinned Image is pre-compiled at build
time against a fixed, pre-vetted set of dependencies per language, so a submission's run only
compiles the learner's own file against an already-warm cache — but explicitly left open *who*
curates that set, *where* it lives, and *what* triggers a Pinned Image rebuild when it changes:
"that set, and who curates it, is not decided anywhere in `docs/SPEC.md` or `CONTEXT.md`" (ADR-0011,
Neutral/Risks).

This ADR resolves the **mechanism only**: ownership, storage location/format, and the rebuild
trigger, for all three v1 languages (Rust, Go, Python). The **content** of each language's
allowed-dependency list — which crates/packages/modules exercises may actually use — stays
deliberately out of scope, deferred to whoever implements build tickets
[#8](../../issues/8)/[#19](../../issues/19)/[#20](../../issues/20) as exercise content is
actually authored per language.

This ADR was resolved as wayfinder ticket [#33](../../issues/33) ("Per-language allowed
dependency set: curation & cache-rebuild mechanism") on the
[AI Learning Platform v1 map](../../issues/21), and gates build tickets
[#2](../../issues/2) (multi-language sandbox images), [#8](../../issues/8), [#19](../../issues/19),
and [#20](../../issues/20) — each of which needs a settled place to declare a dependency before a
Pinned Image can be built against it.

## Decision Drivers

- **ADR-0011's existing framing**: the warm cache is baked into each Pinned Image by
  pre-compiling a "skeleton project" against the language's allowed-dependency set at image-build
  time — the mechanism decided here must fit that shape, not invent a new one.
- **No drift between "allowed" and "pre-compiled"**: whatever the mechanism is, the set that's
  permitted and the set that's actually baked into the warm cache must never be able to diverge.
- **Solo-maintainer operability (ADR-0001)**: curation and rebuild-triggering should cost nothing
  beyond developer discipline already accepted elsewhere in this project (ADR-0013's "re-run
  `sandbox:build` when a Dockerfile changes" is pure convention, no tooling).
- **No CI/CD, app runs natively (ADR-0013)**: the dependency set only matters at image-build
  time, not at app runtime — it doesn't need to be queryable by the running server.
- **ADR-0016 precedent**: a review/approval gate is warranted where content carries real
  structural risk (Concept Graph cycles, dangling references) with a sole reviewer who is also
  the sole learner. A dependency addition carries no analogous structural risk.

## Decision

- **Storage location & format**: the skeleton project ADR-0011 already implies for warm-cache
  pre-compilation *is* the allowed-dependency list — one artifact, not two. Concretely:
  `sandbox/<lang>/skeleton/Cargo.toml` (Rust), `sandbox/<lang>/skeleton/go.mod` (Go), and
  `sandbox/<lang>/skeleton/requirements.txt` (Python), committed to git alongside that language's
  `sandbox/<lang>/Dockerfile`. Whatever's declared in the manifest is both "what's allowed" and
  "what's pre-compiled" — they cannot drift apart because they're the same file.
- **Version pinning**: every dependency is pinned to an exact version (`=1.0.203`-style Rust
  pins, `==`-pinned `requirements.txt`, Go's default exact `go.mod` versions) — never a range. A
  dependency's version can only change via an explicit manifest edit.
- **Curation**: direct edit, no review/approval step. The dev adds, removes, or bumps a
  dependency in the skeleton manifest (e.g. `cargo add <crate>`) when an exercise needs it,
  commits the change, and rebuilds. Unlike the Concept Graph (ADR-0016), there is no structural
  gate to run first.
- **Rebuild trigger**: broadens ADR-0013's existing "`sandbox:build` re-run when a Dockerfile
  changes" rule to **"when anything under `sandbox/<lang>/` changes"** — Dockerfile *or* skeleton
  manifest. Still pure developer discipline; no hashing, staleness check, or CI hook.
- Out of scope, unchanged: the actual per-language dependency list content (which crates/packages
  each language's exercises may use) — deferred to build tickets #8/#19/#20.

## Alternatives Considered

### Storage location & format: skeleton manifest vs. separate declarative config vs. DB table

**Option A: a separate declarative manifest** (e.g. `sandbox/<lang>/allowed-deps.yaml`) that a
script reads to generate or check the skeleton project's actual manifest.

- Benefits: decouples "the policy" from "the build artifact" — could matter if the list ever
  needed to be read by something other than the Dockerfile build.
- Costs and risks: two files instead of one, with a generation/sync step between them that must
  itself stay correct — the exact drift risk this decision is trying to avoid, for a benefit
  (non-Dockerfile consumers) nothing in v1 needs.

**Option B: a DB table**, queryable at runtime.

- Benefits: would let future exercise-content validation query the allowed set live.
- Costs and risks: the dependency set only matters at image-build time (ADR-0013: app runs
  natively, no runtime dependency on Docker-image contents); adding a DB table and a migration
  for a build-time-only concern introduces a runtime dependency this decision doesn't need. That
  future validation use case is itself speculative and not asked for by this ticket's scope.

**Option C (chosen): the skeleton project's own manifest is the list.**

- Benefits: one artifact serves both roles — no separate file to keep in sync, no generation
  step, no runtime dependency. Already implied by ADR-0011's "skeleton project" language.
- Costs and risks: ties "the list" specifically to each language's native manifest format
  (`Cargo.toml`/`go.mod`/`requirements.txt`) rather than one uniform cross-language format —
  acceptable, since nothing in v1 needs to read the three languages' lists through one shared
  parser.

### Curation mode: direct edit vs. propose-then-approve vs. no process

**Option A: propose-then-approve**, mirroring ADR-0016's Concept Graph review — the AI Teacher
Engine proposes a dependency addition while drafting exercise content, the dev approves before it
lands in the manifest.

- Benefits: consistent with the one existing review-workflow precedent in this project.
- Costs and risks: invents a proposal/approval loop for a decision that's already cheap to make
  directly. ADR-0016's gate exists because drafted Concept Graph content has real structural
  failure modes (cycles, dangling references) that need a deterministic check; a dependency
  addition is a one-line, git-reviewable edit with no analogous structural risk to gate against.

**Option B: no process at all** — not even a documented convention.

- Benefits: none beyond avoiding one paragraph of documentation.
- Costs and risks: under-specifies for no reason; leaves "who's allowed to touch this and how" as
  tribal knowledge instead of a one-line stated convention, which is exactly the kind of gap this
  ticket exists to close.

**Option C (chosen): direct edit, no review step.**

- Benefits: matches the actual risk level (a solo dev editing their own build config) and costs
  nothing beyond stating the convention once.
- Costs and risks: no second set of eyes on a dependency addition — acceptable, since the dev is
  also the sole reviewer on every other decision in this project (ADR-0016's own reasoning).

### Version pinning: exact versions vs. ranges

**Option A: loose/range versions** (`serde = "1.0"`, unpinned `requirements.txt`).

- Benefits: dependencies pick up patch/minor fixes automatically on the next image rebuild,
  without a manifest edit.
- Costs and risks: directly contradicts ADR-0011's "fixed, pre-vetted set" framing — a
  `sandbox:build` run today and one next month against the *same* manifest could produce
  different warm caches, silently, with no manifest diff to explain why. Could also invalidate a
  reference solution's expected behavior without any tracked change.

**Option B (chosen): exact pinned versions.**

- Benefits: reproducible — a given manifest state always produces the same warm cache. A
  version change is always a visible, deliberate manifest edit.
- Costs and risks: routine security/version bumps require a manual edit rather than happening
  automatically; acceptable for solo v1 with no dependency-update automation in scope.

### Rebuild trigger: broaden existing rule vs. automated staleness detection vs. tag-bump convention

**Option A: automated staleness detection** — `sandbox:build` (or a pre-`dev` hook) hashes each
`sandbox/<lang>/` directory and warns or auto-rebuilds if the built image's tag doesn't match the
current hash.

- Benefits: removes reliance on the dev remembering to rebuild.
- Costs and risks: real engineering effort (hashing, tag/hash bookkeeping, a new script) for a
  problem that hasn't occurred yet — the same over-engineering ADR-0013 already rejected for
  other automation in this environment (no CI/CD, solo v1 developer).

**Option B: tag-bump-as-trigger** — treat a manual image-tag bump (not the manifest edit itself)
as the actual signal, making staleness detectable by comparing the manifest against the tag.

- Benefits: makes "is this image stale" theoretically checkable without hashing.
- Costs and risks: adds a second convention (remembering to bump the tag) alongside the manifest
  edit, for no detection benefit beyond what `git diff` and developer attention already give
  today — nothing currently reads or checks the tag/manifest relationship.

**Option C (chosen): broaden ADR-0013's existing Dockerfile-change rule.**

- Benefits: zero new tooling — extends a convention already accepted and in force
  (`sandbox:build` re-run "when a Dockerfile changes") to cover the sibling manifest file it now
  also owns. One rule to remember (`sandbox/<lang>/` changed → rebuild that language), not two.
- Costs and risks: still pure developer discipline — a forgotten rebuild after a manifest edit
  goes undetected until the dev notices or hits a build/test failure. Accepted for the same
  reason ADR-0013 accepted it for Dockerfile changes.

## Consequences

### Positive

- Build tickets #2, #8, #19, and #20 have a concrete, already-existing place to declare a
  dependency as each language's exercise content is authored, instead of an undefined gap.
- ADR-0011's warm-cache mechanism no longer rests on an unspecified input — the "fixed,
  pre-vetted set" it assumes now has an owner, a location, and a rebuild trigger.
- The list and the warm cache can never drift apart, since they're read from the same file.

### Negative

- Exact pinning means routine dependency/security bumps require a manual manifest edit plus an
  image rebuild — never automatic.
- The rebuild-trigger surface widens slightly from "watch one file" (the Dockerfile) to "watch
  one directory" (`sandbox/<lang>/`) — still small, but one more file the dev must remember
  triggers a rebuild.

### Neutral / Risks

- No automated staleness detection exists. A forgotten rebuild after editing a skeleton manifest
  silently keeps the running Pinned Image stale relative to git until the dev notices or a build
  fails — acceptable for solo v1 per ADR-0013's existing developer-discipline precedent for the
  Dockerfile-change case; revisit if this project gains contributors or CI/CD.
- The actual per-language dependency list content remains undecided by design — deferred to
  build tickets #8/#19/#20, not resolved here.

## Confirmation

- No code or `sandbox/` directory exists yet as of this writing; there is no automated check to
  point to today.
- Once built: `sandbox/<lang>/skeleton/` exists for each language with exact-pinned dependency
  versions in its native manifest format; each language's `Dockerfile` `COPY`s that skeleton and
  pre-compiles against it as part of the image build; a manual check (consistent with ADR-0013's
  existing pattern, since no CI/CD exists) that editing a skeleton manifest and re-running
  `pnpm run sandbox:build` produces a warm-cache hit on a trivial submission using the newly added
  dependency.

## Status note (2026-08-12)

CI/CD now exists via `.github/workflows/verify.yml` (GitHub Actions), which runs
`pnpm run sandbox:build` on every `pull_request` and `push` to `main` — hitting the
"revisit if this project gains contributors or CI/CD" trigger noted above. The risk profile
changes accordingly: a stale Pinned Image relative to `sandbox/<lang>/` can no longer persist
silently past the next CI run, since the rebuild now happens automatically there. The
"no CI hook — pure developer discipline" framing is historical context; the curation and
exact-pinning decisions themselves remain authoritative and unchanged.

## Relationships and References

- Refines: [ADR-0011](./0011-sandbox-orchestration-mechanics.md) — fills the "who curates the
  allowed-dependency set, where it lives, what triggers rebuild" gap explicitly left open in its
  Neutral/Risks; ADR-0011's orchestration mechanics (ephemeral-per-run containers, warm cache,
  image build/versioning, Sandbox Result normalization) remain authoritative and unchanged.
- Amends: [ADR-0013](./0013-local-dev-deploy-environment.md) — broadens its `sandbox:build`
  rebuild trigger from "when a Dockerfile changes" to "when anything under `sandbox/<lang>/`
  changes"; ADR-0013's core (explicit build step, fresh-setup sequence, native app / composed
  Postgres, no CI/CD) remains authoritative and unchanged otherwise.
- Related to: [ADR-0016](./0016-concept-graph-review-workflow.md) — same curation-without-a-
  review-gate reasoning (sole reviewer = sole learner = sole dev), applied here to dependency
  additions rather than Concept Graph content.
- Supporting evidence: wayfinder ticket [#33](../../issues/33) on map
  [#21](../../issues/21) (resolution session this ADR records).
- Owning implementation package: none yet — no code implements this as of this writing.
