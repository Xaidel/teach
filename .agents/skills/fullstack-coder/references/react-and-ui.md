# React and UI — React 19 patterns, components, tokens, accessibility

The React/UI craft layer shared by both React branches (fullstack
feature slices and plain React apps). Load for UI work: components,
forms, styling, states, accessibility. Architecture differs by
branch — fullstack apps use feature slices (SKILL.md),
non-fullstack apps use atomic design (`react-app.md`) — but the
patterns below apply in both.

## Component conventions

- Named function components and named exports; props interface (or
  `type`) declared above the component; explicit parameter and
  return types. Components return `React.JSX.Element` without
  importing React — the UMD global from `@types/react` makes it
  type-available, and the template's files rely on it.
- Type-only imports (`import type { X }`); path-alias imports
  (`#/` in fullstack apps) — never relative.
- `cn()` for className merging on every component that accepts
  `className`.
- `data-slot` on component roots and significant sub-parts.
- **React 19: plain functions, not `forwardRef`** in fullstack apps —
  ref is a normal prop now, and the template's primitives are plain
  functions; keep that shape when extending them. (`forwardRef`
  still works and is not yet deprecated — removal is planned for a
  future version. The SPA branch's atom convention still uses it —
  see `react-app.md`.)
- CVA for variants on primitives; extend the shared `ui/` set via
  variants, don't fork internals.

Primitive shape (from the template's `button.tsx`):

```tsx
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-full text-sm font-semibold transition-[color,background-color,border-color,transform] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 active:translate-y-px motion-reduce:transition-none',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        outline: 'border border-border bg-background text-foreground hover:bg-muted',
        ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
      },
      size: { default: 'h-11 px-5', sm: 'h-9 px-4 text-xs', icon: 'size-10' },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>

export function Button({ className, type = 'button', variant, size, ...props }: ButtonProps): React.JSX.Element {
  return (
    <button className={cn(buttonVariants({ variant, size }), className)} data-slot="button" type={type} {...props} />
  )
}
```

## React 19 patterns

- **`useActionState`** — form actions with pending state:
  `const [state, formAction, isPending] = useActionState(action, initialState)`.
  The action's return type must match `initialState`; an optional
  third `permalink` argument pins the form URL; wrap state updates
  after `await` in `startTransition`. Disable the submit control
  while `isPending`; render `state.error` with a semantic token.
  The mutation boundary stays a POST server function — the hook is
  UI.
- **`useOptimistic`** — instant UI feedback before server
  confirmation: `const [optimisticItems, addOptimistic] = useOptimistic(items, (current, newItem) => [...])`.
- **`useTransition`** — non-blocking updates for expensive state
  changes; `isPending` drives pending UI.
- **`use()`** — read a promise inside a component, wrapped in
  `Suspense` at the parent: `const user = use(userPromise)`. Pass
  only cached promises — a promise created in render suspends with
  "A component was suspended by an uncached promise".
- **Context** — React 19 renders `<Context value={...}>` directly
  (no Provider component); read with `use(Context)`. Throwing when
  the context is missing is a common convention for fail-loud
  misuse — the docs prescribe a meaningful default value instead.
- **Document metadata** — React 19 hoists `<title>`/`<meta>` from
  components; in fullstack apps route metadata stays in the route's
  `head()` (TanStack Router dedupes and merges it) — native hoisting
  is the fallback for component-scoped tags.
- **State management** — `useState` for local state, `useReducer`
  for complex transitions, context for subtree-shared state (auth,
  theme), `useActionState`/`useOptimistic` for submission flows.
  No global state library unless an approved requirement exists —
  the template baseline has none.

Forms: React Hook Form, `useActionState`, and local form state are
UI choices; the mutation boundary is still a POST server function or
server route. Server-side validation with Zod decides; client
validation is UX.

## Styling — Tailwind v4 semantic tokens

The template defines semantic tokens in `src/styles.css`:
`@import 'tailwindcss'`, an `@theme inline` block bridging CSS
variables (`--color-primary: var(--primary)`), and `:root` +
`prefers-color-scheme` dark values in oklch. Extend tokens there —
never invent raw palette values in components.

| Token | Use for |
| --- | --- |
| `bg-background` / `text-foreground` | Page base |
| `bg-primary` / `text-primary-foreground` | Primary actions |
| `bg-muted` / `text-muted-foreground` | De-emphasized content |
| `bg-card` / `text-card-foreground` | Card surfaces |
| `bg-destructive` / `text-destructive-foreground` | Danger actions |
| `border-border` / `border-input` | Borders |
| `ring-ring` | Focus rings |
| `font-display` / `font-sans` | Display headings / body |

Rules: semantic tokens only; token-backed spacing and radii (no
arbitrary pixels); `transition-colors` for interactive elements;
`motion-reduce:transition-none` on animated elements. Reuse the
shared `ui/` primitives (Button, Card, Badge, Dialog, Input, Label,
Textarea, Alert) — extend with CVA variants or new primitives in
`src/shared/components/ui/` when genuinely shared, feature-local
UI in the feature's `components/`.

Libraries: lucide-react is the icon library — `h-4 w-4` explicit
size, `aria-hidden="true"` when decorative, `aria-label` when an
icon is the sole button content. Radix primitives exist where the
template already ships them (Dialog, Label); check
`src/shared/components/ui/` before adding a dependency. CSS
transitions for simple states; complex orchestration only when it
delivers clear UX value.

## Layout and visual states

- Mobile-first responsive: `sm` 640, `md` 768, `lg` 1024, `xl`
  1280, `2xl` 1536. Layout shells use `min-h-screen` flex/grid
  regions with `flex-1` content.
- Loading, empty, error, and disabled states are first-class: route
  `pendingComponent`/router defaults for route-level loading; local
  state for mutation feedback; explicit empty states (no rows, no
  results); `errorComponent`/`notFoundComponent` per route; visible
  focus and accessible status messages on every transition.
- Interactive elements carry `focus-visible:ring-2
  focus-visible:ring-ring focus-visible:outline-none`; disabled
  controls are `disabled:pointer-events-none disabled:opacity-50`.

## Accessibility

Semantic HTML and landmarks (`<main>`, `<nav>`, `<header>`,
`<footer>`, `<button>`, `<a>`); correct labels on all inputs
(`<label>` or `aria-label`); visible focus; `aria-expanded` +
`aria-controls` on expandable sections; `aria-busy` on loading
states; focus trapped in modals and returned to the trigger on
close; WCAG 2.1 AA contrast (4.5:1 normal, 3:1 large — the token
pairs are pre-validated); reduced-motion fallbacks everywhere.
Status messages are announced — not just visually rendered.

## Performance

React Compiler makes manual `memo`/`useMemo`/`useCallback` typically
unnecessary — add them only when measured or obvious;
`React.lazy` + `Suspense` for heavy routes or components; prefer
tree-shakeable imports over barrel exports; skeleton loaders over
blocking renders. Before adding a library for a visual effect, ask
whether CSS achieves 80% of it.

## Component checklist

- [ ] Named export; props typed above; explicit return type
- [ ] `cn()` merging; `data-slot` on the root
- [ ] Semantic tokens only; token-backed spacing/radii
- [ ] `focus-visible` ring on interactive elements;
      `motion-reduce` on animated ones
- [ ] Loading/empty/error/disabled states present where the
      component can be in them
- [ ] Labels and status messages accessible; icons aria-correct
- [ ] Reuses `ui/` primitives before new markup