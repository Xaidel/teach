# AI Learning Platform

An interactive, AI-driven learning platform that converts AI-generated code a learner doesn't fully understand into active, evaluated practice — pairing an AI Teacher with a real sandboxed compiler/interpreter and a deterministic evaluation gate.

## Language

**AI Teacher Engine**:
The single AI-backed component responsible for explanations, hints, misconception analysis, Concept Graph drafting, and exercise generation. It is a generator, not an evaluator — it never has authority to pass or fail a learner's submission.
_Avoid_: Exercise Generator (not a separate component — generation is a Teacher Engine responsibility)

**Pre-Flight Validation**:
The deterministic, non-AI-authored gate every generated exercise must pass (reference solution compiles, tests pass, intended failure actually fails) before a learner can see it. Runs independently of the AI Teacher Engine so the model that generated an exercise never grades its own output.

**Concept Graph**:
The per-language graph of programming concepts and their prerequisite/related relationships (e.g. `rust.async.send`), stored in Postgres as adjacency data, not a graph database. Drafted by the AI Teacher Engine per language, then human-reviewed rather than hand-authored from scratch.

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
An ephemeral, per-submission Docker container (one pinned image per v1 language: Rust/cargo, Go, Python) enforcing the Section 5.1 resource limits, orchestrated by the Node backend and running on the local machine for v1.
_Avoid_: Execution container, Isolated environment
