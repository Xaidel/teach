# ADR-0003: Multi-language support from v1

- **Date**: 2026-08-10
- **Status**: Accepted
- **Deciders**: Xaidel (sole maintainer)

## Context and Problem Statement

Every worked example and scenario in `docs/INITIAL_PRD.md` is Rust — the sandbox walkthroughs, the concept examples (Rust Borrowing, Rust Send), the depth-parameter example ("explain Rust ownership to me as a senior JavaScript developer"). Nothing in the PRD's narrative requires more than one language to tell its story.

Two things in the PRD point past Rust-only, though. First, the target audience is framed broadly: "developers... who regularly cross-check generated code in languages or paradigms they do not fully master" (PRD line 12) — not Rust developers specifically. Second, the PRD's own concept-ID example is already namespaced by language (`rust.async.send`), which only makes sense as a design if more than one language's concepts are expected to coexist in the same Concept Graph schema.

The decision question: does v1 build the sandbox execution layer, Concept Graph schema, and exercise generation/pre-flight pipeline for Rust only — matching every concrete PRD example — or against a genuine per-language abstraction from the start, covering multiple languages before v1 ships?

## Decision Drivers

- **The PRD's own concept-ID namespacing anticipates multi-language**: an `rust.` prefix on concept IDs is dead design weight if the Concept Graph never holds a second language's concepts to distinguish it from.
- **Retrofitting a language abstraction is a rewrite, not an addition**: building the sandbox, Concept Graph schema, and generation/pre-flight pipeline around Rust alone, then adding real language-abstraction later, means redesigning components that already have real content and behavior built into their single-language shape — the same category of cost ADR-0001 identified for learner scoping and chose to avoid.
- **Target-audience framing is broader than Rust**: the PRD's stated audience crosses languages and paradigms, not just Rust — a Rust-only v1 validates the product for a narrower audience than the PRD itself frames.
- **Delivery cost scales with language count**: each additional language multiplies concrete v1 work — a sandbox image to build and harden (ADR-0005), a Concept Graph to draft and human-review, and an exercise generation/pre-flight pipeline to tune and verify.
- **Abstraction correctness needs a real second data point**: a runtime/toolchain abstraction designed against one language is unproven; whether it actually generalizes can't be known until a genuinely different language is built against it.

## Decision

We will support **Rust, Go, and Python** from v1's first architecture — not Rust alone with other languages added later. The sandbox execution layer, Concept Graph schema, and exercise generation/pre-flight validation pipeline must be built against a per-language runtime/toolchain abstraction, not a Rust/cargo-specific implementation with other languages bolted on afterward.

