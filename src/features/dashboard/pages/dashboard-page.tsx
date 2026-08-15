import { getRouteApi, Link } from '@tanstack/react-router'
import { Moon, Sun } from 'lucide-react'

import type { Curriculum } from '#/features/curriculum/curriculum.schema'
import { useTheme } from '#/shared/hooks/use-theme'

import { computeCurriculumStats } from '../curriculum-stats'

const dashboardRoute = getRouteApi('/')

/** Loader data for the Dashboard route: the Rust Class A sequence. */
export type DashboardPageData = {
  curriculum: Curriculum
}

/** A progress bar's fill, as a percentage width. */
function ProgressBar({ pct }: { pct: number }): React.JSX.Element {
  return (
    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
      <div
        className="h-full rounded-full bg-primary transition-[width]"
        style={{ width: `${String(pct)}%` }}
      />
    </div>
  )
}

/**
 * The learner home (SPEC's Dashboard, replacing the flat practice list as
 * "/"): a welcome-back overview surfacing where the learner left off and
 * their real Learner Model progress, plus entry points into Class A
 * (Concept Graph) and Class B (Tactical Sprint) for the one active
 * language. Streak tracking and "continue where you left off" have no
 * backing data model yet (no streak table, no last-touched-concept read) —
 * both stay static placeholder content until that evidence exists, called
 * out inline rather than presented as if real.
 */
export function DashboardPage(): React.JSX.Element {
  const data: DashboardPageData = dashboardRoute.useLoaderData()
  const { theme, toggleTheme } = useTheme()
  const stats = computeCurriculumStats(data.curriculum.steps)
  const isDark = theme === 'dark'

  return (
    <div className="min-h-screen bg-background text-foreground">
      <nav className="flex items-center gap-4 border-b border-border px-5 py-3 sm:px-8">
        <span className="mr-auto font-display text-lg font-semibold">
          Teach
        </span>
        <span className="text-sm text-muted-foreground">6-day streak</span>
        <button
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          className="inline-flex size-9 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={toggleTheme}
          type="button"
        >
          {isDark ? (
            <Sun aria-hidden="true" className="size-4" />
          ) : (
            <Moon aria-hidden="true" className="size-4" />
          )}
        </button>
      </nav>

      <main className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 sm:py-12">
        <h1 className="mb-1 font-display text-4xl font-semibold tracking-tight sm:text-5xl">
          Welcome back
        </h1>
        <p className="mb-8 text-muted-foreground">
          Pick up where you left off, or start something new.
        </p>

        <Link
          className="mb-6 grid grid-cols-[1fr_auto] items-center gap-6 rounded-2xl border border-border bg-foreground px-7 py-7 text-background shadow-md transition-transform hover:-translate-y-0.5"
          to="/curriculum"
        >
          <div>
            <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.1em] text-background/60">
              Continue where you left off
            </div>
            <div className="mb-1.5 font-display text-2xl font-bold">
              The Rust structured path
            </div>
            <div className="text-sm opacity-75">
              Pick your next step in the Concept Graph.
            </div>
          </div>
          <span className="inline-flex h-11 items-center justify-center rounded-full bg-background px-5 text-sm font-semibold text-foreground">
            Resume →
          </span>
        </Link>

        <div className="mb-10 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-primary">
              Streak
            </div>
            <div className="font-display text-3xl font-bold">6 days</div>
            <p className="mt-1 text-sm text-muted-foreground">
              Keep it going — you&apos;re on a roll.
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-primary">
              Concepts mastered
            </div>
            <div className="font-display text-3xl font-bold">
              {stats.complete} / {stats.total}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {stats.retained} retained long-term.
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-primary">
              Overall progress
            </div>
            <div className="font-display text-3xl font-bold">{stats.pct}%</div>
            <ProgressBar pct={stats.pct} />
          </div>
        </div>

        <div className="mb-4 border-t border-border" />
        <h2 className="mb-4 font-display text-2xl font-semibold tracking-tight">
          Topics
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-2xl border-2 border-border bg-card p-5 shadow-sm">
            <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-primary">
              {stats.complete} / {stats.total} concepts complete
            </span>
            <div className="mt-1.5 font-display text-xl font-bold">Rust</div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              From variable bindings to threads — work through the concept
              graph, or paste code you don&apos;t understand and we&apos;ll
              target the gap.
            </p>
            <ProgressBar pct={stats.pct} />
            <div className="mt-4 flex flex-wrap gap-2.5">
              <Link
                className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                to="/curriculum"
              >
                Open Concept Graph →
              </Link>
              <Link
                className="inline-flex h-9 items-center justify-center rounded-full px-3 text-sm font-semibold text-primary transition-colors hover:bg-primary/10"
                to="/tactical-sprint"
              >
                Paste a snippet
              </Link>
            </div>
          </div>
          {(['Go', 'Python'] as const).map((language) => (
            <div
              className="rounded-2xl border border-border bg-card p-5 opacity-55"
              key={language}
            >
              <span className="inline-flex w-fit items-center rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-semibold tracking-wide text-muted-foreground">
                Coming soon
              </span>
              <div className="mt-1.5 font-display text-xl font-bold">
                {language}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                The {language} curriculum is on its way.
              </p>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
