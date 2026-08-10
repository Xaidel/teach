# Fullstack App — architecture and TanStack Start in depth

The fullstack branch of the skill. Load this when working in a
TanStack Start app: before scaffolding, adding routes, server work,
auth, or deployment config. The binding contract lives in SKILL.md;
this file carries the depth — what each layer owns, how the framework
behaves, and the checklists that catch mistakes.

## Architecture and ownership

### Default source shape

```text
src/
├── routes/                     File-route declarations, loaders, guards, metadata, server.handlers
│   ├── __root.tsx              Document shell
│   ├── notes.index.tsx         /notes/
│   └── notes.$noteId.tsx       /notes/$noteId
├── features/
│   └── notes/                  One business capability
│       ├── pages/              Route-facing compositions
│       ├── components/         Feature-owned rendered UI
│       ├── notes.schema.ts     Client-safe contracts + Zod validation
│       ├── notes.functions.ts  createServerFn wrappers (safe to import from UI)
│       └── notes.server.ts     Server-only operations (DB, filesystem, secrets)
├── shared/                     Proven cross-feature UI (components), hooks, types
│                               — only on real reuse, no feature knowledge
├── lib/                        Focused app utilities (cn.ts, env.server.ts, logger.ts)
├── router.tsx                  Fresh router factory (getRouter)
└── start.ts                    Global Start config + CSRF middleware
```

A feature's subfolders (`pages`, `components`, `hooks`) are local
organization inside the slice — not application-wide horizontal
layers. Do not pre-create empty folders.

**Why capability slices (a deliberate veer).** TanStack's own docs
and examples organize by type — `src/components/`, `src/utils/` —
and its server-functions guide proposes a `utils/` folder for
`*.functions.ts`/`*.server.ts`/schema modules. The org standard
deliberately layers by business capability instead: code sits as
close as possible to where it is relevant (Kent C. Dodds'
colocation), features cannot reach into each other's internals
(capability-shaped structure, as in bulletproof-react), and the
dependency graph stays acyclic (Clean Architecture's dependency
rule). The one global layer is the design system:
`src/shared/components/ui` — atomic design is a UI-system
methodology (Brad Frost), so the tier system lives there, not across
the app.

### Route modules are routing adapters

A route module owns `createFileRoute`, the path, loader, `beforeLoad`,
search/param validation, head metadata, SSR options, route fallbacks
(`pendingComponent`, `errorComponent`, `notFoundComponent`), routing
layouts (`<Outlet />`), and `server.handlers`. It imports the feature
page and client-safe feature functions:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { listNotes } from '#/features/notes/notes.functions'
import { NotesPage } from '#/features/notes/pages/notes-page'

export const Route = createFileRoute('/notes/')({
  loader: () => listNotes(),
  component: NotesPage,
})
```

An extracted feature page must not import the route module's `Route`
object — that creates a circular dependency. Use `getRouteApi()`:

```tsx
import { getRouteApi, useRouter } from '@tanstack/react-router'

const notesRoute = getRouteApi('/notes/')

