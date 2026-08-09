# Product Requirement Document (PRD)

## 1. Executive Summary & Vision

* **Product Name:** AI Learning Platform (Working Title)
* **Core Vision:** An interactive, AI-driven learning ecosystem designed to eliminate **AI-induced cognitive debt**. It converts passive code review into active mastery by pairing students with an AI Teacher, isolated compilation sandboxes, and adversarial problem-solving mechanics.

---

## 2. Problem Statement & User Personas

* **Target Audience:** Developers and builders using AI coding assistants (e.g., Cursor, Claude, Copilot) who regularly cross-check generated code in languages or paradigms they do not fully master.

* **The Problem:** Handing off implementation work to AI creates "cognitive debt"—developers become code reviewers for logic they cannot debug or fully comprehend. Existing learning sites (e.g., W3Schools) are too passive, boring, or rely on trivial multiple-choice exercises.

---

## 3. Core Architecture & Functional Requirements

```text
                                  ┌─────────────────────────┐
                                  │     USER DASHBOARD      │
                                  └────────────┬────────────┘
                                               │
                       ┌───────────────────────┴───────────────────────┐
                       ▼                                               ▼
            [ CLASS A: STRUCTURED ]                         [ CLASS B: TACTICAL JIT ]
        Sequential Curriculum Path                      Snippet-to-Micro-Lesson Extraction
                       │                                               │
                       └───────────────────────┬───────────────────────┘
                                               │
                                               ▼
                                  ┌─────────────────────────┐
                                  │    AI TEACHER ENGINE    │
                                  │  • N-Depth Explanation  │
                                  │  • Pre-Flight Check     │
                                  └────────────┬────────────┘
                                               │
                                               ▼
                                  ┌─────────────────────────┐
                                  │    EVALUATION ENGINE    │
                                  │  Stage 1: Compiler      │
                                  │  Stage 2: Code Review   │
                                  └────────────┬────────────┘
                                               │
                                               ▼
                                  ┌─────────────────────────┐
                                  │  SPACED REFRESHER TEST  │
                                  │  (Unlocks Permanent)    │
                                  └─────────────────────────┘
```

### 3.1. Dual-Track Learning System

#### 1. Class A: Structured Path (The Long Game)

* Sequentially builds topic pathways from beginner to advanced.
* Generates custom lesson plans, quizzes, and sandbox exercises.

#### 2. Class B: Tactical Sprint (Just-In-Time)

* Triggered when a user pastes an AI-generated snippet they do not understand.
* Extracts underlying concept primitives and builds a targeted 5-to-10-minute sandbox puzzle.

#### 3. Class Synchronization & Spaced Refresher Engine

* **Concept Mastery Index:** Passing Class B sprints grants provisional progress toward Class A curriculum checkmarks.
* **Refresher Requirement:** Progress granted via Class B or initial Class A completion remains marked as *"Practiced"* until the student passes a scheduled **Refresher Test**.
* **Retake Policy:** If a student fails the Refresher Test, the module status reverts, requiring them to review the lesson and retake the exercise.

---

### 3.2. Adaptive Depth Engine (N-Parameter)

* Dynamic parameter (`N`) allowing the student to adjust explanation complexity and analogies on demand.
* Supports age-based simplicity (e.g., ELI5) or domain-specific analogies (e.g., *"Explain like I'm a Senior JavaScript dev learning Rust"*).

---

### 3.3. Interactive Sandbox & Adversarial AI

* **Real Compiler Execution:** Code runs inside isolated execution containers equipped with native tools (e.g., `cargo test`).
* **Adversarial Teacher:** The AI intentionally injects bugs, subtle race conditions, or broken contracts to force deep debugging.

---

## 4. Evaluation Pipeline & Pedagogical Rules

### 4.1. Two-Tier Evaluation Pipeline

```text
[ Code Submission ] ──> [ STAGE 1: Compiler / Tests ] ──(Fails)──> [ Socratic Hints ]
                                   │
                                (Passes)
                                   ▼
                        [ STAGE 2: AI Code Review ] ──(Smelly)─> [ Refactor Request ]
                                   │
                                (Clean)
                                   ▼
                           [ Topic Progress Granted ]
```

