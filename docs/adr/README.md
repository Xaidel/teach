# Architecture Decision Records

This directory records architecturally significant decisions for the **application** — this
learning platform. Decisions about the template this application is scaffolded from live in
[`arch_docs/adr/`](../../arch_docs/adr/README.md) instead; the two collections are separate
and numbered independently.

## When to write an ADR

Write one when the choice materially affects system structure, boundaries, dependencies,
data ownership, quality attributes, operations, security, delivery, or construction
technique — and its rationale will matter after the immediate discussion. Strong signals:

- it changes service/package boundaries, dependency direction, or data ownership;
- it adopts, removes, or replaces a major platform, framework, datastore, or provider;
- it materially affects security, reliability, latency, scalability, cost, or operability;
- it's expensive or risky to reverse; or
- it would keep coming up as a "wait, why did we do it this way?" question.

Routine implementation, formatting, and private helper design don't need one — put those in
code, a PR description, or `docs/SPEC.md`.

## Numbering and filenames

- Filename: `NNNN-short-kebab-case-title.md`
- Heading: `# ADR-NNNN: Decision-focused title`
- Number: four digits, zero-padded, monotonically increasing, **never reused**. The next
  number is one more than the highest number currently in this directory (checking both
  `docs/adr/` files and any `Supersedes`/`Superseded by` links, since a gap is possible).
- Date: ISO 8601 `YYYY-MM-DD`.

## Statuses

| Status       | Meaning                                                          |
| ------------ | ----------------------------------------------------------------- |
| `Proposed`   | Recommendation under review; not yet an agreed decision.          |
| `Accepted`   | Approved and authoritative for its decision.                      |
| `Rejected`   | Considered and deliberately not adopted.                          |
| `Withdrawn`  | Removed from consideration without a decision on its merits.      |
| `Deprecated` | Still relevant or implemented but being phased out.                |
| `Retired`    | No longer applicable — its governed system/capability was removed.|
| `Superseded` | No longer authoritative; replaced by a linked ADR.                 |

A new, unresolved decision defaults to `Proposed`. Nothing is marked `Accepted` merely
because it's been implemented, or because no one has objected — see below.

## Who decides

This is a solo-maintained project. Xaidel is sole author and sole decider; acceptance is
recorded by marking a record `Accepted` once the decision is actually settled, not merely
drafted.

## Changing an accepted decision

Never silently rewrite an accepted or rejected ADR's original context, alternatives, or
consequences — that erases the record of what was actually decided and why. When a decision
changes:

1. Write a **new** ADR with the next number, describing the new context and decision.
2. State its relationship to the old one precisely — `Supersedes`, `Amends`, `Refines`, or
   `Deprecates` (see below for what each means).
3. Once the new ADR is accepted, edit the old one to add `Status: Superseded` (or
   `Deprecated`/etc.) and a `Superseded by: ADR-NNNN` link — but leave its original decision
   content untouched, other than a short pointer note directing readers to the current
   decision.
4. Update this index, and any downstream doc (`docs/SPEC.md`, `docs/INITIAL_PRD.md` if the
   conflict is product-level, not just architectural) whose assumptions changed.

Relationship semantics:

- **Supersedes** — replaces the earlier decision completely; the old ADR stops being
  authoritative.
- **Amends** — changes a bounded part while the earlier decision's core remains authoritative.
- **Refines** — adds specificity without reversing the earlier decision.
- **Related to** — supplies context without changing either record's authority.

## Template

Start new ADRs from [`template.md`](./template.md).

## Index

