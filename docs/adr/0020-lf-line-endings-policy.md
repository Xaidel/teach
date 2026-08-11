# ADR-0020: LF line-ending policy for all text files

- **Date**: 2026-08-11
- **Status**: Accepted
- **Deciders**: Xaidel (sole maintainer)

## Context and Problem Statement

The repo had no declared line-ending policy. On a Windows machine with git's
`core.autocrlf=true` (the git-for-Windows default), a fresh checkout converts every
text file to CRLF, while prettier's `--check` defaults to `endOfLine: lf`. The result:
`pnpm run verify`'s `format:check` step flagged every file on a clean Windows clone,
and the two-agent PR loop had to normalize its worktree by hand to run the gauntlet.

Investigation established that the committed blobs were already LF — the failure was
purely checkout-time conversion with no declared policy. The defect was therefore
not in the stored tree but in the absence of a statement of what the canonical form
is, leaving the working tree's EOL to platform defaults.

This decision was shipped as PR #44 (issue #42); this ADR records the decision's
rationale, which previously lived only in the PR thread.

## Decision Drivers

- **Tooling consistency**: prettier, eslint, and the TypeScript toolchain expect and
  emit LF; the canonical stored form should match what tooling writes.
- **Platform-independent checkouts**: the working tree's EOL must not depend on a
  contributor's OS or git configuration.
- **Minimal machinery**: a single root-level declaration, no per-file exceptions
  (the repo tracks no binary files today).
- **Consistency with prior art**: the walking skeleton's Docker/sandbox and CI-facing
  artifacts (shell scripts, Cargo files, `.node-version`) are authored as LF.

## Decision

- Add a `.gitattributes` at the repo root declaring `* text=auto eol=lf`.
- LF is the canonical form: blobs are stored as LF, and checkouts produce LF on every
  platform, overriding `core.autocrlf` on Windows.
- `text=auto` keeps git's binary detection: files git detects as binary are not
  converted; no explicit `binary` attribute entries are added (the repo tracks no
  binary files; any future binary can be marked explicitly or rely on the heuristic).
- No editor-level policy file (e.g. `.editorconfig`) is added: the `.gitattributes`
  governs checkout conversion, which is the actual failure mode.

## Alternatives Considered

### Option A: No policy (status quo)

Keep the repo without a line-ending declaration and let each contributor's
`core.autocrlf`/editor settings decide.

- Benefits: nothing to maintain.
- Costs and risks: Windows clones produce CRLF working trees, breaking
  `format:check` on every fresh checkout; phantom working-tree diffs; the exact
  failure this ADR fixes. Rejected.

### Option B: `.editorconfig` with `end_of_line = lf`

Declare the policy for editors only.

- Benefits: guides editors that honor EditorConfig.
- Costs and risks: EditorConfig does not govern git's checkout-time conversion —
  `core.autocrlf=true` still materializes CRLF regardless of what editors are told;
  the observable failure mode (fresh-clone `format:check`) would remain. Rejected.

### Option C: `eol=crlf`

Canonical CRLF, matching a Windows-native working tree.

- Benefits: Windows checkouts match the OS convention.
- Costs and risks: the repo is tooling-first (prettier, eslint, shell scripts in the
  sandbox image, CI-oriented docs) where LF is the de-facto standard; choosing CRLF
  would make every non-Windows contributor and every tool the odd one out. Rejected.

### Option D (chosen): `.gitattributes` with `* text=auto eol=lf`

- Benefits: one line fixes both stored-form and checkout behavior; `text=auto`
  preserves binary detection; the committed tree (already LF) is unchanged, making
  the change a zero-diff policy declaration plus a normalized working tree.
- Costs and risks: any future text file that genuinely needs CRLF on checkout must
  declare an explicit exception; no such file exists today.

## Consequences

### Positive

- `format:check` (and therefore `pnpm run verify`) passes from a fresh clone on any
  platform, including Windows with stock `core.autocrlf=true`.
- The working tree no longer carries phantom CRLF diffs; the two-agent loop's manual
  worktree normalization is obsolete.
- Future binary additions are handled by git's `text=auto` heuristic or an explicit
  `binary` attribute.

### Negative

- Contributors using tools that genuinely want CRLF on Windows must not rely on the
  default; any such file needs an explicit per-path attribute.

### Neutral / Risks

- No `.editorconfig` exists to guide editors that ignore git's conversion; if an
  editor rewrites to CRLF on save, git's clean filter re-normalizes on add, so the
  stored tree stays LF — a noisy-but-safe outcome, not a corruption risk.
- The ADR-0019 file may temporarily coexist with a numbering gap in `docs/adr/` if
  its local-only record has not landed on main when this ADR merges; per the ADR
  README, gaps are acceptable.

## Confirmation

- Fresh clone with `core.autocrlf=true` on Windows: `git ls-files --eol` reports
  `w/lf` for every file, and `pnpm run format:check` passes. Verified on PR #44
  (`git clone -b feat/42-normalize-line-endings`: `w/crlf=0` for all 228 previously
  CRLF files; prettier check clean).
- `git add --renormalize .` produces no diff (blobs already LF), so the tree is
  confirmed conformant without a normalization commit.

## Relationships and References

- Related to: nothing — this is the repo's first tooling-policy ADR.
- Supporting evidence: issue [#42](../../issues/42); PR [#44](../../pull/44)
  (implementing commit, merged to main as `4b2549c`).
- Owning implementation package: repo root `.gitattributes` — the decision is
  implemented; no further package owns it.
