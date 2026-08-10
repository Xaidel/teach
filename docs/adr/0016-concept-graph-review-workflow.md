# ADR-0016: Concept Graph review workflow and validation gate

- **Date**: 2026-08-11
- **Status**: Accepted
- **Deciders**: Xaidel (sole maintainer)

## Context and Problem Statement

`docs/SPEC.md` user story 39 and its "Concept Graph authorship" Implementation Decision state each language's Concept Graph is "AI-drafted... then human-reviewed," but neither defines what that review actually consists of, where a draft lives before review, how much of a graph ships at launch, or what happens when Class B (Tactical Sprint) extracts a concept that has no match in the graph yet. ADR-0010 already fixed the `concepts`/`concept_edges` schema, and `draftConceptGraph()` already exists as a typed AI Teacher Engine function (`docs/SPEC.md`'s AI Teacher Engine interface contract, resolved as wayfinder ticket #23 — no dedicated ADR), but neither addresses the review process built around them.

This ADR was resolved as wayfinder ticket [#29](../../issues/29) ("Concept Graph seed content & review workflow") on the [AI Learning Platform v1 map](../../issues/21), and gates build tickets [#7](../../issues/7) (Rust Concept Graph), [#19](../../issues/19) (Go), and [#20](../../issues/20) (Python).

A constraint specific to this decision, not in play when ADR-0010/ADR-0011 were written: v1's sole reviewer (ADR-0001, ADR-0014 — one learner, no auth) is also the platform's only learner. The review process has to be honest about what a non-expert reviewer can actually verify, rather than assuming curriculum-team-level domain judgment.

## Decision Drivers

- **Single reviewer = single learner** (ADR-0001, ADR-0014): review can't assume domain expertise the reviewer doesn't have yet.
- **Class B must not block** (user story 7): a Tactical Sprint exists specifically to avoid "trying to explain... indefinitely" — waiting on human review would reintroduce the problem it solves.
- **Class A needs real data to walk** (user story 1): a sequential curriculum requires an actual prerequisite-ordered graph, not just an approval workflow around an empty one.
- **v1 scope discipline**: reuse the schema ADR-0010 already established rather than standing up parallel staging tables or file-import tooling.
- **Existing deterministic-gate pattern** (ADR-0008, ADR-0012): correctness-critical checks in this codebase are plain code, not left to human judgment or a second LLM call.

## Decision

- **Review surface: in-app UI, not a file.** Drafted concepts are reviewed through a route in the app; `draftConceptGraph()`'s output is written directly into the existing `concepts`/`concept_edges` tables (ADR-0010). No YAML export/hand-edit/import cycle, no separate staging tables.
- **Schema addition: a `status` enum (`draft` | `approved`) on `concepts` only.** `concept_edges` carries no separate status — an edge is reviewed as part of reviewing the concept it originates from, not independently.
- **`status` never gates usage.** It is a personal tracking marker, nothing more. Both `draft` and `approved` concepts are fully queryable by Class A and Class B; there is no "wait for approval" step anywhere in the runtime path.
- **Review is structural, not domain verification.** The review UI is scoped to what a non-expert reviewer can actually judge: duplicate names, prerequisite chains that reference real concepts, relative difficulty that looks plausible. It does not ask the reviewer to confirm the AI got the language's semantics right — that trust is extended the same way it already is for hints, exercises, and explanations elsewhere in the Teacher Engine.
- **The actual usability gate is a separate, deterministic Concept Validation check** — cycle detection (the prerequisite graph must be a DAG) and dangling-reference resolution (every `concept_edges` row's `from_concept_id`/`to_concept_id` must resolve to a real `concepts` row) — run whenever a concept/edge is drafted. A concept or edge that fails is excluded from Class A/Class B queries regardless of `status`, but stays visible in the review UI so it can be corrected. No LLM call is involved.
- **Launch scope: broad coverage per language**, not limited to the PRD's own ~12-concept worked-example tree — each language's graph aims for wide topic coverage before/as that language's Class A track goes live.
- **Runtime gap handling: ad-hoc single-concept draft, used immediately.** When Class B extracts a concept from a pasted snippet with no match in the Concept Graph, it calls `draftConceptGraph()` scoped to that one concept, runs the result through the same Concept Validation check, stores it as `status: draft`, and uses it immediately for that session — no blocking on review, no generic fallback exercise.

## Alternatives Considered

### Mechanism: file-based YAML import vs. in-app review UI

**Option A: file-based.** `draftConceptGraph()`'s output is serialized to a YAML file (per the PRD's example format), hand-edited, then imported via a script.

- Benefits: no new UI route to build; review happens as a git diff, with free versioning.
- Costs and risks: a second representation of concept data to keep in sync with Postgres; import tooling to build and maintain; doesn't fit the corrective, ongoing review pattern this ADR settles on (edits would mean re-exporting, re-diffing, re-importing indefinitely).

**Option B (chosen): in-app review UI.**

- Benefits: one source of truth (the existing `concepts`/`concept_edges` tables); no import/export step; fits naturally with the runtime-gap case (Q5/Decision), which has to write drafts through the running app regardless.
- Costs and risks: a new UI surface to build, tracked as unspecified frontend work (see Neutral/Risks) rather than resolved here.

### Review depth: full domain verification vs. structural-only

**Option A: full domain review.** The reviewer verifies technical/domain accuracy of every drafted concept before approval.

- Benefits: would catch AI errors that structural checks can't (e.g. a wrong prerequisite ordering that's syntactically valid but pedagogically wrong).
- Costs and risks: not achievable given the actual reviewer — the platform's sole learner, who by definition doesn't yet know the material being reviewed. Assuming this capability would make the review step dishonest about what it actually catches.

