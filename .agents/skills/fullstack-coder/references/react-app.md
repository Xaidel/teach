# React App — the non-fullstack branch (Vite + React Router SPA)

Load this only when the repo is a plain React frontend — Vite + React
Router, no TanStack Start, no server functions. Fullstack apps
(anything with `src/routes/` file routes and `createServerFn`) follow
the feature-slice architecture in SKILL.md instead; do not apply
atomic design to them. Shared React 19 patterns, component
conventions, tokens, and accessibility live in `react-and-ui.md` —
this file covers what differs: structure, routing, tooling.

## Tooling (pnpm)

This branch's conventions use **pnpm** as the package manager and
script runner — the current workflow, which supersedes the older
bun-based conventions in the generic React/TS skills. If an existing
repo uses another toolchain, follow the repo.

| Task | Command |
| --- | --- |
| Init project | `pnpm create vite <name> --template react-ts` |
| Dev server | `pnpm run dev` |
| Build / preview | `pnpm run build` / `pnpm run preview` |
| Add dependency | `pnpm add <pkg>` / `pnpm add -D <pkg>` |
| Lint & fix | `pnpm run lint --fix` |
| Run tests | `pnpm run test` (Vitest + jsdom; co-located `*.test.tsx`) |
| Run an executable | `pnpm dlx <command>` (one-off) / `pnpm exec <command>` (installed binary) |

## Project structure — atomic design

```text
src/
├── components/
│   ├── atoms/          UI primitives (Button, Input, Card, Badge)
│   ├── molecules/      Atom compositions (SearchBar, JobCard, NavItem)
│   └── organisms/      Complex sections (Header, Hero, JobGrid, DataTable)
├── layouts/            Page shells with <Outlet /> (RootLayout, AdminLayout)
├── pages/
│   ├── public/         Unauthenticated (Landing, About, Login)
│   ├── user/           Authenticated user (Dashboard, Profile)
│   └── admin/          Admin-only (AdminPanel, UserManagement)
├── hooks/              Custom hooks (useDebounce, useAuth)
├── services/           API/data layer (api.ts, auth.ts)
├── types/              Shared types (index.ts)
├── lib/                Utilities (utils.ts with cn())
├── routes/             React Router config (public.tsx, user.tsx, admin.tsx, index.tsx)
├── styles/
│   ├── tokens.ts       Design token source of truth
│   ├── tokens.css      Generated CSS variables (do not edit)
│   └── index.css       Tailwind entry (@import "tailwindcss"), @theme bridge
├── context/            React context providers
└── App.tsx             Root component with BrowserRouter
```

| Need | Tier |
| --- | --- |
| Single-purpose UI primitive (button, input, badge) | Atom |
| Functional unit combining atoms (search bar, card) | Molecule |
| Complex section with data or state (header, grid) | Organism |
| Page shell with navigation and `<Outlet />` | Layout |
| Full page view at a route endpoint | Page |

Atoms: `forwardRef` (this branch still uses it) or plain functions
in React 19, CVA variants, `displayName`, `className` prop,
`data-slot`. Molecules: named function exports, props interface
above the component, no outer margins. Organisms may fetch data or
manage local state; compose molecules. Layouts wrap `<Outlet />`
and handle navigation. Pages compose organisms; minimal styling.

## Routing — React Router v7

Organize routes by access level in `src/routes/{public,user,admin}.tsx`,
combined in `index.tsx`:

```tsx
export const publicRoutes: RouteObject[] = [{ path: '/', element: <Landing /> }]

export const userRoutes: RouteObject[] = [
  { element: <DashboardLayout />, children: [{ path: '/dashboard', element: <Dashboard /> }] },
]

export const routes: RouteObject[] = [...publicRoutes, ...userRoutes, ...adminRoutes]
```

## Data and state

Service modules in `src/services/` own API calls — typed fetch
functions returning `Promise<T>`; shared types in `src/types/`;
environment variables declared via `interface ImportMetaEnv` in an
`env.d.ts`-style module. State: `useState` local, `useReducer`
complex, context for subtree-shared state (auth, theme),
`useActionState`/`useOptimistic` for submissions. Error handling:
class error boundaries for render failures, try/catch + `instanceof
Error` narrowing for async paths, surface errors via state.

## Design tokens pipeline

`tokens.ts` is the single source of truth — never hardcode colors,
spacing, radii, shadows, or timing. Pipeline: `tokens.ts` →
`scripts/generate-tokens.ts` → `tokens.css` → `@theme` in
`index.css` → Tailwind utilities. After editing `tokens.ts`, run
`pnpm run generate:tokens`. Tailwind v4 requires
`@tailwindcss/postcss` (or the Vite plugin) — never `tailwindcss`
directly as a PostCSS plugin; CSS files use `@import "tailwindcss"`.

Token structure: `colors` (oklch, semantic pairs: background/
foreground, primary/primary-foreground, secondary, muted, accent,
destructive, border, input, ring, card), `darkColors` overrides,
`spacing`, `radius`, `fontSize`, `shadows`, `zIndex`, `durations`.
Access: Tailwind classes (`bg-primary`), raw CSS
(`var(--color-primary)`), JS (`import { colors } from "@/styles/tokens"`).

## Styling craft

`cn()` (clsx + tailwind-merge) everywhere; CVA variants on
primitives; semantic pairs only; responsive mobile-first
breakpoints; animation via CSS transitions by default, Framer
Motion only for orchestrated motion (AnimatePresence, layoutId,
drag/reorder) with `motion-reduce` fallbacks; timing tokens
(`duration-fast` 150ms … `duration-slower` 500ms). Icons:
lucide-react only. Tables: `@tanstack/react-table` with styled
`<Table>` components. Forms: React Hook Form with `useFieldArray`
for dynamic fields, integrated validation states.

Performance: lazy-load heavy components and code-split by route;
skeleton loaders; tree-shakeable imports; `loading="lazy"` +
WebP/AVIF images with responsive `srcSet`.

## Checklist

- [ ] Tier chosen by the selection table; feature logic not buried
      in atoms
- [ ] Props interface above the component; type-only imports;
      `@/` aliases, never relative
- [ ] `data-slot` on roots; `cn()` merging; `displayName` on
      forwardRef atoms
- [ ] New visual values added to `tokens.ts` first; generated
      `tokens.css` not hand-edited
- [ ] `focus-visible` rings; semantic labels; motion-reduce
      fallbacks
- [ ] Error boundaries around async sections; Suspense around lazy
      loads