| ID | Title | Status | Relationships |
| --- | --- | --- | --- |
| [ADR-0001](./0001-single-user-mvp-multi-user-ready-data-model.md) | Single-user MVP on a multi-user-ready data model | Accepted | — |
| [ADR-0002](./0002-both-tracks-in-v1.md) | Class A and Class B ship together in v1 | Accepted | Related to ADR-0001, ADR-0003 |
| [ADR-0003](./0003-multi-language-from-v1.md) | Multi-language support from v1 | Accepted | Related to ADR-0001, ADR-0002, ADR-0005 |
| [ADR-0004](./0004-openai-compatible-single-model-adjustable-effort.md) | OpenAI-compatible API, single model family, adjustable reasoning effort per task | Accepted | Related to ADR-0002, ADR-0008 |
| [ADR-0005](./0005-docker-sandbox-isolation.md) | Docker containers for sandbox execution | Accepted | Related to ADR-0001, ADR-0003 |
| [ADR-0006](./0006-typescript-nextjs-stack.md) | TypeScript full-stack: Next.js + Node backend | **Superseded** by ADR-0009 | — |
| [ADR-0007](./0007-postgres-storage.md) | Postgres for all persistent storage | Accepted | Related to ADR-0001, ADR-0003, ADR-0009 |
| [ADR-0008](./0008-deterministic-prompt-shield.md) | Deterministic check for Prompt Shield leakage detection; injection detection left open | Accepted | Related to ADR-0004; refined by ADR-0012 |
| [ADR-0009](./0009-tanstack-start-single-app-stack.md) | TanStack Start (React), single deployable app — no separate Node backend | Accepted | Supersedes ADR-0006; related to ADR-0004, ADR-0005, ADR-0007 |
| [ADR-0010](./0010-core-v1-persistence-schema.md) | Core v1 persistence schema: Concept Graph, Learner Model, Retrieval Queue, Exercise Store | Accepted | Related to ADR-0001, ADR-0003, ADR-0007 |
| [ADR-0011](./0011-sandbox-orchestration-mechanics.md) | Sandbox orchestration mechanics | Accepted | Related to ADR-0003, ADR-0005, ADR-0009; refined by ADR-0018 |
| [ADR-0012](./0012-prompt-shield-near-match-algorithm.md) | Prompt Shield near-match leakage algorithm | Accepted | Refines ADR-0008; related to ADR-0003 |
| [ADR-0013](./0013-local-dev-deploy-environment.md) | Local dev/deploy environment: native app, composed Postgres, ad hoc sandbox | Accepted | Related to ADR-0001, ADR-0009, ADR-0011; amended by ADR-0018 |
| [ADR-0014](./0014-single-learner-session-model.md) | Single-learner session model: query-based resolution, no session layer | Accepted | Related to ADR-0001, ADR-0010, ADR-0013 |
| [ADR-0015](./0015-explanation-assessment-transfer-test-cadence.md) | Explanation Assessment / Transfer Test cadence: dual promotion gate and randomized recurring review shape | Accepted | Related to ADR-0010, ADR-0014 |
| [ADR-0016](./0016-concept-graph-review-workflow.md) | Concept Graph review workflow: in-app structural review with a separate deterministic validation gate | Accepted | Related to ADR-0010, ADR-0003 |
| [ADR-0017](./0017-stage2-rubric-storage.md) | Stage 2 evaluation rubric storage: nullable `evaluation_rubric` jsonb column on `exercises` | Accepted | Related to ADR-0010, ADR-0016 |
| [ADR-0018](./0018-per-language-dependency-set-mechanism.md) | Per-language allowed dependency set: curation & cache-rebuild mechanism | Accepted | Refines ADR-0011; amends ADR-0013; related to ADR-0016 |
| [ADR-0019](./0019-generated-test-source-storage.md) | Generated test source storage: nullable `test_source` text column on `exercises` | Accepted | Related to ADR-0010, ADR-0011, ADR-0017 |
| [ADR-0020](./0020-lf-line-endings-policy.md) | LF line-ending policy for all text files (`.gitattributes`, `* text=auto eol=lf`) | Accepted | — |
| [ADR-0021](./0021-attempts-rekey-reconciliation.md) | `attempts` rekey reconciliation: closes ADR-0010's staging deviation, pins `outcome`/`time_to_solution`/`compiler_errors` semantics | Accepted | Refines ADR-0010; related to ADR-0008, ADR-0014, ADR-NNNN; amended by ADR-0026 |
| [ADR-0022](./0022-adversarial-exercises-debug-mode-generation.md) | Adversarial exercises as debug-mode generation with contract-only defect metadata | Proposed | Refines ADR-0010; related to ADR-0017, ADR-0019 |
| [ADR-0023](./0023-defect-metadata-persistence-for-fallback-labeling.md) | Defect metadata persistence on `exercises` for fallback labeling fidelity | Proposed | Refines ADR-0022; related to ADR-0010, ADR-0017, ADR-0019 |
| [ADR-0024](./0024-curriculum-lesson-caching.md) | Curriculum lesson caching: persist generated lessons keyed by generation inputs | Accepted | Related to ADR-0007, ADR-0010, ADR-0014 |
| [ADR-0025](./0025-recurring-mistakes-evidence-query.md) | "Recurring mistakes" evidence: read-time aggregation over `attempts`, no dedicated storage | Accepted | Related to ADR-0010, ADR-0014, ADR-0021 |
| [ADR-0026](./0026-explain-mode-attempts-null-outcome.md) | Explain-mode attempts write NULL `outcome` | Accepted | Amends ADR-0021; related to ADR-0010, ADR-0015 |
| [ADR-0027](./0027-transfer-test-exercises-passed-column.md) | `transfer_test_exercises.passed` — durable Transfer Test pass flag | Accepted | Refines ADR-0010; related to ADR-0015, ADR-0021, ADR-0017, ADR-0019, ADR-0022, ADR-0023 |

Keep this table in the same change as any status or relationship update. Every ADR file
appears here exactly once.

## Parked records

Unnumbered records awaiting an implementation effort — they receive the next available number
when that effort begins, then join the index.

| Placeholder | Title | Status | Relationships |
| --- | --- | --- | --- |
| [ADR-NNNN](./NNNN-shield-blocked-hint-ladder-exhaustion.md) | Shield-blocked hint requests recorded on `submission_hints` as ladder exhaustion (v1 out of scope; parked for v2) | Accepted | Related to ADR-0004, ADR-0008, ADR-0010, ADR-0012, ADR-0021 |