Concept IDs must carry a language namespace (the PRD's own `rust.async.send` example) from the first migration, not only for Rust.

These three languages were chosen deliberately for paradigm spread, not convenience: Rust (compiled, ownership-based), Go (compiled, garbage-collected), and Python (dynamic, interpreted) — so the abstraction is proven across genuinely different toolchains rather than three languages that are similar under the hood. Any language beyond these three is explicitly out of scope for v1.

## Alternatives Considered

### Option A: Rust-only v1

Build the sandbox, Concept Graph, and exercise generation pipeline for Rust alone, since every concrete PRD example is already Rust. Add Go, Python, or other languages in a later phase if and when needed.

- Benefits: fastest v1 — one sandbox image, one Concept Graph to draft and review, one language's worth of exercise-generation/pre-flight tuning; every existing PRD example applies directly with no adaptation; avoids building a runtime/toolchain abstraction that might be shaped wrong before there's a second language to test it against.
- Costs and risks: leaves the PRD's own concept-ID namespacing unused and unvalidated; retrofitting a second language later means rebuilding the sandbox execution layer, Concept Graph schema, and generation/pre-flight pipeline around a genuine multi-language abstraction after real Rust-specific content and behavior already exist — the schema/architecture-rewrite risk this project explicitly avoids elsewhere (ADR-0001). The abstraction's correctness also stays unproven until that retrofit actually happens.

### Option B (chosen): Multi-language from v1 — Rust, Go, Python

Build the sandbox, Concept Graph schema, and exercise generation/pre-flight pipeline against a per-language abstraction from the start, covering three languages chosen for paradigm diversity.

- Benefits: proves the per-language runtime abstraction against three genuinely different paradigms before the platform depends on it being correct; matches the PRD's broader target-audience framing and its own concept-ID namespacing instead of leaving them aspirational; avoids a later retrofit of components that would otherwise be built single-language-shaped.
- Costs and risks: roughly triples v1's concrete build and content-authoring surface relative to Option A — three sandbox images to build and harden (ADR-0005), three Concept Graphs to draft and human-review, and exercise generation/pre-flight validation tuned and verified per language rather than once. For a solo builder, this is a real, meaningful extension of the time to a ship-ready v1.

## Consequences

### Positive

- The per-language runtime/toolchain abstraction is validated against three genuinely different paradigms (ownership/compiled, GC/compiled, dynamic/interpreted) before the platform depends on it, rather than being assumed correct from one language and found wrong when a second is eventually added.
- A future fourth language (if ever added) is additive against an already-multi-language abstraction, not a rewrite of a single-language-shaped sandbox/Concept Graph/generation pipeline — the same category of benefit ADR-0001 gets by scoping learner data from the start.
- The PRD's concept-ID namespacing and broader target-audience framing are exercised by real architecture, not left as unused design intent.

### Negative

- v1's build and content-authoring surface is roughly three times larger than a Rust-only v1: three sandbox images to build, harden, and maintain (ADR-0005); three Concept Graphs to draft and human-review; exercise generation and pre-flight validation tuned and verified per language.
- For a solo builder, this meaningfully extends the delivery timeline to a working, ship-ready v1 compared to Option A. The trade-off is accepted for abstraction correctness and audience fit, not free.
- If the runtime/toolchain abstraction turns out to be wrong despite covering three languages, all three languages' sandbox and Concept Graph work is affected by the fix, not just one — the blast radius of a design flaw is larger than a Rust-only v1's.

### Neutral / Risks

- Any language beyond Rust, Go, and Python is explicitly out of scope for v1 (per `docs/SPEC.md`'s Out of Scope section); this ADR does not commit to what, if anything, comes next.
- The three chosen languages are a deliberate paradigm spread, not a claim of covering "languages developers use AI assistants for" exhaustively or representatively. A future fourth language should still be evaluated on its own merits, not assumed in-scope just because the abstraction already exists.

## Confirmation

- No code implements this yet as of this writing; there is no automated check to point to today.
- Once built: the sandbox orchestration layer accepts a language parameter and dispatches to one of three pinned images (ADR-0005), rather than hardcoding a Rust/cargo invocation. Schema/migration review confirms Concept Graph concept IDs carry a language namespace. The shared integration-test seam (ADR-0002, `docs/SPEC.md`) exercises exercise generation and pre-flight validation against all three languages, not Rust alone, before v1 is considered complete.

## Relationships and References

- Related to: [ADR-0005](./0005-docker-sandbox-isolation.md) — one pinned sandbox image per language is the concrete implementation of this ADR's per-language runtime abstraction requirement.
- Related to: [ADR-0002](./0002-both-tracks-in-v1.md) — the shared integration-test seam both ADRs rely on must cover all three languages, not just both tracks.
- Related to: [ADR-0001](./0001-single-user-mvp-multi-user-ready-data-model.md) — same "pay the abstraction cost now, before real content/data exists" reasoning, applied to language instead of learner scoping.
- Supporting evidence: [docs/INITIAL_PRD.md](../INITIAL_PRD.md) (target-audience framing, line 12; Rust-only worked examples); [docs/SPEC.md](../SPEC.md) ("Concept Graph authorship"; "Out of scope: Any language beyond Rust, Go, Python").
- Owning implementation package: none yet — no code implements this as of this writing.
