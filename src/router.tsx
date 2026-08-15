import {
  Link,
  createRouter,
  type ErrorComponentProps,
} from '@tanstack/react-router'

import { routeTree } from './routeTree.gen'

/** Creates a fresh router instance for each application request or browser runtime. */
export function getRouter(): ReturnType<typeof createRouter> {
  return createRouter({
    routeTree,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
    defaultErrorComponent: DefaultErrorComponent,
    defaultNotFoundComponent: () => (
      <main className="grid min-h-screen place-items-center p-6 text-center">
        <section>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">
            404
          </p>
          <h1 className="mt-3 font-display text-4xl font-semibold">
            This page is not part of Teach.
          </h1>
          <Link
            className="mt-6 inline-flex rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            to="/practice"
          >
            Go to the exercise
          </Link>
        </section>
      </main>
    ),
  })
}

function DefaultErrorComponent({
  reset,
}: ErrorComponentProps): React.JSX.Element {
  return (
    <main className="grid min-h-screen place-items-center p-6 text-center">
      <section className="max-w-lg">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-destructive">
          Something went wrong
        </p>
        <h1 className="mt-3 font-display text-4xl font-semibold">
          The exercise could not be opened.
        </h1>
        <p className="mt-4 leading-relaxed text-muted-foreground">
          Try the request again. Internal error details are not displayed here.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <button
            className="inline-flex rounded-full border border-border bg-background px-5 py-3 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={reset}
            type="button"
          >
            Try again
          </button>
          <Link
            className="inline-flex rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            to="/practice"
          >
            Go to the exercise
          </Link>
        </div>
      </section>
    </main>
  )
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
