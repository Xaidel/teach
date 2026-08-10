# run-reviewer

One half of the two-agent PR loop. This skill drives the
**reviewer tab**; its sibling `run-implementer` drives the
implementer tab. Together they run a full issue → PR → review → merge
cycle with no prompt pasting — you type `/run-reviewer #123` (or
`/run-implementer #123`) in each tab and the skills figure out the
current step by reading the PR thread.

## Quick start

```text
Tab 1 (implementer):  /run-implementer #123
Tab 2 (reviewer):     /run-reviewer #123
```

Each invocation runs one step and tells you which tab to invoke
next. Optional override: `/run-reviewer #123 step 4 round 5` forces
a specific step and/or blows past the 3-round cap. Optional
`--base <branch>` overrides the base branch read from the PR
(defaults to the PR's `baseRefName`).

### When to use `--base`

`--base <branch>` makes the loop target a base branch other than
`main`. Resolution: explicit `--base` > the found PR's `baseRefName`
> `main`. Scenarios:

- **Targeting a non-main branch** — release branch, staging, a
  long-lived feature branch. Pass it to the **implementer** at
  creation: `/run-implementer #123 --base release/2.x`. The worktree
  base, the PR, the rebase/merge target, and post-merge CI
  attribution all follow that base. This is the *only* moment the
  base cannot be derived from a PR (none exists yet), so this is
  where `--base` matters.
- **Reviewing a mis-targeted PR** — the PR's `baseRefName` is wrong,
  or you disagree with it. Pass it to the **reviewer**:
  `/run-reviewer #123 --base develop`.
- **Usually you don't need it** — with no flag, the implementer
  assumes `main` at creation, and every later step (implementer
  *and* reviewer) reads the PR's actual `baseRefName`, which is
  exactly the base the implementer created the PR against.

Rule of thumb: pass `--base` to the **implementer** (it creates the
PR); the reviewer inherits the base from the PR automatically and
only needs the flag in the exceptional mis-targeted case.

## Prerequisites

- `implement` and `code-review` skills installed in `~/.agents/skills`
  (or `.agents/skills`) — these are **delegated to**, never edited.
- `gh` authenticated against the repo's remote.
- Both tabs run in the same clone of the target repo.

## The two-agent PR loop — whole workflow

Keep in sync with `run-implementer/README.md`. The PR thread is the
shared state machine: round numbers, verdicts, and reviewed SHAs all
live in the thread, so the two tabs never need a side ledger.

| You type | Tab | What happens |
|---|---|---|
| `/run-implementer #X` | Implementer | Blocked check → worktree `wt/<X>` + branch `feat/<X>-<slug>` → implement (via `implement` skill process) → verification gauntlet → PR with body template (`Closes #X`) → **Round 1** marked comment → handoff doc |
| `/run-reviewer #X` | Reviewer | Finds PR, reads thread, extracts run-id → two-axis review (Standards + Spec, via `code-review` skill) → marked review comment with verdict → complete review pasted in chat |
| *(FINDINGS REMAIN)* `/run-implementer #X` | Implementer | Holistic understanding → **action plan** comment → fixes → gauntlet → **fixes ready** with SHAs |
| `/run-reviewer #X` | Reviewer | Delta review vs last-reviewed SHA → findings table (RESOLVED / PARTIALLY / NOT ADDRESSED) → verdict |
| *(APPROVED)* `/run-reviewer #X` | Reviewer | Sign-off: re-verify head SHA, final scan, sign-off comment, formal GitHub approval |
| `/run-implementer #X` | Implementer | Merge & close: re-fetch base, squash-merge with `Closes #X`, verify issue closed, attribute post-merge CI |
| `/run-implementer #X` | Implementer | Cleanup & close-out: remove worktree/branch, stop own paseo agents, file follow-up issues, close-out handoff |
| `/run-implementer sweep` | Implementer | **Sweep lane**: enumerates open follow-ups (`[follow-up:<X>]` title or `follow-up-issue` label), presents the batch for confirmation, then one worktree/branch/PR closing all of them |

### Sweep lane — batch follow-up cleanup

Follow-ups filed by Step 7 are small and independent, so they are
handled as one batch instead of N full loops:

1. `/run-implementer sweep` (no issue number) — enumerates open
   follow-ups, you confirm the batch and may exclude any.
2. One worktree `wt/sweep-<date>`, one branch `chore/sweep-<date>-<slug>`,
   one PR with `Closes #51, Closes #52, …` in the body.
3. Each follow-up is one scoped commit referencing its issue; the
   whole batch runs the gauntlet once.
4. The reviewer reviews the batch as one delta (found via the
   `Closes #<X>` search); rounds/cap/hard-stops work as usual.
5. Merge closes every listed issue; cleanup removes the batch unit
   (and files any follow-ups the sweep review surfaced).

**Stamping** — Step 7 creates each follow-up as
`[follow-up:<X>] <summary>` (X = the original issue) with the
`follow-up-issue` label, a `Part of #<X>` body line, and a
task-list item appended to the parent issue — so GitHub renders the
child as "Part of #<X>" and the parent shows its open follow-ups.

### Agent-comment markers

Every loop comment (PR or issue thread) carries a visible prefix plus
a hidden machine block:

```text
🤖 [AI · <role> · R<N>]

<!-- @agent-comment v1
role: <implementer|reviewer>
run: <run-id>
issue: <X>
round: <N>
generated-by: run-reviewer
-->
```

The run-id is generated by the implementer in Step 1 and derived by
the reviewer from the thread — it keeps the loop coherent when two
different GitHub users run the two tabs.

## Your seat — reviewer

You own steps 2, 4, and 5: Round 1 review, delta re-review,
sign-off. The entry flow routes on the PR thread alone.

- **Review the real head**: fetch first, compare `headRefOid` with
  your local ref, and state the reviewed SHA in every comment.
- **Delta discipline**: Round 1 reviews the whole diff; later rounds
  review only the delta since the last-reviewed SHA, with a
  findings table (RESOLVED / PARTIALLY / NOT ADDRESSED).
- **Hard stop after sign-off**: once your sign-off comment is on the
  thread, re-invocation reports loop complete and redirects to the
  implementer (merge & close) — never re-reviews or re-posts.

## Caveats — things that will bite you

- **You never merge.** Your terminal act is sign-off + formal GitHub
  approval. The loop closes when the implementer merges and cleans
  up.
- **Sweep batches are one delta.** A follow-up sweep (`/run-implementer
  sweep`) produces one PR closing several issues; it is reviewed as a
  whole batch, found via the `Closes #<X>` search (not the
  `feat/<X>-*` branch lookup).
- **3-round cap**: after three review rounds without convergence, you
  escalate to the user instead of cycling. Override with `round M`.
- **Multi-instance isolation**: other two-agent systems may work
  other issues concurrently. Only consider marked comments whose
  issue matches yours; ignore marked comments for other issues.
  Enforced in the shared protocol of `SKILL.md` (identical in both
  skills) — this bullet is the human-facing summary.
- **Markers are load-bearing**: unmarked comments are human, marked
  comments are automated. Don't hand-edit or delete loop comments —
  the state machine reads them.
- **Handoff docs are a same-machine convenience**; when tabs run on
  different machines, the marked PR thread carries everything.

## Limitations — honest bounds

- **GitHub only.** The PR thread is the state machine, driven via
  `gh`; other trackers (GitLab, etc.) are unsupported.
- **Requires `implement` + `code-review` present.** The skill stops
  and reports if either is missing — there is no fallback.
- **Not autonomous end-to-end.** A human routes between tabs; each
  invocation runs one step. This is deliberate — you stay in control
  of the loop.
- **One system per issue.** The isolation rules assume no other
  system touches the same issue.
- **Thread discipline matters.** Deleted or edited loop comments can
  confuse state detection; the reviewed-SHA anchors mitigate but do
  not eliminate this.
- **No test suite for the skills themselves.** Validated by
  `validate_skill.py` and the repo's checker/CI on the PR that
  shipped them.
- **The shared protocol must stay in sync** across `run-implementer`
  and `run-reviewer` — both SKILL.md and both README.md.

## Contents

- `SKILL.md` — the agent-facing process (entry flow, steps, markers,
  override, pitfalls)
- `agents/openai.yaml` — harness interface definition
- `README.md` — this human-facing walkthrough, caveats, limitations

## License

Apache-2.0. See the repository license for terms.