* **Stage 1: Deterministic Engine (Hard Test)**

  * Runs standard unit tests and compiler commands.
  * Evaluates pass/fail using deterministic execution results.

* **Stage 2: LLM Code Reviewer (Qualitative Check)**

  * Evaluates code style, AST patterns, hacky workarounds (e.g., `.unwrap()` abuse), and language idioms.
  * Rejects code that violates exercise-specific qualitative requirements even if Stage 1 passes.

---

### 4.2. Socratic Hint Engine

The AI Teacher must prevent premature solution disclosure.

Hints escalate progressively according to the rules defined in **Section 19 — Socratic Hint Engine**.

The system should record hint usage because solving a problem after receiving substantial assistance provides different evidence of mastery than solving it independently.

---

## 5. System Safety & Reliability Guardrails

| **Guardrail**                  | **Specification**                                                                                                            | **Purpose**                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **Pre-Flight Validation**      | Every generated exercise must pass reference-solution, compilation, test, and expected-failure validation before deployment. | Prevents unsolvable or hallucinated exercises.                     |
| **Generation Circuit Breaker** | Each exercise may undergo a maximum of three generation/pre-flight attempts.                                                 | Prevents infinite generation loops and repeated invalid exercises. |
| **Execution Timeout**          | Sandbox container processes are forcibly killed after 10 seconds.                                                            | Prevents memory leaks, infinite loops, and resource abuse.         |
| **Prompt Shield Filter**       | A secondary guardrail inspects LLM responses before rendering.                                                               | Prevents prompt injection and unauthorized solution leakage.       |

### 5.1. Sandbox Resource Controls

The sandbox should additionally enforce:

* CPU limits;
* memory limits;
* process/PID limits;
* network isolation;
* filesystem isolation;
* output size limits;
* ephemeral workspaces;
* automatic cleanup.

Example initial limits:

```yaml
sandbox:
  timeout: 10s
  memory: 512MB
  cpu: 1
  pids: 64
  network: disabled
  output_limit: 1MB
  filesystem: ephemeral
```

### 5.2. Exercise Generation Failure Handling

Exercise generation must use a bounded retry strategy.

Each generated exercise may undergo a maximum of **three pre-flight attempts**.

Each retry must receive structured diagnostics from the previous failed attempt, including:

* compiler errors;
* test failures;
* reference-solution failures;
* constraint violations;
* unexpected runtime behavior.

The generation pipeline is:

```text
                    ┌───────────────────┐
                    │ Exercise Generate │
                    └─────────┬─────────┘
                              │
                              ▼
                    ┌───────────────────┐
                    │    Pre-Flight     │
                    └─────────┬─────────┘
                              │
                     ┌────────┴────────┐
                     │                 │
                   PASS              FAIL
                     │                 │
                     ▼                 ▼
                  Deploy             Retry
                                       │
                              ┌────────┴────────┐
                              │                 │
                            PASS              FAIL
                              │                 │
                              ▼                 ▼
                           Deploy             Retry
                                                 │
                                        ┌────────┴────────┐
                                        │                 │
                                      PASS              FAIL
                                        │                 │
                                        ▼                 ▼
                                     Deploy        Circuit Breaker
```

After the third failure:

1. The generated exercise is discarded.
2. The failure is recorded for observability.
3. The system attempts a fallback strategy.
4. If a previously verified exercise targeting the same concept exists, it may be selected instead.
5. Otherwise, the system returns to exercise generation using a simplified constraint set.

The learner must **never** receive an exercise that has failed pre-flight validation.

Repeated generation failures for the same concept should be surfaced as an engineering/quality signal rather than silently retried indefinitely.

---

## 14. Pre-Flight Validation

Every generated programming exercise must undergo validation before deployment.

```text
Exercise Generation
       ↓
Reference Solution
       ↓
Compilation
       ↓
Tests
       ↓
Expected Failure Verification
       ↓
Difficulty Validation
       ↓
Deploy
```

