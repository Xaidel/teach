# Pitfalls and Verification — operating knowledge for the fullstack branch

The verified, hard-won details of working in tpl-fsfba-ts family
repos. Load this when a check fails for no obvious reason, before
visual verification, or when building throwaway prototype routes.
Every item here was observed in real template work; the search-param
and lint items are version-sensitive (router 1.170 / eslint 10 era) —
re-verify against the repo's installed versions before trusting them
blindly.

## Search-param typing resolves `any` (template codegen)

In this codegen the `Register` interface carries no search map, so
`Route.useSearch()` and even `useSearch({ from })` return `any`,
tripping `@typescript-eslint/no-unsafe-assignment`. Working pattern:

```ts
// validateSearch with an explicit return type normalizes the URL at runtime
validateSearch: (search: Record<string, unknown>): MySearch => ({ ... }),

// then read the value imperatively with an explicit unknown cast + narrowing
const raw = (router.state.location.search as Record<string, unknown> | undefined)?.variant
const variant: VariantKey = raw === 'B' || raw === 'C' ? raw : 'A'
```

`useRouter()` subscribes to router state, so this re-renders on
navigation. Do NOT fix with `as` at the call site: if the source
already types correctly, `no-unnecessary-type-assertion` flags the
cast; if it is `any`, `no-unsafe-assignment` remains. Explicit
assertions through `unknown`-shaped types are the lint-clean escape
hatch.

## Lint and type strictness that bites

- **`restrict-template-expressions`**: template literals reject raw
  numbers and `string | undefined`. Use `${String(x)}` for numbers;
  for index-access values, hoist to a local and narrow it first —
  TS does not narrow `obj[key]` across ternaries for non-literal
  keys.
- **`noUncheckedIndexedAccess`**: array and record reads are
  `T | undefined` — `const step = SCRIPT[i] ?? SCRIPT[0]`, then
  guard.
- **Unused destructured locals** trip `noUnusedLocals` — destructure
  only what the component actually uses (easy to miss when one hook
  return feeds several branches).
- **`React.JSX.Element`** as a return type without importing React
  compiles fine here (UMD namespace from `@types/react`) — the
  template's own files do it; copy the pattern.
- **Type-aware lint needs the generated tree**: typecheck/lint
  resolve route types from `src/routeTree.gen.ts`. Start `pnpm run
  dev` (or build) once after adding a route file so the tree
  regenerates; a fresh checkout can fail typecheck until then.
- **Run prettier before final lint/typecheck**: `pnpm exec prettier
  --write <file>` reflows long JSX, can split string literals, and
  shifts lint line numbers. Sequence: edit → prettier → lint →
  typecheck.

## Environment and tool quirks

- **Node engine warning**: host Node 24 vs the template's
  `>=22.13 <23` prints a pnpm `Unsupported engine` warning — benign,
  ignore it.
- **Dev server dies between long checks** (SIGTERM, exit 143):
  restart `pnpm run dev` right before visual verification and wait
  for `ready in`. On `Port 3000 is already in use`, an earlier
  instance survived — reuse it.
- **`pnpm run build` while dev runs** can SIGTERM the dev server —
  stop dev first or expect to restart it.
- **`read_file` misdetects binary**: files heavy on em-dashes and
  curly quotes (common in UI copy) can be reported as binary. The
  file is fine — confirm with `file <path>` (returns "Unicode text"),
  then read line ranges with terminal `sed -n '<a>,<b>p'`. Never
  rewrite the file.
- **Terminal heredocs reject `&`**: a heredoc containing `&` (e.g. a
  regex like `name: /Food & markets/`) trips the backgrounding
  guard. Write such scripts with `write_file` instead.
- **Click-outside backdrops eat their own toggle**: a
  `fixed inset-0 z-20` backdrop that closes a dropdown intercepts
  clicks on the dropdown's own toggle (z-auto) — clicking the toggle
  to close hits the backdrop, so the panel never closes via its
  toggle. Give the toggle `relative z-30`.
- **Feature-free template**: don't assume routes/components exist —
  check `src/routes` and `src/shared/components/ui/` before
  importing.
- **`cn()` merges conflicts**: `cn` is clsx + tailwind-merge —
  conflicting utilities merge, so overrides like `rounded-xl` on a
  `rounded-full` base work.

## Throwaway prototype routes

UI experiments live at `src/routes/prototype.<name>.tsx` →
`/prototype/<name>`. One self-contained file, no abstractions, state
in memory, canned scripted data; a header comment marks it
PROTOTYPE.

- 3–5 structurally different variants behind a `?variant=` search
  param; a floating bottom switcher (arrows + keyboard ←/→, skipping
  when an input is focused) flips between them.
- Gate the switcher with `if (import.meta.env.PROD) return null` so
  a stray merge can't ship it.
- Simulate the engine with a scripted step machine (`thinking` →
  `question` → `response` phases, `setTimeout` auto-advance, cleanup
  in effect deps).

## Verification gauntlet

Gates: `pnpm run verify` = format:check + lint + typecheck + test +
build; `pnpm run test:e2e` builds first, then Playwright; `docker
build .` when deployment output or the Dockerfile changes. The
working sequence: edit → prettier on touched files → `format:check`
→ `lint` → `typecheck` → `test` → `build`. All green before claiming
done; a failing gate is reported with its blocker, never skipped.

Test classes: pure unit and component tests co-locate with the
feature (component tests carry `// @vitest-environment jsdom` +
`import '@testing-library/jest-dom/vitest'`); route integration and
source-boundary tests live under `tests/routes`; browser E2E lives
in `e2e/` and exercises the built app through the public UI.

## Browser verification loop

The Hermes browser tool may lack Chrome; the project's Playwright
chromium (`~/Library/Caches/ms-playwright`) is usually present. Drive
it with a throwaway script:

1. Start the dev server fresh (background), wait for `ready in`.
2. Write a Playwright script (`import { chromium } from
   '@playwright/test'`) that visits each state, captures `console`
   errors and `pageerror`s (assert zero), and screenshots to `/tmp`.
   The script **must run with cwd inside the repo** — ESM resolution
   does not see repo `node_modules` from elsewhere
   (`ERR_MODULE_NOT_FOUND`). Copy in, run, delete.
3. Walk the script in the app's real flow order — a state-machine UI
   (thinking → question → response) blocks any probe that skips a
   step. Set waits relative to the app's own timers: a prototype's
   900 ms thinking + 1400 ms response phases need 1.3–2.6 s waits;
   fixed `waitForTimeout`s beat retry loops.
4. **Probe interaction/selection state with DOM assertions, not
   screenshots** — `getAttribute('aria-pressed')`, `inputValue()`,
   `page.url()`, `getByRole` (name matching is substring-based).
   Vision pattern-matching misreads selection UI; reserve
   `vision_analyze` for layout questions (overlaps, cut-offs,
   pinning).
5. Deliver screenshots inline so the user reacts to pixels, then run
   the gates in order.