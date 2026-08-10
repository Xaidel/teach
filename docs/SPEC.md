# AI Learning Platform — v1 Spec

Synthesized from `docs/INITIAL_PRD.md`, the `grill-with-docs` session recorded in `CONTEXT.md` and `docs/adr/0001`–`0008`. No new interview was run to produce this — it restates what was already decided.

## Problem Statement

Developers who lean on AI coding assistants (Cursor, Claude, Copilot) end up reviewing code in languages or paradigms they don't fully master, rather than writing it. They accumulate "cognitive debt": they can accept or reject AI output, but they can't independently debug, modify, or explain it. Existing learning sites are too passive (multiple-choice, no real compiler feedback) to close that gap, and nothing today turns a specific AI-generated snippet a learner doesn't understand into targeted, evaluated practice.

## Solution

A learner-facing web app pairs an AI Teacher Engine with a real sandboxed compiler/interpreter and a deterministic evaluation gate, across two converging tracks: a Structured Path (Class A) that builds a language's concepts sequentially, and a Tactical Sprint (Class B) that turns a pasted AI-generated snippet into a 5-to-10-minute targeted exercise on the concept the learner is weakest on. Both tracks feed one Learner Model and one Concept Graph per language (Rust, Go, Python at launch), and progress only becomes permanent after a learner passes a spaced Refresher Test — closing the gap between "solved it once" and "actually retained it."

## User Stories

### Structured Path (Class A)

1. As a learner, I want a sequential curriculum per language, built from the Concept Graph's prerequisite order, so that I learn foundational concepts before advanced ones.
2. As a learner, I want each curriculum step to generate a lesson, a guided exercise, an independent exercise, and a transfer test, so that I move from explanation to independent application.
3. As a learner, I want my Class A progress anchored to the Concept Graph, so that "what I know" is always expressed in terms of concepts, not lesson checkboxes.

### Tactical Sprint (Class B)

4. As a learner, I want to paste an AI-generated code snippet I don't understand, so that the platform can identify which concepts it depends on.
5. As a learner, I want the platform to compare the snippet's concepts against my Learner Model and target the one I'm weakest on, so that I don't get a generic lesson on code I already understand.
6. As a learner, I want the resulting exercise scoped to 5–10 minutes and restricted (e.g. "don't change the function signature"), so that it stays tactical rather than open-ended.
7. As a learner, I want the platform to stop trying to explain the pasted snippet indefinitely and instead convert it into an active exercise, so that I practice rather than passively read.

### Class Synchronization & Spaced Refresher

8. As a learner, I want a passed Class B sprint to grant provisional ("Practiced") progress toward the matching Class A concept, so that real-world work accelerates my curriculum.
9. As a learner, I want that provisional progress to remain "Practiced" (not permanent) until I pass a scheduled Refresher Test, so that I can't bypass the curriculum by only ever doing quick tactical sprints.
10. As a learner, if I fail a Refresher Test, I want my module status to revert and require me to review the lesson and retake the exercise, so that stale mastery claims get corrected rather than silently kept.

### Adaptive Explanation Depth

11. As a learner, I want to set an explanation depth (1–5, from Intuitive to Runtime/Compiler Internals), so that explanations match my current level.
12. As a learner, I want to give the AI Teacher a reference frame (e.g. "explain this to me as a senior JavaScript developer"), so that explanations use analogies anchored to what I already know.
13. As a learner, I want changing depth to affect only presentation, not the underlying concept definition, so that I'm never getting a materially different (and possibly wrong) explanation at different depths.

### Sandbox Execution

14. As a learner, I want my code to run in a real compiler/interpreter (`cargo test` for Rust, `go test` for Go, `pytest` for Python) inside an isolated container, so that pass/fail feedback is authoritative, not simulated.
15. As the platform, I want every sandbox run capped at a 10-second execution timeout, so that infinite loops or hangs can't exhaust resources.
16. As the platform, I want every sandbox container to enforce CPU limits, memory limits (512MB default), PID limits (64 default), disabled networking, an ephemeral read-only filesystem, and a 1MB output cap, so that submitted code — assumed malicious — cannot escape or exhaust the host.
17. As the platform, I want every sandbox workspace destroyed automatically after the run, so that no learner's submission persists in a shared execution environment.

