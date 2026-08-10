# ADR-0008: Deterministic check for Prompt Shield leakage detection; injection detection left open

- **Date**: 2026-08-10
- **Status**: Accepted
- **Deciders**: Xaidel (sole maintainer)

## Context and Problem Statement

`docs/INITIAL_PRD.md` Section 5's guardrail table names a "Prompt Shield Filter": a secondary guardrail that inspects AI Teacher Engine output before rendering, with a stated purpose covering two distinct concerns — preventing prompt injection and preventing unauthorized solution leakage. These are different problems: leakage is the Teacher's own output (a hint or explanation) revealing more of the solution than the learner's current hint level (0–5) should permit; injection is adversarial input manipulating the Teacher's behavior or output in open-ended ways.

For the leakage half specifically, PRD user stories 36–37 already settle the approach: check deterministically, via substring/near-match comparison against the Pre-Flight-verified reference solution, gated by the learner's current hint level — "so that a Level 2 hint can never accidentally contain the Level 5 answer" — and do it "without an additional model call, so that leakage detection doesn't add LLM cost or non-determinism to every response." The PRD does not equally settle the injection half.

The naive reading of "a secondary guardrail inspects LLM responses" is another LLM call reviewing the Teacher Engine's output — for both halves. The decision question this ADR resolves: implement leakage detection deterministically as the PRD already directs, and decide what happens to the injection half, which doesn't have the same ground truth (a verified reference solution) to check against.

## Decision Drivers