The system must verify that:

1. the reference solution compiles;
2. the reference solution passes required tests;
3. the intended broken state actually fails;
4. the failure corresponds to the target concept;
5. the exercise is solvable within its constraints.

Invalid exercises must never reach the learner.

**Failure handling, retry limits, diagnostics, fallback strategies, and circuit-breaker behavior are defined exclusively in Section 5.2 — Exercise Generation Failure Handling.**

---

## 19. Socratic Hint Engine

The platform should prevent premature solution disclosure while ensuring that learners do not remain indefinitely stuck.

Hints escalate progressively:

```text
Level 0
Conceptual question

Level 1
Relevant observation

Level 2
Relevant language/domain rule

Level 3
Targeted implementation guidance

Level 4
Partial solution

Level 5
Full solution
```

The default progression is:

```text
0 → 1 → 2 → 3 → 4
```

A full solution requires explicit learner escalation.

The system should record hint usage because solving a problem after receiving substantial assistance provides different evidence of mastery than solving it independently.

### 19.1. Adaptive Hint Escalation

Hint progression should be driven by learner behavior rather than elapsed time alone.

Signals include:

* repeated identical compiler errors;
* repeated failed submissions;
* prolonged inactivity;
* lack of measurable progress;
* repeated requests for the same clarification.

The system may automatically increase the hint level when these signals indicate unproductive struggle.

The learner may manually request the next hint level at any time.

### 19.2. Session Duration

The 5-to-15-minute duration of Tactical Learning sessions is a **target**, not a strict execution deadline.

If the learner remains stuck beyond the expected duration, the system may:

* escalate the hint level;
* simplify the task;
* reduce the exercise scope;
* offer a short conceptual remediation;
* allow the learner to defer the exercise.

The system should record excessive struggle as learner-model evidence rather than treating it solely as failure.


#### Adaptive Hint Escalation

Hint progression should be driven by learner behavior rather than elapsed time alone.

Signals include:

* repeated identical compiler errors;
* repeated failed submissions;
* prolonged inactivity;
* lack of measurable progress;
* repeated requests for the same clarification.

The system may automatically increase the hint level when these signals indicate unproductive struggle.

The learner may manually request the next hint level at any time.

#### Session Duration

The 5-to-15-minute duration of Tactical Learning sessions is a **target**, not a strict execution deadline.

If the learner remains stuck beyond the expected duration, the system may:

* escalate the hint level;
* simplify the task;
* reduce the exercise scope;
* offer a short conceptual remediation;
* allow the learner to defer the exercise.

The system should record excessive struggle as learner-model evidence rather than treating it solely as failure.

---

## 5. System Safety & Reliability Guardrails

| **Guardrail**                  | **Specification**                                                                                    | **Purpose**                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Pre-Flight Validation**      | Before sending an adversarial task, the AI generates a reference fix and silently runs `cargo test`. | Prevents unsolvable or hallucinated bugs.                                    |
| **Generation Circuit Breaker** | Each exercise may undergo a maximum of three generation/pre-flight attempts.                         | Prevents infinite generation loops and repeated invalid exercises.           |
| **Execution Timeout**          | Sandbox container processes are forcibly killed after 10 seconds.                                    | Prevents memory leaks, infinite loops, and resource abuse.                   |
| **Prompt Shield Filter**       | A secondary guardrail inspects LLM responses before rendering.                                       | Prevents prompt injection and ensures zero unauthorized code solutions leak. |

### 5.1. Sandbox Resource Controls

The sandbox should additionally enforce:

* CPU limits;
* memory limits;
* process/PID limits;
* network isolation;
* filesystem isolation;
* output size limits;
* ephemeral workspaces;
* automatic cleanup.

Example initial limits:

```yaml
sandbox:
  timeout: 10s
  memory: 512MB
  cpu: 1
  pids: 64
  network: disabled
  output_limit: 1MB
  filesystem: ephemeral
```

---