### Two-Tier Evaluation

18. As a learner, when my code fails compilation or tests (Stage 1), I want Socratic hints rather than the raw compiler error dumped at me, so that I'm guided toward the fix rather than just told it failed.
19. As a learner, when my code passes Stage 1 but violates the exercise's qualitative rubric (Stage 2 — e.g. unnecessary `.unwrap()`, missed idiom), I want a refactor request explaining what's wrong, so that passing tests isn't the only bar for completing an exercise.
20. As a learner, I want Stage 2's rubric to only fail me on criteria explicitly marked `required` or `prohibited` for that exercise, so that an ownership exercise never fails me for unrelated style nits.
21. As the platform, I want Stage 1 to remain the authoritative, deterministic layer and Stage 2 to only evaluate what Stage 1 cannot encode deterministically, so that pass/fail is never solely an LLM's opinion.

### Socratic Hint Engine

22. As a learner, I want hints to escalate through six levels (0: conceptual question → 5: full solution) rather than jump straight to an answer, so that I'm not handed a solution I didn't work for.
23. As a learner, I want the default progression to stop at Level 4 (partial solution) and require me to explicitly ask for Level 5 (full solution), so that I have to deliberately opt into seeing the answer.
24. As a learner, I want to manually request the next hint level at any time, so that I control my own pace through the ladder.
25. As the platform, I want every hint level served recorded against that exercise attempt, so that "solved independently" and "solved after 4 hints" are distinguishable evidence of mastery.
26. As the platform, in v1, I want hint escalation to be manual-only (learner-requested), with automatic escalation from behavioral signals (repeated errors, inactivity, stalled progress) deferred, so that we ship the ladder without guessing at struggle-detection thresholds before we have usage data.

### AI Teacher Engine & Exercise Generation

27. As the platform, I want the AI Teacher Engine to be the sole generator of explanations, hints, exercises, feedback, misconception analysis, and qualitative code review, so that generation logic lives in one place.
28. As the platform, I want the AI Teacher Engine to never be the authoritative evaluator of a submission, so that a model cannot grade its own generated exercise.
29. As the platform, I want every exercise generated with an explicit target concept, prerequisites, difficulty, estimated duration, constraints, and an evaluation rubric (tests + Stage 2 required/prohibited/advisory criteria), so that generation is always scoped, not free-form.
30. As the platform, I want the AI Teacher Engine's calls made through an OpenAI-compatible client interface with reasoning effort dialed per task (higher for generation/review, lower for hints), rather than routing different tasks to different vendors, so that the integration layer stays swappable and simple.

### Pre-Flight Validation & Failure Handling

31. As the platform, I want every generated exercise to pass reference-solution compilation, reference-solution tests, verified expected-failure, and difficulty validation before a learner ever sees it, so that learners never receive an unsolvable or hallucinated exercise.
32. As the platform, I want a failed pre-flight attempt to feed structured diagnostics (compiler errors, test failures, constraint violations) into the next generation attempt, so that retries are informed, not blind repeats.
33. As the platform, I want generation capped at 3 pre-flight attempts per exercise, so that a bad generation can't loop indefinitely.
34. As the platform, after 3 failed attempts, I want to fall back to a previously-verified exercise on the same concept if one exists, or regenerate with a simplified constraint set if not, so that a learner is never blocked by a single failed generation.
35. As the platform, I want every pre-flight failure recorded for observability, and repeated failures on the same concept surfaced as a quality signal, so that systemic generation problems are visible rather than silently retried forever.

### Prompt Shield

36. As the platform, I want AI Teacher output checked for solution leakage before rendering — deterministically, via substring/near-match comparison against the pre-flight-verified reference solution, gated by the learner's current hint level — so that a Level 2 hint can never accidentally contain the Level 5 answer.
37. As the platform, I want this check to run without an additional model call, so that leakage detection doesn't add LLM cost or non-determinism to every response.

### Concept Graph

38. As the platform, I want a Concept Graph per v1 language (Rust, Go, Python) with prerequisites, related concepts, and difficulty, so that the platform can determine what a learner should learn next and why an exercise is hard.
39. As the platform, I want each language's Concept Graph initially drafted by the AI Teacher Engine and then human-reviewed, rather than hand-authored from scratch, so that curriculum content isn't a blocking upfront authoring project.
40. As the platform, I want the Concept Graph stored as relational/adjacency data in Postgres, not a separate graph database, so that it's queried and migrated with the rest of the platform's data.