- **PRD mandate is explicit for leakage specifically**: stories 36–37 already require a deterministic, no-extra-model-call approach for solution leakage, gated by hint level.
- **Call frequency and cost**: leakage detection runs on every single Teacher Engine response — every hint, every explanation — the platform's highest-frequency AI call path (ADR-0004). A second LLM call here roughly doubles cost and latency on that path.
- **Ground truth already exists**: Pre-Flight validation (PRD Section 5's guardrail table) already produces a verified reference solution before any exercise is deployed. Leakage detection only needs to compare against that — it doesn't need a model call to re-derive correctness.
- **Self-referential attack surface**: an LLM reviewing another LLM's output is potentially vulnerable to the same injection/manipulation classes it exists to guard against. A deterministic string comparison has no such attack surface.
- **Determinism matters for a safety gate**: the same Teacher output, reference solution, and hint level should always produce the same leakage verdict — an LLM-based reviewer could plausibly return different verdicts on identical input across calls.

## Decision

We will implement the **solution-leakage half** of Section 5's Prompt Shield Filter as a **deterministic check**: substring/near-match comparison of AI Teacher Engine output against the Pre-Flight-verified reference solution, gated by the learner's current hint level, so that hint content above the learner's current level is always stripped before rendering — without an additional model call.

**Prompt-injection detection — the other half of the guardrail — is explicitly left open for v1.** No check ships for it now. If the deterministic leakage layer's approach proves insufficient for injection once real usage exists, an LLM-based check is the option to evaluate then; it is not adopted now, and it is not assumed to be the eventual answer.

## Alternatives Considered

### Option A: LLM-based check for both halves (leakage + injection)

Use a second model call to review AI Teacher Engine output for both solution leakage and prompt injection, as one general-purpose review mechanism.

- Benefits: one implementation could plausibly cover both concerns rather than needing a separate approach per concern; potentially more adaptable to leakage patterns a substring/near-match comparison might miss — a paraphrased or restructured version of the solution, not just verbatim overlap.
- Costs and risks: doubles LLM cost and latency on the platform's highest-frequency call path (every hint, every explanation) — exactly what PRD story 37 objects to. Introduces non-determinism into a safety-critical gate: the same response could pass or fail review on different calls. An LLM reviewing another LLM's output is potentially vulnerable to the same prompt-injection/manipulation classes it's meant to guard against, undermining its own reliability as a guardrail. This cost lands hardest on the leakage half specifically, where a hard ground-truth reference solution already exists and doesn't need a model call to compare against.

### Option B (chosen): Deterministic check for leakage; injection left open

Compare Teacher output against the Pre-Flight-verified reference solution deterministically for leakage; ship no injection-detection mechanism in v1.

- Benefits: zero added LLM cost or latency on the highest-frequency call path; deterministic, reproducible verdicts for a safety-critical gate; not exposed to the injection/manipulation classes an LLM-based reviewer would be, since it isn't itself a model call interpreting adversarial text; reuses ground truth that already exists from an independent, already-mandatory gate (Pre-Flight validation) — no new verification work required.
- Costs and risks: substring/near-match comparison can miss leakage that doesn't textually resemble the reference solution — a correct answer phrased differently, or a structurally equivalent but textually distinct solution — bounded by how "near" the near-match tuning is set, which this ADR does not specify. Prompt-injection detection is deferred, not solved: Section 5's guardrail table states a purpose ("prevents prompt injection and unauthorized solution leakage") that v1 only half-satisfies.

## Consequences

### Positive

- Leakage detection runs at zero added LLM cost or latency, on the platform's highest-frequency AI call path.
- The check is deterministic: identical Teacher output, reference solution, and hint level always produce the same verdict, unlike an LLM-based review that could vary across calls on identical input.
- Not vulnerable to the injection/manipulation classes an LLM-based reviewer would be exposed to, since it isn't a model call interpreting adversarial text.
- Reuses ground truth (the Pre-Flight-verified reference solution) that already exists from an independent, already-mandatory gate — no new verification work needed to obtain it.

### Negative

- Recall is bounded by substring/near-match tuning: a leakage attempt that doesn't textually resemble the reference solution — paraphrased, restructured, or an equivalent-but-differently-worded answer — can pass through undetected. This is a real gap in what the check catches, not an implementation footnote.
- Prompt-injection detection ships with no check at all in v1. The guardrail's stated purpose in the PRD is only half-satisfied by what actually ships.
- If injection detection is later added as an LLM-based check, it would sit alongside a leakage check that deliberately avoids LLM calls — the guardrail's two halves would run on architecturally different mechanisms. That needs to stay an explicit, documented split, not an accidental inconsistency discovered later.

### Neutral / Risks

- Whether the deterministic approach "proves insufficient" for injection has no defined trigger or evaluation criteria yet — that threshold is an open question for whoever picks up injection detection.
- Near-match tuning (how much textual similarity counts as leakage) is not specified by this ADR. It's an implementation/technical-design detail with real correctness consequences either direction: too loose blocks legitimate hint content as false leakage; too tight lets real leakage through.

## Confirmation

- No code implements this yet as of this writing; there is no automated check to point to today.
- Once built: fixture-based tests against the AI Teacher Engine test double (ADR-0004, `docs/SPEC.md`) assert that Teacher output above the learner's current hint level is stripped or blocked before rendering, using known reference solutions and known near-match variants — verifying the deterministic comparison without live model calls. A named confirmation case: PRD story 36's own framing — a Level 2 hint must never contain the Level 5 answer.

## Relationships and References

- Related to: [ADR-0004](./0004-openai-compatible-single-model-adjustable-effort.md) — this decision's core driver (avoiding an added model call on a high-frequency path) directly extends ADR-0004's cost/effort-per-task reasoning.
- Refined by: [ADR-0012](./0012-prompt-shield-near-match-algorithm.md) — fills the near-match algorithm gap this ADR left open (see Neutral/Risks above); this ADR's core decision (deterministic check, no LLM call) remains authoritative and unchanged.
- Supporting evidence: [docs/INITIAL_PRD.md](../INITIAL_PRD.md) Section 5 (guardrail table — Prompt Shield Filter), user stories 36–37; [docs/SPEC.md](../SPEC.md) ("Prompt Shield" line; "Out of scope: LLM-based prompt-injection detection").
- Owning implementation package: none yet — no code implements this as of this writing.