**Option B (chosen): structural-only, corrective over time.**

- Benefits: scoped to what a non-expert reviewer can genuinely judge (naming, reference integrity, plausible relative difficulty); domain correctness surfaces and gets fixed as the reviewer actually learns the material, rather than being falsely gated on a review step that couldn't have caught it anyway.
- Costs and risks: domain-level errors (wrong prerequisite, mis-scoped difficulty) can persist unnoticed for as long as the reviewer hasn't reached that part of the curriculum.

### Usage gating: status-gated vs. validation-gated

**Option A: `status` gates usage.** Only `approved` concepts are queryable by Class A/Class B, as originally assumed when the `status` column was proposed.

- Benefits: matches the intuitive meaning of "draft" — unreviewed content simply isn't live yet.
- Costs and risks: directly conflicts with the runtime-gap decision (Class B must use an ad-hoc draft immediately, before any review is possible) — would require special-casing runtime-gap concepts as an exception to the rule, rather than one rule applied consistently.

**Option B (chosen): a separate deterministic Concept Validation check gates usage; `status` never does.**

- Benefits: one consistent rule everywhere (broad launch draft and runtime-gap draft alike); the thing that actually gets blocked (broken graph data — cycles, dangling references) is exactly the thing a non-expert reviewer *can't* reliably catch by eye, so automating it is a genuine gap-fill rather than a redundant check.
- Costs and risks: `status` no longer means "safe to use" in any sense, which is a meaningfully different mental model from a typical draft/publish flow — worth remembering when anyone touches Concept Graph code later.

## Consequences

### Positive

- Build tickets #7, #19, and #20 have a concrete review workflow to implement against, replacing the open "gated by ticket #29, still open" placeholder in #7's acceptance criteria.
- Review is honestly scoped to what the actual reviewer can do, rather than an aspirational full-verification process that would either block indefinitely or be rubber-stamped without real scrutiny.
- Class B is never blocked waiting on human review, preserving the "tactical, not open-ended" framing of user story 6/7.
- Broad per-language launch coverage gives Class A a real, walkable sequential curriculum from day one rather than a thin single-strand demo.

### Negative

- `concepts` needs a schema migration (the `status` enum column) beyond what ADR-0010 originally specified.
- Concept Validation (cycle detection + dangling-reference check) is new logic that must exist and be tested before any Concept Graph write path — including the broad initial draft and every runtime-gap draft — can safely ship.
- Broad launch coverage means drafting (and structurally reviewing) a substantially larger concept set per language than the PRD's worked example, more upfront AI-drafting and review time than a thin-scope launch would need.
- Domain-level errors in the graph (as opposed to structural corruption) have no dedicated catch mechanism in v1 — they surface only through actual use.

### Neutral / Risks

- The Concept Graph review UI itself is new frontend surface, not designed by this ADR — it joins the other unspecified UI flows already tracked in the [AI Learning Platform v1 map](../../issues/21)'s Not yet specified section (dashboard, exercise/sandbox page, hint-ladder UI, retrieval queue UI).
- `draftConceptGraph()`'s existing contract (ADR-0011/ticket #23) was specified as one call producing a language's graph; this ADR's runtime-gap case additionally needs it (or a variant) to draft a single concept scoped against the existing graph. The exact function signature for that is left to whoever implements ticket #7/#19/#20 or the Class B extraction path — not fixed here.
- Broad coverage combined with structural-only review means a wide but pedagogically uneven graph is possible and won't be caught until noticed in use. Revisit if this proves to matter in practice — tracked via the same map.

## Confirmation

No code implements this yet as of this writing; there is no automated check to point to today. Once built: a migration adds `concepts.status`; Concept Validation ships as a pure function (DAG check + reference resolution) with unit tests against known-good and known-cyclic/dangling fixture graphs; an integration test confirms Class A/Class B queries return `draft`-status concepts and exclude validation-failing ones, exercising the "status never gates, validation does" invariant directly.

## Relationships and References

- Related to: [ADR-0010](./0010-core-v1-persistence-schema.md) — adds a `status` column to the `concepts` table ADR-0010 defines; the rest of that schema is unchanged and remains authoritative.
- Related to: [ADR-0003](./0003-multi-language-from-v1.md) — broad per-language coverage applies identically across Rust, Go, and Python.
- Supporting evidence: `docs/SPEC.md` user stories 1, 4-7, 38-40 and its AI Teacher Engine interface contract section (`draftConceptGraph()`, resolved as wayfinder ticket #23); `docs/INITIAL_PRD.md`'s Concept Graph example format; wayfinder ticket #29 on map #21 (resolution session this ADR records).
- Owning implementation package: none yet — no code implements this as of this writing.
