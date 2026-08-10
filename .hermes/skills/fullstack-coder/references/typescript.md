# TypeScript — strict conventions, validation, tooling

The TypeScript baseline for all three branches. Load for
framework-agnostic TS work (libraries, CLIs, scripts, backend
services without React) and as the shared typing discipline inside
React apps. Fullstack apps additionally follow the template's
tsconfig shape below.

## Tooling matrix

Match the repo's existing conventions first — never force a package
manager on an app that uses another.

| Shape | Tooling |
| --- | --- |
| tpl-fsfba-ts family / TanStack Start apps | pnpm 10, `#/*` alias to `src/*`, vitest, prettier |
| Plain React SPA (this skill's SPA branch) | pnpm, `@/` alias, Vitest via `pnpm run test`, prettier |
| Framework-agnostic TS (libs, CLIs, scripts) | pnpm as sole package manager and script runner; `pnpm dlx` for executables |

For framework-agnostic projects: `pnpm init`, ESM-first
(`"type": "module"`), dev tools under `devDependencies`, `pnpm
install` after manifest changes. The pnpm `Unsupported engine`
warning on host Node 24 vs declared Node 22 LTS is benign.

## tsconfig shape

Strict mode with modern defaults (the fullstack template's flag set,
core subset shown):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "useDefineForClassFields": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["vite/client", "node"],
    "paths": { "#/*": ["./src/*"] }
  }
}
```

`types: ["vite/client", "node"]` is what types `import.meta.env`;
the `#/*` path alias is declared in both tsconfig `paths` and
package.json `imports`.

Do not enable `verbatimModuleSyntax` casually in TanStack Start
apps — it can cause server bundles to leak into client bundles.

## Coding conventions

- Annotate all function parameters and return types; TSDoc exported
  APIs (concise: what it does, params, returns, throws).
- Prefer `type` over `interface`; use `interface` only for
  framework declaration merging (e.g. TanStack Router's `Register`).
- Never `any` in maintained source. Narrow `unknown` with type
  guards. Tool-owned generated files may carry framework-generated
  types that do not follow this rule.
- Prefer literal union types over enums:
  `type Status = 'active' | 'inactive'`.
- Use `X | null` or `X | undefined` for optional values — no custom
  wrapper types.
- Use `satisfies` to validate type conformance while preserving
  inference.
- Named exports; type-only imports (`import type { X }`).
- Comments explain why, never restate what; self-documenting code
  needs no narration.

## Runtime validation at I/O boundaries

Use Zod at every untrusted boundary — API responses, user input,
file reads, environment variables — and infer static types from
schemas:

```ts
import { z } from 'zod'

const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  email: z.string().email(),
})

type User = z.infer<typeof UserSchema>

function parseUser(data: unknown): User {
  return UserSchema.parse(data)
}
```

In fullstack apps, schemas are client-safe modules
(`notes.schema.ts`) shared between UI and server; server functions
validate through `.validator(Schema)` so the boundary is typed and
checked at runtime. Environment values are validated once in a
focused `env.server.ts`-style module — never read raw
`process.env` in scattered code.

## Lint shape

Flat config with type-aware rules; the template's baseline is
`eslint.configs.recommended` + `typescript-eslint`
`strictTypeChecked` + `stylisticTypeChecked` + prettier, with
`consistent-type-imports: error` and
`consistent-type-definitions: ['error', 'type']`. The template
scopes two rules off for routing-adapter files (`src/router.tsx`,
`src/routes/**/*.tsx`, `src/features/**/*.functions.ts`):
`consistent-type-definitions` (interfaces are permitted there — e.g.
the router's `Register` interface) and `only-throw-error`. Do not
"fix" those interfaces into types. The strictness that bites in
practice: `restrict-template-expressions` (numbers
and `string | undefined` in template literals — `String(x)` or
narrow through a local first), `no-unsafe-*` on implicit `any`
flow (explicit assertions through `unknown` are the sanctioned
escape hatch), and `noUnusedLocals` on destructured-but-unused
variables.

## Handling unfamiliar APIs

When unsure about a package's interface, inspect type definitions
rather than guessing or trusting possibly outdated training data:

1. Read `.d.ts` files directly — `node_modules/<pkg>/dist/index.d.ts`
   or `node_modules/@types/<pkg>/index.d.ts`.
2. Explore at the type level with utility types:
   `ReturnType<typeof fn>`, `Parameters<typeof fn>`, `keyof T`,
   `Awaited<T>`.
3. Use go-to-definition to inspect signatures and overloads.

Then correct the code from what the types say.

## Done criteria

- [ ] Strict flags on; no `any` introduced; `unknown` narrowed
- [ ] Every public function/component/type annotated and TSDoc'd
- [ ] Every untrusted boundary validated by a Zod schema; types
      inferred from schemas
- [ ] Lint and typecheck pass on the changed surface