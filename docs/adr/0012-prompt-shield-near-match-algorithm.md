# ADR-0012: Prompt Shield near-match leakage algorithm

- **Date**: 2026-08-11
- **Status**: Accepted
- **Deciders**: Xaidel (sole maintainer)

## Context and Problem Statement

ADR-0008 decided the solution-leakage half of the Prompt Shield Filter is a deterministic substring/near-match comparison against the Pre-Flight-verified reference solution, gated by the learner's hint level — but explicitly left the matching algorithm itself unspecified: "Near-match tuning (how much textual similarity counts as leakage) is not specified by this ADR. It's an implementation/technical-design detail with real correctness consequences either direction: too loose blocks legitimate hint content as false leakage; too tight lets real leakage through."

This ADR resolves that gap: what counts as a near-match, how code is normalized before comparing, and where the block threshold sits across the hint ladder's six levels (Level 0 conceptual question through Level 5 full solution; `docs/INITIAL_PRD.md` Section 19), for all three v1 languages (Rust, Go, Python) without any per-language parsing tooling to lean on.

This ADR was resolved as wayfinder ticket [#25](../../issues/25) ("Prompt Shield: near-match matching algorithm") on the [AI Learning Platform v1 map](../../issues/21), and gates build ticket [#5](../../issues/5) ("Prompt Shield: deterministic leakage check").

## Decision Drivers

- **ADR-0008's mandate**: zero added LLM calls, fully deterministic, reusing the Pre-Flight-verified reference solution as ground truth — no new verification work to obtain it.
- **Multi-language v1 (ADR-0003)**: the mechanism must work identically across Rust, Go, and Python. No per-language grammar/parsing tooling exists in the repo yet — no tree-sitter grammar, AST library, or linter is chosen anywhere (confirmed at resolution time); ADR-0011's per-language tooling is scoped to test-output parsing, not code comparison.
- **Hint ladder shape** (`docs/SPEC.md` story 23; PRD Section 19): Levels 0–3 are categorically non-code (conceptual question, observation, language/domain rule, implementation guidance); Level 4 is explicitly a partial solution; Level 5 is the full solution, reached only by explicit learner opt-in. The check's shape needs to respect this categorical split, not fight it with a smooth gradient.
- **Solution length varies widely across exercises** — from a few lines to several dozen — so a fixed-size threshold would be miscalibrated at one end or the other.
- **v1 scope discipline**: build a mechanism sized to what's actually known now, and document recall gaps explicitly rather than solving all of them up front — the same pattern ADR-0008 itself already uses for the paraphrase/restructuring gap.

## Decision

- **Comparison granularity: fragment-level, not whole-message.** The check scans for any contiguous fragment of the Teacher's response text that closely matches any contiguous fragment of the reference solution — not a single similarity score comparing the entire response to the entire solution. This catches a partial-solution leak embedded inside a longer prose explanation, which a whole-message average would dilute below a block threshold.
- **Scope: per-hint, not cumulative.** Each hint response is checked against the reference solution on its own. The check does not track or sum leakage across multiple hint requests within the same attempt.
- **Normalization: whitespace and comments only.** Before comparing, both the response fragment and the solution are normalized by collapsing whitespace/indentation and stripping comments (`//`, `/* */` for Rust and Go; `#` for Python). No identifier/variable-name normalization is performed.
- **Matching technique: token overlap via a minimal, language-agnostic lexer.** Both texts are split into tokens using one shared lexer: runs of letters/digits are one token, every other character (`(`, `:`, `[`, operators, etc.) is its own token — no per-language keyword or grammar classification. Closeness is the fraction of the solution fragment's tokens, in order, that are also present in the response's token stream. Not edit distance, and not AST/structural comparison.
- **Threshold units: percentage of that exercise's own reference-solution length**, not an absolute constant — so a 3-line solution and a 40-line solution are held to proportionally fair standards. A small absolute floor (on the order of a handful of tokens) prevents a single shared keyword or short common phrase from ever triggering a block by itself.
- **Per-level shape: two-tier, not a smooth per-level formula.** Levels 0–3 use a near-zero tolerance — any matched fragment at or above the floor blocks. Level 4 uses a much higher tolerance (starting point on the order of 40–50% solution-token overlap in one matched run), reflecting that real partial code is expected and intended at this level; only a near-complete match should block. Level 5 is unchecked — the learner has explicitly opted into the full solution. The exact percentages are tuning constants to refine from real usage, not fixed permanently by this ADR.

## Alternatives Considered

### Granularity: whole-message score vs. fragment-level

**Option A: whole-message similarity.** Compare the entire response text to the entire solution as one score.
- Benefits: simplest to implement — one comparison per hint response.
- Costs and risks: a short leaked code block surrounded by longer harmless prose gets diluted into a low overall score, letting a genuine leak through; doesn't reflect that Level 4 hints are fragments of the solution by design, not solution-sized responses.

**Option B (chosen): fragment-level.** Scan for any matching fragment, regardless of what surrounds it in the response.
- Benefits: catches leaks embedded in prose and partial-solution-sized leaks alike, matching how hint responses actually look (prose plus an optional code block).
- Costs and risks: more comparisons per hint response (every candidate fragment, not one pass); bounded in practice by hint-response and solution sizes being small (single exercise, at most a few hundred tokens).

### Scope: per-hint vs. cumulative across the attempt

**Option A: cumulative.** Concatenate every hint served so far in the current attempt and check the combined total against the solution.
- Benefits: catches a learner assembling the solution piecemeal across several hint requests at the same level, which per-hint checking cannot see.
- Costs and risks: requires new running state — tracking how much of the solution has already been revealed across every hint call in an attempt — a materially larger feature than defining a matching algorithm; out of this ticket's scope.

### Option B (chosen): per-hint only

- Benefits: each hint check is self-contained, no new state to track across calls, ships within this ticket's scope.
- Costs and risks: a learner requesting the same level repeatedly could in principle extract more of the solution piecemeal than any single check would catch. Accepted as an explicit v1 gap — see Neutral/Risks.

### Normalization: whitespace-only vs. + comments vs. + identifier renaming

**Option A: whitespace/indentation only.**
- Benefits: minimal, trivial to implement.
- Costs and risks: comment differences (a harmless annotation added or removed) could shift a match across the threshold in either direction for no real reason.

**Option B (chosen): whitespace + comment stripping.**
- Benefits: removes the two most common cosmetic differences between Teacher output and the stored reference solution, without needing any language-aware parsing beyond knowing each language's comment delimiters.
- Costs and risks: a solution reproduced with renamed variables (same structure, different names) is not caught — text differs at the identifier level, which this normalization doesn't touch. Accepted as a known, fragile stopgap for v1 — see Neutral/Risks.

**Option C: + identifier/variable-name normalization** (rename identifiers to positional placeholders before comparing).
- Benefits: would catch the renamed-variable case Option B misses.
- Costs and risks: requires a tokenizer that can distinguish identifiers from keywords per language — real per-language grammar knowledge with no existing scaffolding in the repo to build on (no tree-sitter/AST/lexer chosen anywhere as of this ADR). Rejected for v1 on cost grounds, not because the gap it would close doesn't matter.

### Matching technique: edit distance vs. token overlap vs. AST/structural comparison

**Option A: edit-distance similarity** (e.g. Levenshtein ratio between fragment pairs).
- Benefits: well-understood, tolerant of small character-level differences.
- Costs and risks: doesn't map as directly onto a "percentage of solution matched" threshold as token overlap does; more expensive to compute per fragment pair.

**Option B (chosen): token overlap.**
- Benefits: composes directly with a percentage-of-solution threshold (fraction of solution tokens found, in order, in the response); cheap to compute; degrades gracefully rather than breaking entirely — a single renamed variable in an otherwise-identical block only breaks the token-groups immediately around it, so the rest of the block still counts as matching and the fragment can still cross the block threshold. This partially, though not fully, offsets the Option B normalization gap above.
- Costs and risks: still fundamentally token-identity-based, not semantic — a solution rewritten with genuinely different token choices throughout (not just one renamed variable) would still evade it.

**Option C: AST/structural comparison** (parse both into an abstract syntax tree and compare structure).
- Benefits: most robust to superficial rewrites (renaming, reformatting, minor restructuring) since it compares program structure, not text.
- Costs and risks: requires a working parser for Rust, Go, and Python each — no such tooling exists in the repo yet, and building or integrating three language parsers is disproportionate to what this ticket asks to decide. Rejected for v1; the field is confirmed clean (no tree-sitter/AST library referenced anywhere in the repo) if this is revisited later.

### Per-level threshold shape: two-tier vs. smooth per-level formula

**Option A: smoothly scaled formula** (e.g. allowed match percentage increases roughly linearly with hint level).
- Benefits: one continuous rule, no special-casing between levels.
- Costs and risks: doesn't reflect the hint ladder's actual shape — Levels 0–3 are categorically non-code and Level 4 is categorically real-code-on-purpose. A smooth formula would be too loose at the low end (where tolerance should be near zero) or too strict at Level 4 (undermining the level's purpose) to fit both ends well.

**Option B (chosen): two-tier.**
- Benefits: matches the ladder's real structure — near-zero tolerance where no code should appear at all, a deliberately higher tolerance where partial code is the point.
- Costs and risks: a hard boundary between Level 3 and Level 4 rather than a gradient; the Level 4 percentage is a single tuning constant that has to work across all exercises regardless of individual solution shape.

## Consequences

### Positive

- Build ticket #5 has a concrete algorithm to implement against instead of an unspecified "substring/near-match" placeholder.
- Fragment-level detection catches partial-solution leaks embedded in prose, not just literal whole-response copies of the solution.
- One shared, language-agnostic lexer works identically across Rust, Go, and Python without requiring any per-language parsing tooling this repo doesn't have yet.
- Percentage-based thresholds treat exercises with very different solution lengths fairly under one rule, rather than needing per-exercise tuning.
- The two-tier threshold shape matches the hint ladder's own categorical split (no-code levels vs. the partial-solution level) instead of fighting it with a smooth formula.

### Negative

- Renamed-variable leaks (same code, different identifier names) mostly pass through the check; token overlap only partially compensates by degrading gracefully around the changed token, it does not neutralize the rename.
- Cumulative leakage — small pieces revealed across several separate hint requests at the same level — is not caught; each hint is checked in isolation.
- The Level 4 threshold (~40–50% starting point) is an estimate, not derived from real usage; it will likely need retuning once real hint traffic exists.

### Neutral / Risks

- The general paraphrase/restructuring recall gap ADR-0008 already names is unchanged by this ADR — still present.
- **Renamed-identifier evasion is an explicit, accepted v1 gap.** Revisit toward identifier-aware tokenization (Option C, Normalization) if it proves to matter in practice — tracked via the [AI Learning Platform v1 map](../../issues/21).
- **Cumulative-hints leakage across repeated same-level requests is an explicit, accepted v1 gap.** Revisit if learners are observed extracting solutions piecemeal across several hint calls — tracked via the same map.
- Exact numeric constants (the absolute floor, the Level 4 percentage) are implementation-tunable, not fixed permanently by this ADR.

## Confirmation

- No code implements this yet as of this writing; there is no automated check to point to today.
- Once built: fixture-based tests (per ADR-0008's Confirmation section) assert that known reference solutions, checked against known near-match variants — whitespace-only changes, comment differences, and a renamed-variable variant as an explicit non-catch case — produce the expected block/pass verdict at each hint level. PRD story 36's framing remains the named confirmation case: a Level 2 hint must never contain the Level 5 answer.

## Relationships and References

- Refines: [ADR-0008](./0008-deterministic-prompt-shield.md) — this ADR fills the near-match algorithm gap ADR-0008 explicitly left open ("Near-match tuning... is not specified by this ADR"); ADR-0008's core decision (deterministic check, no LLM call, leakage-vs-injection split) is unchanged and remains authoritative.
- Related to: [ADR-0003](./0003-multi-language-from-v1.md) — the shared, language-agnostic lexer is the concrete mechanism satisfying multi-language support here without per-language parsing tooling.
- Supporting evidence: `docs/SPEC.md` story 23 (hint ladder default progression); `docs/INITIAL_PRD.md` Section 19 (Socratic Hint Engine, hint level definitions); wayfinder ticket [#25](../../issues/25) on map [#21](../../issues/21) (resolution session this ADR records).
- Owning implementation package: none yet — no code implements this as of this writing.