### 5.2. Exercise Generation Failure Handling

Exercise generation must use a bounded retry strategy.

Each generated exercise may undergo a maximum of **three pre-flight attempts**.

Each retry must receive structured diagnostics from the previous failed attempt, including:

* compiler errors;
* test failures;
* reference-solution failures;
* constraint violations;
* unexpected runtime behavior.

The generation pipeline is:

```text
                    ┌───────────────────┐
                    │ Exercise Generate │
                    └─────────┬─────────┘
                              │
                              ▼
                    ┌───────────────────┐
                    │    Pre-Flight     │
                    └─────────┬─────────┘
                              │
                     ┌────────┴────────┐
                     │                 │
                   PASS              FAIL
                     │                 │
                     ▼                 ▼
                  Deploy             Retry
                                       │
                              ┌────────┴────────┐
                              │                 │
                            PASS              FAIL
                              │                 │
                              ▼                 ▼
                           Deploy             Retry
                                                 │
                                        ┌────────┴────────┐
                                        │                 │
                                      PASS              FAIL
                                        │                 │
                                        ▼                 ▼
                                     Deploy        Circuit Breaker
```

After the third failure:

1. The generated exercise is discarded.
2. The failure is recorded for observability.
3. The system attempts a fallback strategy.
4. If a previously verified exercise targeting the same concept exists, it may be selected instead.
5. Otherwise, the system returns to exercise generation using a simplified constraint set.

The learner must **never** receive an exercise that has failed pre-flight validation.

Repeated generation failures for the same concept should be surfaced as an engineering/quality signal rather than silently retried indefinitely.

---

## 6. Functional Summary Matrix

| **Feature**                    | **Implementation**                                                    | **Status** |
| ------------------------------ | --------------------------------------------------------------------- | ---------- |
| **Dual-Class Track**           | Class A (Curriculum) + Class B (JIT Sprints).                         | Approved   |
| **Spaced Refreshers**          | Mandatory refresher tests to convert progress to permanent pass.      | Approved   |
| **Depth Parameter (N)**        | Dynamic conceptual/analogy depth slider.                              | Approved   |
| **Sandbox Execution**          | Isolated container running real native compilers.                     | Approved   |
| **Evaluation Loop**            | Stage 1 (Compiler) → Stage 2 (Idiom/Smell Check).                     | Approved   |
| **Pre-Flight Pass**            | AI self-test pass before deploying adversarial challenges.            | Approved   |
| **Generation Circuit Breaker** | Maximum three pre-flight attempts with verified fallback behavior.    | Approved   |
| **Resource Shielding**         | 10s execution timeout + resource limits + output filtering.           | Approved   |
| **Adaptive Hint Escalation**   | Behavioral detection of unproductive struggle with manual escalation. | Approved   |
| **Retrieval Queue**            | Non-intrusive queue for concepts due for spaced retrieval.            | Approved   |

---

## 7. Concept Graph

The platform maintains a structured graph of programming concepts and their relationships.

Example:

```text
Rust
│
├── Ownership
│   ├── Move Semantics
│   ├── Borrowing
│   │   ├── Immutable Borrowing
│   │   └── Mutable Borrowing
│   └── Lifetimes
│
├── Traits
│   ├── Trait Bounds
│   └── Associated Types
│
└── Async
    ├── Future
    ├── Tokio Tasks
    ├── Send
    └── 'static
```

Each concept should define:

```yaml
concept:
  id: rust.async.send
  name: Send
  language: rust

  prerequisites:
    - rust.traits
    - rust.ownership

  related:
    - rust.async.future
    - rust.async.tokio_tasks

  difficulty: 4
```

The Concept Graph allows the system to determine:

* what the learner knows;
* what they should learn next;
* why an exercise is difficult;
* which prerequisite is likely missing.

---

## 8. Learner Model

The system tracks mastery at the individual-concept level rather than merely tracking completed lessons.

Concept states may include:

```text
Unknown
   ↓
Introduced
   ↓
Practiced
   ↓
Demonstrated
   ↓
Retained
```

