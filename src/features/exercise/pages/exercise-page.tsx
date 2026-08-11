import { getRouteApi } from '@tanstack/react-router'

import { Card, CardContent, CardHeader } from '#/shared/components/ui/card'

import { ExerciseEditor } from '../components/exercise-editor'
import type { Exercise } from '../exercise.schema'

const exerciseRoute = getRouteApi('/')

/** Renders the walking-skeleton exercise: prompt, editor, and result. */
export function ExercisePage(): React.JSX.Element {
  const exercise: Exercise = exerciseRoute.useLoaderData()

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
      <header className="mb-10 grid gap-4 border-b border-border pb-8">
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-primary">
          Walking skeleton
        </p>
        <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <h1 className="max-w-3xl font-display text-5xl font-semibold leading-[0.95] tracking-tight sm:text-6xl">
              Teach — Rust practice.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Write code against one real exercise and get authoritative
              pass/fail feedback from a sandboxed cargo nextest run.
            </p>
          </div>
          <p className="text-sm font-semibold text-muted-foreground md:pb-1">
            {exercise.language} · {exercise.slug}
          </p>
        </div>
      </header>

      <Card className="mx-auto max-w-4xl">
        <CardHeader>
          <h2 className="font-display text-3xl font-semibold tracking-tight">
            {exercise.title}
          </h2>
          <p className="leading-relaxed text-muted-foreground">
            {exercise.prompt}
          </p>
        </CardHeader>
        <CardContent>
          <ExerciseEditor exercise={exercise} />
        </CardContent>
      </Card>

      <footer className="mt-12 flex flex-col gap-2 border-t border-border pt-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>Submissions run in an ephemeral sandbox, never on the host.</span>
        <span>v1 walking skeleton</span>
      </footer>
    </main>
  )
}
