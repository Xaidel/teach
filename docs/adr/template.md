# ADR-NNNN: Decision-focused title

- **Date**: YYYY-MM-DD
- **Status**: Proposed
- **Deciders**: Xaidel (sole maintainer)

## Context and Problem Statement

What situation requires a decision? Which forces are in tension? State the decision
question and relevant current-state facts without advocating for a choice. Note explicitly
if part of this is already settled by `docs/INITIAL_PRD.md` or `docs/SPEC.md` — an ADR
should only decide what isn't already fixed product scope.

## Decision Drivers

- Mandatory constraint or quality attribute.
- Business, technical, operational, security, cost, or delivery driver.

## Decision

For a proposal: "If accepted, we will ...". For an accepted record: "We will ...". State the
durable boundaries and invariants this decision fixes — what must and must not happen —
without prescribing private implementation details that aren't themselves the decision.

## Alternatives Considered

### Option A: Name

Comparable description.

- Benefits: why this option is credible.
- Costs and risks: why it wasn't selected, or what it compromises.

### Option B (chosen): Name

Comparable description.

- Benefits: why it best satisfies the drivers.
- Costs and risks: real trade-offs accepted, not just the winner's remaining downsides.

## Consequences

### Positive

- New benefit or enabled capability.

### Negative

- Cost, constraint, or required follow-up. Every meaningful decision has one of these —
  don't skip this section.

### Neutral / Risks

- Uncertainty, shifted responsibility, or condition to monitor. Name any open question this
  decision doesn't resolve, rather than implying it's handled.

## Confirmation

How will a future contributor tell whether this is actually being followed — tests,
architecture checks, migration/schema review, or manual review honestly labeled as manual if
no automation exists yet? Don't promise a check that can't actually validate the decision.

## Relationships and References

- Supersedes / Amends / Refines / Deprecates: `<ADR link>`, if applicable.
- Related to: `<ADR link>`, if it shares a subject without changing authority.
- Supporting evidence: link to the PRD/SPEC section, issue, or design doc this draws from.
- Owning implementation package: link once real code exists; state "none yet" until it does.