The learner model should track:

* successful attempts;
* failed attempts;
* hint usage;
* time to solution;
* compiler errors;
* recurring mistakes;
* explanation accuracy;
* transfer-test performance;
* retention-test performance.

Example:

```text
Rust Borrowing

Practiced:        ✓
Demonstrated:     ✓
Transfer:         ✓
Retention:        ?
Confidence:       78%

Known Errors:
  - mutable/immutable aliasing
```

---

## 9. Learning Modes

### 9.1. Structured Learning

A sequential curriculum designed to build knowledge from prerequisites to advanced concepts.

```text
Curriculum
    ↓
Lesson
    ↓
Guided Exercise
    ↓
Independent Exercise
    ↓
Transfer Test
    ↓
Retention Schedule
```

The system may dynamically generate:

* explanations;
* examples;
* exercises;
* quizzes;
* debugging challenges;
* transfer problems.

The underlying curriculum remains anchored to the Concept Graph.

---

### 9.2. Tactical Learning

Tactical Learning is triggered by a user's real development context.

Example:

```rust
tokio::spawn(async move {
    process(data).await;
});
```

The system identifies relevant concepts:

```text
async/await
task spawning
ownership
Send
'static
concurrency
```

The system compares those concepts against the learner model.

If the learner has weak knowledge of `Send`, the platform creates a targeted exercise.

Example:

```text
Concept:
Rust Send

Estimated duration:
7 minutes

Task:
Determine why this value cannot be moved
into the spawned task.

Restriction:
Do not change the function signature.
```

The purpose is not to explain the pasted code indefinitely.

The purpose is to convert the unknown concept into **active practice**.

---

## 10. Tactical Learning → Structured Curriculum

Successful Tactical exercises may contribute evidence toward the corresponding structured curriculum concepts.

However, Tactical completion should not automatically mark the curriculum concept as mastered.

Example:

```text
Tactical Exercise
      │
      ▼
Practiced
      │
      ▼
Transfer Exercise
      │
      ▼
Demonstrated
      │
      ▼
Retention Test
      │
      ▼
Retained
```

This prevents learners from bypassing the curriculum while still allowing real-world work to accelerate learning.

---

## 11. AI Teacher Engine

The AI Teacher is responsible for generating:

* explanations;
* questions;
* hints;
* exercises;
* feedback;
* misconception analysis;
* qualitative code analysis.

The AI Teacher is **not** the authoritative evaluator.

The system should constrain AI output through:

* structured outputs;
* explicit policies;
* validation;
* deterministic execution;
* evaluation rubrics.

---

## 12. Adaptive Explanation Depth

The learner may specify an explanation depth.

Example:

```text
Depth 1 — Intuitive
Depth 2 — Beginner Technical
Depth 3 — Developer
Depth 4 — Advanced
Depth 5 — Runtime / Compiler Internals
```

The learner may additionally specify a reference frame:

> Explain Rust ownership to me as a senior JavaScript developer.

The system should use the learner's known concepts as analogical anchors.

The depth parameter affects presentation, not the underlying concept definition.

---

## 13. Exercise Generation

Exercises must be generated against explicit learning objectives.

Every exercise must specify:

```yaml
exercise:
  target_concepts:
    - rust.borrowing

  prerequisites:
    - rust.references

  difficulty: 3

  estimated_minutes: 8

  constraints:
    - no_unsafe
    - no_new_dependencies

  evaluation:
    tests:
      - ownership_test
      - borrowing_test
```

The exercise generator must not be allowed to produce an unverified exercise directly to the learner.

---

## 14. Pre-Flight Validation

Every generated programming exercise must undergo validation before deployment.

```text
Exercise Generation
       ↓
Reference Solution
       ↓
Compilation
       ↓
Tests
       ↓
Expected Failure Verification
       ↓
Difficulty Validation
       ↓
Deploy
```

The system must verify that:

1. the reference solution compiles;
2. the reference solution passes required tests;
3. the intended broken state actually fails;
4. the failure corresponds to the target concept;
5. the exercise is solvable within its constraints.

