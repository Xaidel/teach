# Template Adoption

Use this checklist after creating a repository from the template.

If you adopted a copy that still contains the bundled Notes sample, remove it first
with `pnpm run reset:sample` (`scripts/reset-sample.mjs`). The script deletes the
sample feature, routes, browser acceptance, and the MVP and master specification
packages, regenerates the route tree, and verifies the green baseline.

## Retain

- `AGENTS.md` and the source-boundary rules, unless an accepted architecture decision
  deliberately changes them.
- `arch_docs/` and its ADR system.
- Strict TypeScript, ESLint, Prettier, Vitest, Playwright, and CI gates.
- The router factory, root document contract, Start CSRF middleware, and generated-file
  policy.
- Docker's non-root multi-stage runtime when Node container deployment remains valid.

## Replace

- Package name, version, visible application title, metadata, and README introduction.
- `docs/specs/master/` with the durable product vision.
- `docs/specs/mvp/` with the first bounded release contract and technical design.
- The first feature under `src/features/<name>` one complete vertical slice at a time;
  the removed Notes sample in git history is the worked example.
- Browser acceptance with the new product's critical journey.
- `.env.example` when the application gains runtime configuration.

## Remove When Unused

- `src/shared/components/ui` primitives that no surviving feature uses.
- Docker only when an accepted deployment decision selects a different supported
  runtime and supplies equivalent release evidence.

## Add Deliberately

- A runtime-validated `src/lib/env.server.ts` before reading secrets.
- Authentication only with a documented session/provider and authorization model.
- Persistence only with migrations, transaction semantics, local setup, release
  sequencing, and recovery expectations.
- Query caching only when route loaders and invalidation do not adequately express the
  application's cache requirements.

## Final Search And Verification

Search for `Notes`, `Folio`, `tpl-fsfba-ts`, and `mvp`. Remove stale example branding,
requirements, environment names, and browser assertions.

```sh
pnpm install --frozen-lockfile
pnpm run verify
pnpm run test:e2e
docker build .
```