export function NotesPage(): React.JSX.Element {
  const notes = notesRoute.useLoaderData()
  const router = useRouter()
  // mutate, then: await router.invalidate()
}
```

Keep a routing-only layout in the route file; a feature shell that
composes feature UI belongs in its feature slice. The route file
declares fallback *options*; the fallback *component* may be
feature-owned when it renders feature-specific UI.

### Dependency direction (full table)

| Importer | Allowed application imports |
| --- | --- |
| `src/routes` | Client-safe feature APIs, feature pages, shared UI, `src/lib` |
| `src/features/<feature>/pages` | Same feature, shared UI/hooks/types, `src/lib` |
| `src/features/<feature>/components` | Same feature client-safe modules, shared UI/hooks/types, `src/lib` |
| `src/features/<feature>/*.functions.ts` | Same feature schemas and server-only operations |
| `src/features/<feature>/*.server.ts` | Same feature, server-only `src/lib`, private infrastructure packages |
| `src/shared/*` | Other shared code and `src/lib` only |
| `src/lib` | Other focused `src/lib` modules only |
| `src/router.tsx`, `src/start.ts` | Generated routes and `src/lib` framework glue |

Environment rules: browser-reachable code never imports
`*.server.ts`, Node-only modules, private SDKs, secret env access, or
`@tanstack/react-start/server`. Server-function wrappers are
importable from routes and browser UI because Start transforms them
into RPC stubs. Static server-function imports only — dynamic imports
obscure the transform boundary. A client-safe barrel never re-exports
a server-only value.

### Auth and persistence extensions

Authentication is intentionally absent from the reference shape. When
an app adds it: keep session/provider access in `src/lib/*.server.ts`
or an owning auth feature; resolve a trusted principal from server
request or session data; authorize every private server function and
server route internally; add route guards only for redirect and
navigation UX; validate trusted origins, use `httpOnly` +
`sameSite` + production `secure` cookies, retain CSRF protection;
record the identity model in an application ADR and technical design.

Persistence stays behind server functions in the owning feature or a
focused server utility. Database selection, migrations, transaction
boundaries, tenancy, backup, and deployment sequencing each require
an application-specific decision and design.

### Specification flow

Significant work (auth, persistence, public contracts, major
features, migrations, deployment, security boundaries) follows:
master PRD (vision) → focused normative PRD → owning technical
design → implementation → acceptance evidence. A technical design
elaborates product requirements but must not redefine them. Routine
fixes and isolated refactors use ordinary issue/review flow when they
preserve current contracts. Record durable reusable decisions in
`arch_docs/adr/`, application decisions in `docs/adr/`.

## Skeleton and entries

A React Start app has three required author-owned surfaces: the build
plugin (`tanstackStart()` — route generation, client/server builds,
server function transforms, import protection, prerendering,
manifests, virtual entries), the router entry (`src/router.tsx`
exporting `getRouter()`), and file routes under `src/routes` with
`__root.tsx` as the document shell. Default client/server entries
exist; create `src/client.tsx` or `src/server.ts` only for
customization.

Dependencies for the org stack: `@tanstack/react-start`,
`@tanstack/react-router`, `react`/`react-dom` 19, `vite`,
`@vitejs/plugin-react`, `tailwindcss` + `@tailwindcss/vite`, `zod`,
`class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`,
plus `nitro/vite` for the generated Node server — still part of the
official stack as of react-start 1.168.x, not legacy. The template's
plugin order — Tailwind first, `tanstackStart()` before React, Nitro
last:

```ts
plugins: [tailwindcss(), tanstackStart(), viteReact(), nitro()]
```

TypeScript: strict, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `moduleResolution: Bundler`, `jsx:
react-jsx`, `noEmit`. Do not enable `verbatimModuleSyntax` casually —
the docs warn it can leak server bundles into client bundles.

`src/router.tsx` returns a fresh router each call and registers the
router type once:

```tsx
export function getRouter(): ReturnType<typeof createRouter> {
  return createRouter({
    routeTree,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
    defaultErrorComponent: DefaultErrorComponent,
    defaultNotFoundComponent: NotFoundComponent,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
```

The root route renders the document shell. The template's current
pattern is `createRootRoute` with `head()` and `shellComponent`:

```tsx
export const Route = createRootRoute({
  head: () => ({
    meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: Readonly<{ children: ReactNode }>): React.JSX.Element {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  )
}
```

Use `createRootRouteWithContext<...>()` when routes need typed router
context (QueryClient, current user, locale). Create `src/start.ts`
only for global configuration — request/function middleware,
serialization adapters, `defaultSsr`, server function fetch config —
and always include server-function CSRF middleware there:

```ts
import { createCsrfMiddleware, createStart } from '@tanstack/react-start'

const csrfMiddleware = createCsrfMiddleware({
  filter: (context) => context.handlerType === 'serverFn',
})

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware],
}))
```

If the app has no `src/start.ts`, Start installs CSRF automatically.
Adding `src/start.ts` changes that — CSRF middleware is then your
responsibility unless a deliberate equivalent exists.
`createCsrfMiddleware` also accepts `origin` and
`allowRequestsWithoutOriginCheck` for cross-origin request policies.

## Routing and data

### File route conventions

| File | Route path |
| --- | --- |
| `src/routes/index.tsx` | `/` |
| `src/routes/about.tsx` | `/about` |
| `src/routes/posts.index.tsx` or `posts/index.tsx` | `/posts/` index |
| `src/routes/posts.$postId.tsx` or `posts/$postId.tsx` | `/posts/$postId` |
| `src/routes/rest/$.tsx` | Wildcard under `/rest` |
| `src/routes/customScript[.]js.ts` | `/customScript.js` |

Dots separate path segments (`notes.index.tsx` → `/notes/`); nested
routes render through `<Outlet />` in the parent; pathless layout
routes use underscore segments. Avoid path collisions when mixing
flat and directory styles — rename rather than rely on generation
order.

### Loaders and params

Loaders fetch route data and are isomorphic: they may run during SSR
and client navigation, so they never access secrets, private env
vars, filesystem, DB clients, or private SDKs directly — call a
client-safe feature server function instead:

```tsx
export const Route = createFileRoute('/posts/$postId')({
  loader: ({ params }) => getPost({ data: params.postId }),
  component: PostPage,
})
```

Stale param or hook types after editing routes: regenerate via
dev/build tooling — never hand-edit `src/routeTree.gen.ts`. Use
deferred data when a route can render meaningful UI before slower
data resolves; keep server-only work behind server functions even
when deferred.

### Server functions vs server routes

| Situation | Use | Reason |
| --- | --- | --- |
| Loader/component/event handler needs server-only logic | `createServerFn` in the owning feature | Type-safe same-origin RPC and serialization |
| External client, webhook, public API, callback, upload endpoint | Server route | Exact `Request`/`Response`, status, headers, content type |
| A route page owns a small local raw endpoint | Same route file with `server.handlers` | HTTP path/method ownership stays in the route |

Server routes declare handlers on the route module:

```ts
export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: () => Response.json({ status: 'ok' }),
    },
  },
})
```

Methods: `ANY`, `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`,
`HEAD`. Handlers receive `{ request, params, pathname, context,
next }` and return a `Response`, `undefined`, or `next({ context })`
to pass context downstream. A server-route-only request that
produces no response is an error — return an explicit `Response` when
no UI fallback should handle it. Route-level `server.middleware`
applies to all handlers; `createHandlers` scopes middleware to one
method.

### Router context and TanStack Query

Create a fresh router per request/call; put per-request dependencies
(QueryClient, current user) in router context — never share one
`QueryClient` across requests:

```tsx
const queryClient = new QueryClient()
const router = createRouter({ routeTree, context: { queryClient } })
setupRouterSsrQueryIntegration({ router, queryClient })
```

Use `createRootRouteWithContext<{ queryClient: QueryClient }>()` for
typed access. Route middleware context becomes available to server
route handlers as server context; keep client-safe router context
separate from server-only values.

## Server functions and boundaries

### Mental model and shape

`createServerFn` defines server-only logic importable from app code.
In client bundles the implementation is replaced with an RPC stub; on
the server it runs directly. Use it for app-internal work: DB
queries and mutations, private env vars, filesystem, SDK access,
auth/session-backed logic.

```ts
export const listNotes = createServerFn({ method: 'GET' }).handler(() => {
  return listNotesFromStore()
})

export const createNote = createServerFn({ method: 'POST' })
  .validator(CreateNoteInputSchema)
  .handler(({ data }) => createNoteInStore(data))
```

Public surface: `createServerFn`, `createMiddleware`,
`createClientOnlyFn`, `createServerOnlyFn`, `createIsomorphicFn`,
`createCsrfMiddleware`, `createStart`, `Hydrate`, `useServerFn` come
from `@tanstack/react-start`. Request/response/cookie/session helpers
come from `@tanstack/react-start/server` and must stay server-only.

### Transport facts

- `createServerFn()` defaults to `GET`. GET payloads ride a `payload`
  query parameter and are rejected above 1 MB; GET does not support
  `FormData`.
- Non-GET functions accept JSON, plain text, URL-encoded forms, and
  multipart `FormData`.
- Method mismatch returns `405` with an `Allow` header.
- One logical input per call under `{ data }`. `.validator(...)` is
  the documented API for runtime validation + type inference
  (`.inputValidator` still exists but carries a "TODO remove upon
  stable"). Schema libraries such as Zod preferred.
- Return plain serializable data unless status/headers/redirects/
  body type are the contract — then return a raw `Response`.
- Redirect, not-found, and thrown errors propagate through Start and
  Router handling; do not wrap them as success payloads. The template
  maps a missing resource to `throw notFound()` inside the server
  function handler.
- Streaming: typed `ReadableStream<T>` or async generators for
  progressive output only — consume with `getReader()` / `for await`,
  keep chunks small and typed. Ordinary CRUD returns plain data.
- Static imports are transformed to RPC stubs; dynamic imports of
  server functions are unsupported by the contract.

### File organization

Keep server behavior with its owning feature: `tasks.schema.ts`
(client-safe contracts), `tasks.functions.ts` (server-function
wrappers — importable by routes, loaders, components, hooks),
`tasks.server.ts` (DB/secrets — importable only inside server
function handlers, server route handlers, or other server-only
modules). Cross-cutting infrastructure usable by features, routes,
`src/router.tsx`, or `src/start.ts` lives in `src/lib` with a
`.server.ts`/`.client.ts` suffix when it has an environment boundary.

### Import protection

Enabled by default: denies `*.server.*` in client bundles, `*.client.*`
in server bundles, and `@tanstack/react-start/server` in client code.
Dev usually mocks or warns; production build errors. The docs mark
import protection as **experimental** (subject to change). Newer
capabilities: explicit file markers (`import
'@tanstack/react-start/server-only'` / `'/client-only'`) and a
type-only-import exemption. Fix the import graph rather than
weakening protection. Common violations: a route component imports a
`*.server.ts` helper directly; a client-safe schema module imports a
server-only helper as a side effect; `@tanstack/react-start/server`
leaks through a barrel; a dynamic import obscures a boundary.

### Boundary checklist

- App-internal call → `createServerFn`; external/raw → server route.
- DB/secrets/filesystem/private SDK calls sit in a server function
  handler or `*.server.ts` helper imported by that handler — never in
  loaders, components, or client-safe modules.
- `.validator(...)` on every untrusted input; GET reads, POST writes.
- `src/start.ts` includes CSRF middleware unless deliberately
  handled elsewhere.
- Static server-function imports only.
- Private data is authorized at the server boundary, not only in
  route guards.

## Forms, auth, sessions, middleware

### Default write flow

POST server function → call from UI → `router.invalidate()` when the
current page shows affected loader data:

```tsx
export function ItemsPage() {
  const items = itemsRoute.useLoaderData()
  const router = useRouter()

  async function onCreate(title: string) {
    await createItem({ data: { title } })
    await router.invalidate()
  }
}
```

Form UI checklist: `preventDefault()` for client-handled forms;
disable submit controls while a mutation is in flight; clear stale
errors before retrying; validate on the server even when the client
validates; return structured validation results for expected field
errors; refresh affected route data after successful writes. Avoid
unnecessary invalidation when the mutation returns everything the UI
needs and no loader depends on it.

Native forms: server functions expose `.url` for
`<form action={fn.url} method="POST">` — use it for progressive
enhancement, non-JS submission, and uploads (`encType="multipart/form-data"`).
JavaScript handlers can also submit `FormData` with `fn({ data: formData })`.
If the UI needs optimistic updates or pending state, handle submit in
React and call the server function directly.

Mutation patterns: direct `fn({ data })` calls from event handlers;
`useServerFn(fn)` when a component/hook wants a local callable;
query-library mutation callbacks invalidate both router and query
cache when they duplicate data.

### Sessions and authorization

Session helpers (`useSession`, `getSession`, `updateSession`,
`clearSession`) live in `@tanstack/react-start/server` — server-only.
Session passwords ≥ 32 chars; cookies `httpOnly`, `sameSite: 'lax'`,
`secure` in production. Cross-cutting session setup goes in focused
`src/lib/*.server.ts` modules; feature-specific login/profile behavior
stays in its owning feature.

Protect data first: route guards are navigation UX, never the
security boundary. Every server function or server route that returns
or mutates private data authorizes internally; guards redirect for UX.
A common auth shape: `fetchUser` server function reads the session →
root route `beforeLoad` returns `{ user }` in route context → pathless
protected routes redirect for UX → private server functions re-check
authorization. Provider middleware (Clerk, AuthKit) follows the same
shape: request middleware in `src/start.ts`, then authorize private
server work with provider-backed helpers.

### Middleware types

| Type | Scope | Methods | Use for |
| --- | --- | --- | --- |
| Request middleware | SSR, server routes, server functions | `.server()` | Auth/session context, logging, headers, request-wide policies |
| Function middleware | Server functions specifically | `.client()`, `.server()`, `.validator()` | Server function input/context handling and client RPC behavior |

Request middleware cannot depend on function middleware; function
middleware can depend on request middleware. Pass context with
`next({ context })`; server routes read it in handler `context`,
server functions read it after `.middleware([...])`. Derive
authorization, tenant, and role from server-side request/session/
provider data — never trust client-sent context. Call `next()` unless
intentionally short-circuiting.

Server-only helpers from `@tanstack/react-start/server`: request
(`getRequest`, `getRequestHeaders`, `getRequestHeader`,
`getRequestIP`, `getRequestHost`, `getRequestUrl`,
`getRequestProtocol`), response (`setResponseHeaders`,
`setResponseHeader`, `removeResponseHeader`, `setResponseStatus`),
cookies (`getCookies`, `getCookie`, `setCookie`, `deleteCookie`),
sessions (above). Never call them from client code or outside Start
server request handling.

`createStart` also configures `serializationAdapters`, `defaultSsr`,
and `serverFns.fetch`. Client-side server function fetch resolution:
call-site fetch, later middleware fetch, earlier middleware fetch,
`createStart` `serverFns.fetch`, then global `fetch`. During SSR,
server functions call the server implementation directly.

## UX states, build, and deploy

- **Error boundaries**: route-level. Configure app defaults in
  `src/router.tsx` (`defaultErrorComponent`,
  `defaultNotFoundComponent`); override per route. Expected form
  validation failures return structured results; unexpected failures
  throw to route error UI. Throw `notFound()` from loaders or server
  functions for missing resources; use `redirect` for auth and
  navigation outcomes.
- **Pending and deferred UI**: route `pendingComponent` or router
  pending defaults for route-level loading; local component state for
  mutation feedback; deferred data for slower panels. Keep server
  work behind server functions even when deferred; preserve layout
  and accessibility in loading fallbacks.
- **Hydration safety**: first render output must match between server
  and client. No time/random values, browser-only APIs, media query
  values, `window`, or `localStorage` during initial render without
  guards — move browser-only reads into effects or client-only
  helpers.
- **Selective SSR**: route `ssr` is `true` (default), `false`,
  `'data-only'`, or a server-only function of route state. Child
  routes can only become more restrictive than parents; a root
  `shellComponent` still renders the document shell.
- **Generated files**: `src/routeTree.gen.ts` plus virtual imports
  (`#tanstack-router-entry`, `#tanstack-start-entry`) and server
  function manifests. Never hand-edit.
- **Plugin options worth checking**: `srcDirectory`, `router.entry`,
  `router.basepath`, `client.entry`, `client.base`, `server.entry`,
  `serverFns.base`, `serverFns.disableCsrfMiddlewareWarning`,
  `serverFns.generateFunctionId`, `pages`, `sitemap`, `prerender`,
  `spa`, `importProtection`. Treat custom function IDs, base paths,
  and entry points as deployment-affecting changes. Inspect the
  app's actual plugin config before assuming defaults.
- **Prerendering**: `prerender: { enabled: true, crawlLinks: true,
  failOnError: true }`. Dynamic routes need discoverable links or
  explicit page entries; API-only and layout-only routes are not
  useful targets.
- **SPA mode**: `spa: { enabled: true }` builds a static shell.
  Deployment rewrites must serve assets, route `serverFns.base`
  (usually `/_serverFn/*`) and server route paths to the server, then
  fall back to the shell — RPC/API rewrites before the shell
  fallback so they are not swallowed.
- **Custom server entries**: export a fetch-style handler routed
  through Start's server handler; align deployment routing with
  `server.entry`, `client.base`, `router.basepath`, `serverFns.base`.
- **CSP and head**: `<HeadContent />` in `<head>`, `<Scripts />`
  before `</body>`; follow the app's established nonce/script pattern
  under strict CSP; avoid custom inline scripts.
- **Hosting**: output paths differ per adapter — Vite + Nitro runs
  `node .output/server/index.mjs`; Rsbuild serves `dist/client` /
  `dist/server`; Cloudflare/Netlify have adapter config. Match the
  app's bundler and adapter.

Build/deploy checklist: inspect plugin config before assuming
defaults; keep `tanstackStart()` before React's Vite plugin; never
edit generated route trees; changing `serverFns.base` updates
deployment rewrites and tests; adding `src/start.ts` adds CSRF
middleware; SPA mode documents and implements rewrites for server
functions and server routes; import-protection changes preserve
client/server safety with validation coverage.

## Troubleshooting

- `405` from a server function: check the function method and the
  caller/form method.
- GET with large input or `FormData`: use POST.
- Server helper in a client bundle: move secret-bearing code behind
  `*.server.ts`, called only from server functions or server routes.
- Import-protection violation: inspect the import graph; fix it
  rather than disabling protection.
- Stale UI after a mutation: `router.invalidate()` when loader-backed
  data changed.
- "Auth looks protected but data leaks": enforce auth inside every
  private server function and server route, not only in `beforeLoad`.