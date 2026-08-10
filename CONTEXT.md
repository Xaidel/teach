# AI Learning Platform

An interactive, AI-driven learning platform that converts AI-generated code a learner doesn't fully understand into active, evaluated practice — pairing an AI Teacher with a real sandboxed compiler/interpreter and a deterministic evaluation gate.

## Language

**AI Teacher Engine**:
The single AI-backed component responsible for explanations, hints, misconception analysis, Concept Graph drafting, and exercise generation. It is a generator, not an evaluator — it never has authority to pass or fail a learner's submission.
_Avoid_: Exercise Generator (not a separate component — generation is a Teacher Engine responsibility)

**Pre-Flight Validation**:
The deterministic, non-AI-authored gate every generated exercise must pass (reference solution compiles, tests pass, intended failure actually fails) before a learner can see it. Runs independently of the AI Teacher Engine so the model that generated an exercise never grades its own output.

**Concept Graph**:
The per-language graph of programming concepts and their prerequisite/related relationships (e.g. `rust.async.send`), stored in Postgres as adjacency data, not a graph database. Drafted by the AI Teacher Engine per language, then structurally reviewed (see Review Status) rather than hand-authored from scratch — usability is governed by Concept Validation, not by review.

**Review Status**:
A concept's `draft`/`approved` marker, set by the learner reviewing the Concept Graph for structural soundness (naming, prerequisite sanity, plausible difficulty) — never for domain/technical correctness, which the learner (being the platform's only reviewer and its only student) can't be assumed to verify. Purely a personal tracking flag: it never gates whether Class A or Class B can use a concept.
_Avoid_: Approval status, published/unpublished, draft/live

**Concept Validation**:
The deterministic cycle-detection and dangling-reference check run against the Concept Graph whenever a concept or edge is drafted — distinct from Pre-Flight Validation, which gates exercises rather than concepts. A concept or edge that fails is excluded from Class A/Class B use until fixed, regardless of its Review Status. This, not Review Status, is what actually governs whether a concept is usable.
_Avoid_: Graph validation, integrity check

**Class A**:
The Structured Path track — sequential curriculum built from the Concept Graph, prerequisites to advanced.
_Avoid_: Structured Learning, Curriculum Track

**Class B**:
The Tactical Sprint track — a targeted 5-to-10-minute exercise triggered by a learner pasting an AI-generated snippet they don't understand.
_Avoid_: Tactical Learning, JIT Track

**Learner**:
The person using the platform. v1 is single-user (the platform's author), but every learner-scoped entity (Learner Model, attempt history, hint usage) is modeled as belonging to a learner from the start, not added later.
_Avoid_: User, Student (product name uses "learner" throughout the PRD's Learner Model section)

**Sandbox**:
An ephemeral, per-submission Docker container (one pinned image per v1 language: Rust/cargo, Go, Python) enforcing the Section 5.1 resource limits, orchestrated by the TanStack Start backend and running on the local machine for v1.
_Avoid_: Execution container, Isolated environment

**Pinned Image**:
The one Docker image per v1 language a Sandbox is created from — built from an in-repo Dockerfile to a fixed local tag, pre-compiled at build time against a fixed dependency set so a Sandbox run only compiles the learner's own submission.
_Avoid_: Base image, sandbox image

**Sandbox Workspace**:
The ephemeral per-run host directory bind-mounted into a Sandbox container — holds the learner's submission and the exercise's test harness going in, and the Sandbox Result coming back out. Created and destroyed alongside its Sandbox.
_Avoid_: Workspace, temp dir, mount

**Sandbox Result**:
The normalized, language-independent pass/fail + diagnostics shape a Sandbox run produces, built by a per-language normalizer over that language's native structured test output. Consumed identically by Stage 1 and the Socratic Hint Engine.
_Avoid_: Test output, normalized output

**Stage 1**:
The deterministic compile/test-execution gate — a submission passes only if its Sandbox Result shows every required test passing. Authoritative; never overridden by AI judgment.
_Avoid_: Tier 1, deterministic gate

**Stage 2**:
The qualitative rubric gate run after Stage 1 passes — flags exercise-specific required/prohibited code patterns (e.g. unnecessary `.unwrap()`) that Stage 1 can't encode deterministically.
_Avoid_: Tier 2, qualitative gate, rubric check

**Socratic Hint Engine**:
The AI Teacher Engine capability that turns a Stage 1 failure's Sandbox Result into escalating Socratic hints, rather than surfacing the raw compiler/test error directly.
_Avoid_: Hint Engine, hint generator