### Learner Model

41. As the platform, I want per-concept mastery tracked through five states (Unknown → Introduced → Practiced → Demonstrated → Retained), so that mastery is concept-level, not lesson-completion-level.
42. As the platform, I want the Learner Model to track successful/failed attempts, hint usage, time to solution, compiler errors, recurring mistakes, explanation accuracy, transfer performance, and retention performance, so that later scheduling and remediation decisions have real evidence behind them.
43. As the platform, I want every learner-scoped table to carry a learner identifier from v1 onward, even though v1 has exactly one learner, so that multi-user support later doesn't require a schema migration.

### Explanation Assessment & Transfer Testing

44. As a learner, I want to periodically be asked to explain a concept in my own words, so that the platform can catch misconceptions that passing code alone wouldn't reveal.
45. As the platform, I want explanations compared against the Concept Graph to detect missing concepts, incorrect claims, and conflated ideas, so that "explained it" is itself a scored signal.
46. As a learner, I want to periodically face a structurally different exercise on a concept I've already passed (debugging vs. implementing vs. explaining), so that passing one exercise pattern isn't mistaken for conceptual mastery.

### Spaced Retrieval

47. As a learner, I want a Retrieval Queue of concepts due for review, prioritized by recency, past performance, hint dependency, and importance, so that I know what to review and why.
48. As a learner, I want retrieval to be ambient and user-initiated (dashboard, optional daily review, or after finishing another activity) rather than interrupting my active work, so that spaced repetition doesn't intrude on real development sessions.
49. As the platform, I want the initial retention schedule fixed (24h → 3d → 7d → 21d → 60d), with adaptive interval scheduling by performance deferred to a later version, so that v1 ships a working schedule without needing a tuned adaptive algorithm first.
50. As a learner, when I fail a retrieval assessment, I want my prior history preserved (not erased) while my current mastery estimate lowers and I'm routed to targeted remediation, so that one bad review doesn't wipe out earned progress.

### Adversarial Exercises

51. As a learner, I want some exercises to intentionally contain a known, verified defect (bad ownership, a race condition, a broken invariant) rather than start from correct code, so that I practice debugging, not just first-time implementation.
52. As the platform, I want every adversarial exercise to have a known defect, known target concept, known reference solution, and verified tests — never an invented, unverified bug — so that adversarial exercises go through the same Pre-Flight gate as any other exercise.

## Implementation Decisions

