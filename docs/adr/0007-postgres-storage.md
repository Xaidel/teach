# ADR-0007: Postgres for all persistent storage

- **Date**: 2026-08-10
- **Status**: Accepted
- **Deciders**: Xaidel (sole maintainer)

## Context and Problem Statement

`docs/INITIAL_PRD.md` user story 40 already settles part of this question explicitly: "I want the Concept Graph stored as relational/adjacency data in Postgres, not a separate graph database, so that it's queried and migrated with the rest of the platform's data." The Concept Graph is a real graph in shape — per-language nodes (concepts) with `prerequisites` and `related` edges (PRD Section 7's worked example: `rust.async.send` depends on `rust.traits` and `rust.ownership`) — which is why a graph database is a genuinely credible alternative worth naming, not a strawman.

What the PRD doesn't settle explicitly is where the rest of v1's persistent data lives: the Learner Model (mastery state, attempt history, hint usage — ADR-0001) and the Retrieval Queue (PRD Section 23.1), both of which reference Concept Graph nodes directly (e.g. a Retrieval Queue entry for `rust.async.send`). This ADR extends the PRD's Concept Graph mandate to a full v1 persistence decision: one storage technology for all of it, or the Concept Graph in one store and everything else in another.

## Decision Drivers

- **PRD mandate is explicit and binding for the Concept Graph specifically**: story 40 already requires relational/adjacency storage in Postgres, not a graph database, so it's queried and migrated alongside the rest of the platform's data.
- **Graph shape and scale**: the PRD's own worked example is small (roughly a dozen to twenty concepts for Rust alone, across three top-level branches) and shallow (a handful of prerequisite levels) — the scale at which a purpose-built graph engine's traversal advantages typically start to matter is well beyond what the PRD's example implies for v1.
- **Cross-entity data locality**: Learner Model progress and Retrieval Queue entries reference Concept Graph nodes directly by concept ID — keeping all three in one database enables direct foreign-key joins instead of cross-database references.
- **Operational simplicity for a solo maintainer**: one database technology to operate, back up, and migrate is a materially smaller operational surface than two, for a project with one person maintaining it.
- **Stack alignment**: ADR-0009 commits to a TypeScript/TanStack Start stack; Drizzle ORM is TypeScript-native with first-class Postgres support, matching that stack directly.

## Decision

We will use **Postgres for all v1 persistent data** — the per-language Concept Graph (Rust, Go, Python — ADR-0003), the Learner Model (mastery state, attempt history, hint usage — ADR-0001), and the Retrieval Queue — accessed via **Drizzle ORM**. No second database technology is introduced for v1.

The Concept Graph is modeled as relational/adjacency data: concept nodes plus `prerequisites`/`related` edge tables, queried with standard SQL (including recursive CTEs for traversal), not a dedicated graph database or graph query language.

## Alternatives Considered

### Option A: Graph database for the Concept Graph, Postgres for the rest

Store the Concept Graph in a purpose-built graph database (traversal-native), and everything else (Learner Model, Retrieval Queue) in Postgres.

- Benefits: purpose-built for exactly the kind of query the Concept Graph needs — prerequisite-chain traversal, "what's missing," related-concept lookups — and scales better than adjacency tables if the graph grows substantially larger or deeper than the PRD's worked example implies.
- Costs and risks: a second database technology to operate, back up, and migrate for a solo-maintained v1. The PRD's own worked example suggests a small, shallow graph — the scale where a graph database's traversal advantages actually pay off isn't reached at that size. Learner Model progress and Retrieval Queue entries reference Concept Graph nodes directly, so splitting storage introduces a cross-database join/reference problem the single-Postgres option avoids entirely. This option also directly conflicts with PRD story 40's explicit mandate for the Concept Graph specifically.

### Option B (chosen): Postgres for everything, adjacency-table Concept Graph, via Drizzle

Store the Concept Graph, Learner Model, and Retrieval Queue in one Postgres database, with the Concept Graph modeled as adjacency tables.

- Benefits: matches PRD story 40's explicit mandate; one database technology for all v1 persistence means one backup, migration, and connection-pooling story instead of coordinating two; Concept Graph nodes join directly to Learner Model and Retrieval Queue rows via foreign key; Drizzle's TypeScript-native, Postgres-first design matches the stack ADR-0009 already committed to.
- Costs and risks: prerequisite/relation traversal (e.g. "everything downstream of concept X," finding a missing-prerequisite path) requires recursive CTEs in Postgres rather than native graph-traversal primitives — more verbose to write and reason about, and potentially slower than a purpose-built graph engine if the Concept Graph ever grows substantially beyond the PRD's worked-example scale.

## Consequences

### Positive

- One database technology for all v1 persistence — a single backup, migration, and connection-pooling story for a solo maintainer, instead of two.
- Concept Graph nodes join directly to Learner Model progress and Retrieval Queue entries via foreign key, with no cross-database reference problem to solve.
- Matches both PRD story 40's explicit mandate and the TypeScript/Drizzle stack ADR-0009 already established.
- ADR-0001's learner-scoping pattern (`learner_id` FK from the first migration) applies uniformly across Learner Model and Retrieval Queue tables in the same database, with no second scoping mechanism needed for a separate store.

### Negative

- Prerequisite/relation traversal queries require recursive CTEs rather than native graph-traversal primitives — more verbose, and a real performance ceiling exists that a purpose-built graph engine wouldn't have at large scale.
- The "small, shallow graph" assumption behind this decision is an estimate drawn from the PRD's single worked Rust example, not a measured constraint — it hasn't been validated against real per-language Concept Graph content, since none has been authored yet (PRD story 39: AI-drafted, then human-reviewed).
- Committing to adjacency tables for the Concept Graph also commits every downstream tool or reporting need built against it to relational query patterns, not graph-native ones.

### Neutral / Risks

- If a language's Concept Graph turns out substantially larger or deeper than the PRD's worked example once real content is drafted and human-reviewed, the adjacency-table approach should be revisited — this ADR does not commit to adjacency tables regardless of realized graph size.
- This decision is scoped to v1 persistence (Concept Graph, Learner Model, Retrieval Queue). It does not address future data — e.g. auth/session state once ADR-0001's eventual multi-user phase begins — which would be evaluated on its own terms if and when it's added.

## Confirmation

- No code implements this yet as of this writing; there is no automated check to point to today.
- Once built: Drizzle schema/migrations define concept nodes and `prerequisites`/`related` edge tables in the same Postgres database as the Learner Model and Retrieval Queue tables — verifiable by schema/migration review confirming no second database dependency is introduced. The shared integration-test seam (ADR-0002, ADR-0009) runs against a real Postgres test database, exercising Concept Graph traversal alongside Learner Model and Retrieval Queue behavior together, not as separate suites.

## Relationships and References

- Related to: [ADR-0001](./0001-single-user-mvp-multi-user-ready-data-model.md) — the learner-scoped Learner Model and Retrieval Queue tables this ADR places in Postgres are the same tables ADR-0001 governs.
- Related to: [ADR-0003](./0003-multi-language-from-v1.md) — the per-language Concept Graphs (Rust, Go, Python) this ADR stores all live in this one database.
- Related to: [ADR-0009](./0009-tanstack-start-single-app-stack.md) — Drizzle ORM's pairing with Postgres matches the TypeScript/TanStack Start stack established there.
- Supporting evidence: [docs/INITIAL_PRD.md](../INITIAL_PRD.md) Section 7 (Concept Graph) and user story 40; Section 23.1 (Retrieval Queue); [docs/SPEC.md](../SPEC.md) ("Storage" line).
- Owning implementation package: none yet — no code implements this as of this writing.
