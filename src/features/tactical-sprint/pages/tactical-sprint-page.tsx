import { Link } from '@tanstack/react-router'

import { TacticalSprintCard } from '../components/tactical-sprint-card'

/**
 * The Tactical Sprint (Class B) route (SPEC stories 4-7, ticket #13): the
 * entry point for turning a pasted AI-generated snippet a learner doesn't
 * understand into a targeted, verified exercise on the concept they're
 * weakest on.
 */
export function TacticalSprintPage(): React.JSX.Element {
  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
      <header className="mb-10 grid gap-4 border-b border-border pb-8">
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-primary">
          Tactical Sprint
        </p>
        <div>
          <h1 className="max-w-3xl font-display text-5xl font-semibold leading-[0.95] tracking-tight sm:text-6xl">
            Turn a snippet you don&apos;t understand into practice.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Class B stops at explaining and converts a pasted snippet into a
            short, active exercise instead — targeted at whichever concept
            behind it you&apos;re weakest on.
          </p>
        </div>
      </header>

      <TacticalSprintCard language="rust" />

      <footer className="mt-12 flex flex-col gap-2 border-t border-border pt-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>
          Generated exercises join the same Pre-Flight-verified practice list as
          any other exercise.
        </span>
        <Link className="font-semibold text-foreground underline" to="/">
          Go to the practice list
        </Link>
      </footer>
    </main>
  )
}