- **Stack**: TypeScript full-stack — a single TanStack Start (React) application; API and Docker sandbox orchestration live in server functions and server-only feature modules within it, not a separate backend service. (ADR-0009, superseding ADR-0006)
- **Storage**: Postgres for all persistent data — Concept Graph, Learner Model, Retrieval Queue — via Drizzle ORM. No graph database. (ADR-0007)
- **Core schema**: `learners` (seeded, 1 row for v1) plus `concepts`/`concept_edges` (adjacency, `kind` enum), `learner_concept_mastery` (current-state only), `attempts`/`attempt_hints` (per-hint-level timing), `exercises`/`exercise_concepts` (multi-concept join, `status` lifecycle enum — Explanation Assessment and Transfer Testing reuse this via a `mode` enum rather than separate tables), `retrieval_queue` (materialized, synchronous upsert), and `pre_flight_attempts` (generation-time log, keyed by concept). All surrogate keys are UUIDv7 by default. (ADR-0010)
- **Sandbox**: Docker containers, one pinned image per v1 language (Rust/cargo, Go, Python). Resource limits enforced via container runtime flags (`--memory`, `--pids-limit`, `--network none`, read-only/tmpfs rootfs), per the PRD's Section 5.1 defaults (512MB memory, 1 CPU, 64 PIDs, 10s timeout, network disabled, 1MB output cap, ephemeral filesystem). (ADR-0005)
- **Sandbox orchestration**: `dockerode` (Docker Engine API client), not CLI shell-out. One ephemeral container per submission — never pooled/reused — with each Pinned Image pre-compiled at build time against a fixed dependency set so a run only compiles the learner's own file. Code enters and results exit via a bind-mounted Sandbox Workspace (a per-run host temp directory, lifecycle-matched to its container). Every container gets a deterministic name; the 10s timeout is enforced by an explicit watchdog calling `.kill()` directly, with `.remove()` always run in a `finally` regardless of outcome. Each language's native structured test-output format is kept as-is (`go test -json`, `cargo-nextest`'s JUnit XML, pytest's `--junit-xml`) and mapped by a per-language normalizer into one shared Sandbox Result shape (`{ passed, tests: [{ name, status, message?, output? }] }`) that Stage 1 and the Socratic Hint Engine both consume. Each pinned image is one in-repo Dockerfile (`sandbox/<lang>/Dockerfile`) built to a fixed local tag, bumped when the Dockerfile changes. (ADR-0011; resolved as wayfinder ticket [#24](https://github.com/Xaidel/teach/issues/24) on the [AI Learning Platform v1 map](https://github.com/Xaidel/teach/issues/21).)
- **Deployment**: Runs on the local machine for v1 — the TanStack Start server talks to the local Docker daemon. Orchestration code should not assume a local daemon specifically, so pointing it at a remote Docker host later is a config change, not a rewrite.
- **Local dev environment**: The app runs natively (`pnpm run dev`), not in Docker — it talks to the host Docker daemon directly, so Sandbox Workspace paths (ADR-0011) are already real host paths with no container boundary to bridge. Postgres runs via `docker-compose.yml` (single `postgres` service, pinned version, named volume). Sandbox images are built by an explicit `pnpm run sandbox:build` step during setup (and re-run on Dockerfile change), never lazily on first submission. Env config (`DATABASE_URL`, AI API key, AI API base URL) lives in a gitignored `.env` seeded from a checked-in `.env.example`, validated at startup by `src/lib/env.server.ts`; no external secrets manager for v1. `dockerode` uses its platform default Docker connection — no `DOCKER_HOST`-style var until a remote daemon is actually introduced. Migrations (`pnpm run db:migrate`, Drizzle Kit) and the single seeded `learners` row (`pnpm run db:seed`) are separate scripts. Fresh-setup sequence: `docker compose up -d` → `pnpm run db:migrate` → `pnpm run db:seed` → `pnpm run sandbox:build` → `pnpm run dev`. (ADR-0013; resolved as wayfinder ticket [#26](https://github.com/Xaidel/teach/issues/26) on the [AI Learning Platform v1 map](https://github.com/Xaidel/teach/issues/21).)
- **AI integration**: A single client built against an OpenAI-compatible API contract, used by the AI Teacher Engine for explanations, hints, exercise generation, and Stage 2 review. One model family; reasoning effort is the per-task dial (low for hints, high for generation/review), not vendor or model routing. (ADR-0004)
- **AI Teacher Engine responsibilities**: Owns generation (explanations, hints, exercises, feedback, misconception analysis, qualitative review, Concept Graph drafts). Never the pass/fail authority — Pre-Flight validation and Stage 1 execution are independent deterministic gates that run outside the Teacher Engine's control.
- **AI Teacher Engine interface contract**: One typed function per task (`explainConcept`, `generateHint`, `generateExercise`, `reviewSubmission`, `draftConceptGraph`, `analyzeMisconceptions`), each with its own zod-validated input/output schema, sharing one internal low-level call helper (auth, structured-output plumbing, validation, effort dial). Native structured outputs (`response_format: json_schema` / forced tool call) are the primary mechanism, still validated app-side with `zod` on receipt as defense-in-depth. `generateHint` takes prior hints served in this attempt as explicit input, so escalating levels don't repeat or contradict each other. `analyzeMisconceptions` is standalone and atomic (missing/incorrect/conflated concepts only); explanation accuracy score is computed deterministically app-side from its output, not by the model — exact formula left to ticket #16 when picked up. Reasoning effort is a fixed constant per task function (ADR-0004's low/hint, high/generation-review split), not caller-overridable in v1. Each task's prompt template lives in its own file, separate from its schema and function. On failure the client throws a typed `TeacherEngineError` (`api_error` | `invalid_output`) with no built-in retry — retry policy (e.g. Pre-Flight's 3-attempt cap, ticket #9) is owned per-caller, not baked into the client. (Resolved as wayfinder ticket [#23](https://github.com/Xaidel/teach/issues/23) on the [AI Learning Platform v1 map](https://github.com/Xaidel/teach/issues/21).)
- **Multi-user readiness**: Every learner-scoped table (attempts, hint usage, mastery state, retrieval queue entries) includes a learner identifier from the first migration, even though v1 runs with exactly one learner and no auth. (ADR-0001)
- **Explanation Assessment / Transfer Test cadence**: Both are required, independently and in no fixed order, before a concept is promoted from Practiced to Demonstrated — eligible as soon as the concept reaches Practiced, no exercise-count threshold. After Demonstrated, both can also recur as the *shape* of a scheduled spaced-retrieval review: each due review randomly selects among a normal exercise, an Explanation Assessment, or a Transfer Test (deliberately unpredictable, so a learner can't memorize which review will ask them to explain or transfer and prepare selectively), with a forced fallback on a concept's final (60-day) review if it has never drawn either shape by chance — guaranteeing every concept eventually produces both signal types for the Learner Model. A failed recurring review reuses the existing retrieval-assessment-failure behavior (history preserved, mastery estimate lowered, routed to remediation); a failed initial-gate attempt leaves the concept at Practiced with a retry, exact flow left to build tickets #16/#17. (ADR-0015; resolved as wayfinder ticket [#28](../../issues/28) on the [AI Learning Platform v1 map](../../issues/21).)
- **Single-learner session model**: No session/context layer in v1. A shared `getCurrentLearnerId()` helper resolves the current learner by querying the `learners` table (not a hardcoded/env constant) — the seam later swapped for real session resolution. Each top-level server function calls it once and threads the resolved `learnerId` down as a plain parameter to everything else it calls in that request; inner functions never re-resolve it. The helper throws (rather than defaulting) if `learners` holds zero rows (points the developer at `pnpm run db:seed`) or more than one row (contexts that legitimately seed multiple learners, e.g. lower-level schema/query tests, bypass the helper and pass `learner_id` explicitly instead). (ADR-0014; resolved as wayfinder ticket [#27](https://github.com/Xaidel/teach/issues/27) on the [AI Learning Platform v1 map](https://github.com/Xaidel/teach/issues/21).)
- **Prompt Shield**: Solution-leakage detection is a deterministic check — compare AI Teacher output against the Pre-Flight-verified reference solution, gated by current hint level — not a second LLM call. Prompt-injection detection (the other half of Section 5's guardrail) is left open; add an LLM-based check later only if the deterministic layer proves insufficient. (ADR-0008)
- **Prompt Shield near-match algorithm**: Fragment-level comparison — scans for any fragment of the Teacher's response that closely matches any fragment of the reference solution, not a whole-message score — checked per-hint (not cumulative across an attempt). Both texts are normalized (whitespace collapsed, comments stripped) then split by one minimal, language-agnostic lexer (token boundaries only, no per-language keyword awareness); closeness is token overlap, not edit distance or AST comparison. The block threshold is a percentage of that exercise's own solution length (with a small absolute floor), applied two-tier: near-zero tolerance at Levels 0–3 (no real code expected), a much higher tolerance (~40–50% starting point) at Level 4 (partial solution expected by design); Level 5 is unchecked. Explicitly accepted v1 gaps: renamed-variable leaks (identifier normalization not implemented), cumulative leakage across repeated same-level hint requests, and general paraphrase/restructuring (already named in ADR-0008). (ADR-0012; resolved as wayfinder ticket [#25](https://github.com/Xaidel/teach/issues/25) on the [AI Learning Platform v1 map](https://github.com/Xaidel/teach/issues/21).)
- **Concept Graph authorship**: AI-drafted per language by the Teacher Engine, then reviewed through an in-app UI (not a file-based import) — not hand-authored, not fully unreviewed. Review is structural only (naming, prerequisite sanity, plausible difficulty), never domain/technical verification, since the sole reviewer is also the platform's only learner. A `status` enum (`draft`/`approved`) on `concepts` tracks this but never gates usage — both states are fully live to Class A and Class B. The actual usability gate is a separate deterministic Concept Validation check (cycle detection + dangling-reference resolution, no LLM call); a concept/edge failing it is excluded from use regardless of status. Launch scope is broad coverage per language, not just a worked-example strand. When Class B extracts a concept with no match in the graph, it triggers an ad-hoc single-concept `draftConceptGraph()` call, validated the same way and used immediately as `status: draft` — never blocking the sprint. (ADR-0016; resolved as wayfinder ticket [#29](https://github.com/Xaidel/teach/issues/29) on the [AI Learning Platform v1 map](https://github.com/Xaidel/teach/issues/21).)
- **Stage 2 rubric storage**: `exercises` gets a nullable `evaluation_rubric` jsonb column, shaped `{ required: string[], prohibited: string[], advisory: string[] }` (mirrors PRD §18's `review:` YAML directly). `generateExercise` populates it for `implement`/`debug`-mode rows at generation time, alongside `constraints` and `reference_solution`; it stays `NULL` for `explain`-mode rows, which skip Stage 1 and never reach Stage 2. Kept as a single unstructured jsonb column rather than a normalized child table, matching `constraints`' own precedent on this table — nothing in v1 needs to query individual criteria. (ADR-0017, amending ADR-0010; resolved as wayfinder ticket [#32](https://github.com/Xaidel/teach/issues/32) on the [AI Learning Platform v1 map](https://github.com/Xaidel/teach/issues/21).)
- **Hint escalation**: Manual-only in v1. Level is only advanced by explicit learner request. The behavioral-signal auto-escalation described in PRD Section 19.1 is out of scope (see below).

## Testing Decisions

- **Primary seam**: Integration tests against the backend API layer — real Postgres (test database), real Docker sandbox — with the AI Teacher Engine's client swapped for a deterministic test double at its interface boundary. This is the one seam that covers Class A, Class B, the two-tier evaluation pipeline, and the Learner Model, rather than one seam per subsystem.
- **What "good" looks like here**: tests assert on external behavior — submission in, evaluation result and Learner Model state out — not on internal call sequencing or prompt contents.
- **AI Teacher Engine test double**: fixture-based, returning canned exercises/hints/reviews keyed to test scenarios (e.g. "generation fails pre-flight twice then succeeds," "Stage 2 flags a prohibited pattern"), so pre-flight retry/circuit-breaker logic and Stage 2 rubric enforcement are exercised deterministically without live model calls.
- **Sandbox tests**: run against real Docker containers for the resource-limit and timeout guarantees specifically (a 10s-timeout test that doesn't actually launch a container isn't testing the guarantee) — these are slower and can be a separate suite from the general API integration tests.
- **No existing test prior art** — this is a greenfield repo, so these are the first tests, not additions to an existing suite.

## Out of Scope

- Auth, per-tenant isolation, and billing (deferred until beyond one learner; schema already accommodates it — ADR-0001).
- Any language beyond Rust, Go, Python.
- IDE/editor extension or CLI interface (web app only for v1 — PRD Section 23.2 already names IDE integration as future work).
- Firecracker/gVisor/WASM sandbox isolation (Docker only — ADR-0005; revisit if the platform becomes multi-tenant).
- Automatic, behavioral-signal-driven hint escalation (PRD Section 19.1) — manual-only for v1.
- Adaptive spaced-retrieval interval scheduling based on learner performance (PRD Section 23.4 already frames this as a future version) — fixed schedule (24h/3d/7d/21d/60d) for v1.
- LLM-based prompt-injection detection — only the deterministic leakage check ships in v1.
- Cloud/remote deployment and any related ops hardening (local machine only for v1).
- Analytics/success-metrics dashboards (Independent Solve Rate, Transfer Success Rate, etc. from PRD Section 24) — the underlying data is captured by the Learner Model, but no dashboard or reporting surface is built in v1.

## Further Notes

- No issue tracker is configured for this repo (not a git repository, no tracker/label vocabulary set up), so this spec lives at `docs/SPEC.md` rather than being published to a tracker.
- Full decision rationale for anything referenced by ADR number above is in `docs/adr/`; project vocabulary is in `CONTEXT.md`.
- Given the scope (both tracks, three languages, the full evaluation/generation/retrieval pipeline), this is large for a single implementation pass — breaking `to-tickets` output into the track/subsystem boundaries in this spec's User Stories section is likely more tractable than one undifferentiated build.
