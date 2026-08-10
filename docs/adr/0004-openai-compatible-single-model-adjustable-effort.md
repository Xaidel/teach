# ADR-0004: OpenAI-compatible API, single model family, adjustable reasoning effort per task

- **Date**: 2026-08-10
- **Status**: Accepted
- **Deciders**: Xaidel (sole maintainer)

## Context and Problem Statement

`docs/INITIAL_PRD.md` Section 11 requires the AI Teacher Engine to be the sole generator of explanations, hints, exercises, feedback, misconception analysis, and qualitative code review, and to never be the authoritative evaluator of a submission — but it doesn't specify a vendor, an API shape, or an integration technique. That gap is what this ADR fills.

The AI Teacher Engine has three call sites with very different cost/quality needs: hints (frequent, should be fast and cheap) versus exercise generation and Stage 2 qualitative code review (infrequent, need careful, higher-quality output). Whatever integration approach is chosen has to account for that difference without multiplying the integration surface.

The decision question: build the AI Teacher Engine's integration against a specific AI vendor's native SDK, or against a provider-agnostic contract — and if agnostic, how does task-cost differentiation (cheap hints vs. expensive generation/review) get handled without routing different tasks to different vendors?

## Decision Drivers

- **Vendor lock-in exposure**: a solo-maintained project has no leverage to negotiate around a single vendor's pricing changes, outages, or deprecations; the cost of being stuck is borne entirely by one person.
- **Integration layer simplicity**: one client against one contract is simpler to build, test, and maintain than multiple vendor SDKs with different auth, error handling, and rate-limit models.
- **Task-cost differentiation**: hints (frequent, cheap) and generation/review (infrequent, expensive) need different cost/quality trade-offs, but that difference shouldn't require a second integration surface (vendor-routing logic) to manage.
- **Swap cost if a change is ever needed**: how much of the integration layer has to be rewritten if the underlying provider or model needs to change.

## Decision

We will build the AI Teacher Engine's integration against an **OpenAI-compatible API contract**, using a **single model family** across all three call sites (AI Teacher Engine explanations/hints, Stage 2 Code Reviewer, Exercise Generator). Task cost/quality differentiation is achieved by dialing **reasoning effort per call** (low for hints, high for generation and review) on that one model family — not by routing different tasks to different vendors or model families.

This decision fixes the integration contract shape and the effort-dialing approach. It does not fix which specific model family ships in v1 — that remains a separate, more volatile choice. It also does not change the AI Teacher Engine's role boundary from PRD story 28: it is never the authoritative evaluator, regardless of which provider sits behind this contract.

## Alternatives Considered

### Option A: Lock to a single vendor's native SDK

Build the AI Teacher Engine, Stage 2 Code Reviewer, and Exercise Generator directly against one vendor's SDK (e.g. a specific provider's own client library).

- Benefits: access to vendor-specific features an OpenAI-compatible shim might not expose (proprietary structured-output or tool-use mechanics, prompt caching, batching, vendor-specific reasoning-effort controls); potentially simpler integration against one well-documented, fully-featured SDK; no risk of a compatibility-layer abstraction failing to expose something a specific vendor offers.
- Costs and risks: hard-couples the platform to one vendor's pricing, availability, and API stability. Switching vendors later — for pricing, an outage, or a better model elsewhere — means rewriting the integration across three call sites (AI Teacher Engine, Stage 2 Reviewer, Exercise Generator), not one. For a solo builder, that migration cost falls entirely on one person if it's ever needed.

### Option B (chosen): OpenAI-compatible contract, single model family, reasoning-effort dial per task

Build one client against an OpenAI-compatible API contract, used by all three call sites, with reasoning effort as the per-task dial.

- Benefits: the underlying provider/model is swappable without rewriting the integration layer, since many providers (including several open-weight/self-hosted options) expose OpenAI-compatible endpoints; task differentiation is handled with one dial (reasoning effort) on one model family rather than a second integration surface for vendor routing, keeping the integration layer simple; matches the framing already established in PRD story 30.
- Costs and risks: an OpenAI-compatible contract is a lowest-common-denominator shape — vendor-specific features not exposed through it (proprietary caching, batching, or reasoning-control mechanics) aren't available unless the client is extended per-vendor, which erodes the swappability premise for any feature that turns out not to be portable. Committing to one model family with an effort dial, rather than per-task vendor routing, forecloses using a different vendor's model specifically because it's stronger at one task category (e.g. Stage 2 review) — that option isn't available without revisiting this decision.

## Consequences

### Positive

- Swapping the underlying provider or model later touches one client configuration, not three call sites.
- Task cost is managed with a single reasoning-effort dial instead of a second integration surface (vendor-routing logic) to build and maintain.
- The AI Teacher Engine's role boundary (sole generator, never the authoritative evaluator — PRD story 28) is untouched by this decision; the OpenAI-compatible client only governs the generation side.

### Negative

- Vendor-specific capabilities not exposed by the OpenAI-compatible contract (proprietary caching, batching, reasoning-control mechanics) are unavailable unless the client is extended per-vendor — real erosion of the swappability premise if a needed capability turns out not to be portable.
- Locking to one model family with an effort dial forecloses picking a different vendor's model specifically because it's stronger at one task category (e.g. Stage 2 qualitative review); that would require revisiting this decision, not a quiet workaround.
- The abstraction's central promise — swappability — is a design intent, not yet a proven property: it hasn't been tested against an actual second provider because no vendor swap has been attempted.

### Neutral / Risks

- Which specific model family ships in v1 is a separate, more volatile decision this ADR does not fix.
- If reasoning-effort dialing alone proves insufficient to hit quality bars for a specific task (most likely Stage 2 review), revisiting task-to-model routing — partially reopening Option A's territory for that one task — becomes a live question. That would need its own ADR or amendment, not a silent implementation deviation.

## Confirmation

- No code implements this yet as of this writing; there is no automated check to point to today.
- Once built: the AI Teacher Engine's client is typed against the OpenAI-compatible contract, with no vendor-specific SDK types leaking into calling code — verifiable by dependency/architecture review. Reasoning effort is passed as an explicit per-call parameter, not hardcoded, verifiable through the fixture-based AI Teacher Engine test double (`docs/SPEC.md`) asserting the effort level passed per task type (hint vs. generation vs. review).

## Relationships and References

- Related to: [ADR-0002](./0002-both-tracks-in-v1.md) — the shared integration-test seam swaps the AI Teacher Engine's client for a deterministic test double at exactly the interface boundary this ADR defines.
- Supporting evidence: [docs/INITIAL_PRD.md](../INITIAL_PRD.md) Section 11 (AI Teacher Engine) and user story 30; [docs/SPEC.md](../SPEC.md) ("AI integration", "AI Teacher Engine responsibilities", "AI Teacher Engine test double").
- Owning implementation package: none yet — no code implements this as of this writing.