Invalid exercises must never reach the learner.

See **Section 5.2 — Exercise Generation Failure Handling** for bounded retry and fallback behavior.

---

## 15. Interactive Sandbox

All programming exercises execute inside an isolated sandbox.

Minimum requirements:

```text
CPU limit
Memory limit
Process/PID limit
Execution timeout
Network isolation
Filesystem isolation
Output size limit
Ephemeral workspace
Automatic cleanup
```

The sandbox must assume submitted code is malicious.

---

## 16. Evaluation Pipeline

The evaluation system uses multiple layers.

```text
                    Code Submission
                           │
                           ▼
                  ┌─────────────────┐
                  │ Compiler / Test │
                  └────────┬────────┘
                           │
                     ┌─────┴─────┐
                     │           │
                   FAIL         PASS
                     │           │
                     ▼           ▼
               Socratic       Qualitative
                 Hints         Evaluation
                                 │
                          ┌──────┴──────┐
                          │             │
                        FAIL          PASS
                          │             │
                          ▼             ▼
                      Refactor       Progress
```

---

## 17. Stage 1 — Deterministic Evaluation

The first evaluation layer must be deterministic whenever possible.

Examples:

* compilation;
* unit tests;
* integration tests;
* AST validation;
* forbidden API detection;
* dependency validation;
* runtime assertions;
* output verification.

Example:

```text
Exit code: 0
Tests: 17/17
Forbidden APIs: 0
Required behavior: PASS
```

This is the authoritative correctness layer.

---

## 18. Stage 2 — Qualitative Evaluation

An LLM may evaluate properties that are difficult to encode deterministically.

Examples:

* unnecessary complexity;
* conceptual misuse;
* inappropriate abstraction;
* readability;
* language idioms;
* explanation quality.

However, qualitative evaluation must only evaluate criteria relevant to the exercise.

For example:

> An ownership exercise should not fail because variable names are stylistically unconventional.

The reviewer must receive an explicit rubric.

```yaml
review:
  required:
    - demonstrates_borrowing
    - avoids_unnecessary_clone

  prohibited:
    - unsafe

  advisory:
    - naming
    - formatting
```

Only `required` and `prohibited` criteria affect pass/fail.

---

## 19. Socratic Hint Engine

The platform should prevent premature solution disclosure while ensuring that learners do not remain indefinitely stuck.

Hints escalate progressively:

```text
Level 0
Conceptual question

Level 1
Relevant observation

Level 2
Relevant language/domain rule

Level 3
Targeted implementation guidance

Level 4
Partial solution

Level 5
Full solution
```

The default progression is:

```text
0 → 1 → 2 → 3 → 4
```

A full solution requires explicit learner escalation.

The system should record hint usage because solving a problem after receiving substantial assistance provides different evidence of mastery than solving it independently.

### 19.1. Adaptive Hint Escalation

Hint progression should be driven by learner behavior rather than elapsed time alone.

Signals include:

* repeated identical compiler errors;
* repeated failed submissions;
* prolonged inactivity;
* lack of measurable progress;
* repeated requests for the same clarification.

The system may automatically increase the hint level when these signals indicate unproductive struggle.

The learner may manually request the next hint level at any time.

### 19.2. Session Duration

The 5-to-15-minute duration of Tactical Learning sessions is a **target**, not a strict execution deadline.

If the learner remains stuck beyond the expected duration, the system may:

* escalate the hint level;
* simplify the task;
* reduce the exercise scope;
* offer a short conceptual remediation;
* allow the learner to defer the exercise.

The system should record excessive struggle as learner-model evidence rather than treating it solely as failure.

---

## 20. Adversarial Exercises

The platform may intentionally introduce defects into exercises.

Examples:

* incorrect ownership;
* race conditions;
* broken error handling;
* incorrect lifetime assumptions;
* invalid concurrency;
* subtle API misuse;
* incorrect database transaction behavior;
* broken invariants.

Adversarial exercises must always have:

```text
Known defect
Known concept
Known reference solution
Known expected behavior
Verified tests
```

The AI must not invent arbitrary bugs without verification.

---

## 21. Explanation Assessment

The platform should periodically ask the learner to explain concepts in their own words.

Example:

> Why does `tokio::spawn` impose `Send + 'static` requirements?

The learner submits an explanation.

The AI evaluator compares the explanation against the Concept Graph.

The system should detect:

* missing concepts;
* incorrect claims;
* misconceptions;
* conflated concepts;
* superficial explanations.

This provides a second measurement channel beyond code execution.

---

## 22. Transfer Testing

Passing an exercise does not establish conceptual mastery.

The system should periodically generate a structurally different problem targeting the same concept.

Example:

```text
Exercise A:
Fix a borrowing error.

Exercise B:
Implement a function using references.

Exercise C:
Debug a collection API.

Exercise D:
Explain why a reference is invalid.
```

The objective is to test whether the learner can apply the concept outside the original exercise pattern.

---

## 23. Spaced Retrieval

The platform must periodically reassess previously learned concepts to measure retention.

Retrieval should be **ambient and user-initiated by default**, rather than interrupting active development sessions.

### 23.1. Retrieval Queue

The Learner Model maintains a queue of concepts eligible for review.

The queue considers:

* time since last successful retrieval;
* previous retrieval performance;
* hint dependency;
* transfer performance;
* observed misconceptions;
* concept importance.

Example:

```text
Retrieval Queue

High Priority
  Rust Send              ~4 min
  Failed previous review

Due
  Rust Borrowing         ~5 min
  Due today

Upcoming
  Rust Traits            ~6 min
  Due tomorrow
```

### 23.2. Retrieval Entry Points

Retrieval may be initiated through:

* the learning dashboard;
* an optional daily review session;
* completion of another learning activity;
* future IDE/editor integrations.

The system should not interrupt active development by default.

### 23.3. Retrieval Formats

A retrieval assessment does not always require a full coding exercise.

Depending on the concept and available evidence, the system may use:

* free-form explanation;
* debugging;
* code prediction;
* multiple-choice conceptual discrimination;
* code completion;
* implementation;
* transfer exercises.

The assessment format should be selected based on the evidence required from the learner.

### 23.4. Adaptive Scheduling

The initial schedule may use:

```text
Initial learning
      ↓
24 hours
      ↓
3 days
      ↓
7 days
      ↓
21 days
      ↓
60 days
```

Future versions should adapt intervals based on learner performance.

Successful retrieval increases the interval.

Failed retrieval decreases the interval and schedules targeted remediation.

### 23.5. Failure Handling

A failed retrieval does not erase the learner's history.

Instead:

```text
Retention Failure
      ↓
Identify Failed Concept
      ↓
Identify Misconception
      ↓
Targeted Remediation
      ↓
New Retrieval Assessment
```

The system should preserve previous evidence while lowering the current mastery estimate.

---

## 24. Success Metrics

The primary metric should not be the number of lessons completed.

The platform should measure whether it actually reduces cognitive debt.

### Primary Metrics

**Independent Solve Rate**

Percentage of exercises solved without hints.

**Transfer Success Rate**

Percentage of novel exercises successfully solved after learning a concept.

**Retention Rate**

Percentage of concepts successfully recalled after a defined interval.

**Explanation Accuracy**

Percentage of concept explanations without substantive misconceptions.

**Hint Dependency**

Average number and severity of hints required.

**Time-to-Mastery**

Time required to reach demonstrated/retained status.

---

## 25. Product Success Criterion

The MVP is successful if users demonstrate measurable improvement in their ability to independently work with code they previously relied on AI to understand.

The strongest validation experiment is:

```text
AI-generated code
       ↓
Can user explain it?
       ↓
Can user modify it?
       ↓
Can user debug it?
       ↓
Can user solve a different problem
using the same concept?
       ↓
Can user still do it later?
```

If the answer consistently changes from **no → yes**, the product is solving its intended problem.
