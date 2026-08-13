import { getRouteApi } from '@tanstack/react-router'

import type { ExplanationPreferences } from '#/features/learners/learners.schema'
import { Badge } from '#/shared/components/ui/badge'
import { Card, CardContent, CardHeader } from '#/shared/components/ui/card'

import { ExerciseEditor } from '../components/exercise-editor'
import {
  ExerciseGenerationCard,
  type GenerationConcept,
} from '../components/exercise-generation-card'
import { ExplanationPreferencesPanel } from '../components/explanation-preferences-panel'
import type { Exercise } from '../exercise.schema'

const exerciseRoute = getRouteApi('/')

/** Loader data for the practice home route (issue #8, issue #12). */
export type ExercisePageData = {
  exercises: Exercise[]
  generation: { language: 'rust'; concepts: GenerationConcept[] }
  explanationPreferences: ExplanationPreferences
}

/**
 * Renders the practice home: the hardcoded Go/Python v1 seeds plus every
 * Pre-Flight-verified generated exercise, and the exercise generation
 * surface for languages whose generation is enabled (issue #8: rust).
 */
export function ExercisePage(): React.JSX.Element {
  const data: ExercisePageData = exerciseRoute.useLoaderData()

  const languages = [
    ...new Set(data.exercises.map((exercise) => exercise.language)),
  ]
    .sort()
    .join(' / ')

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
      <header className="mb-10 grid gap-4 border-b border-border pb-8">
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-primary">
          Sandboxed practice
        </p>
        <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <h1 className="max-w-3xl font-display text-5xl font-semibold leading-[0.95] tracking-tight sm:text-6xl">
              Teach — practice in three languages.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Write code against real exercises — generated for the Rust concept
              graph by the AI Teacher Engine and verified by Pre-Flight — and
              get authoritative pass/fail feedback from a sandboxed run of each
              language&apos;s real test toolchain.
            </p>
          </div>
          <p className="text-sm font-semibold text-muted-foreground md:pb-1">
            {String(data.exercises.length)} exercises · {languages || 'none'}
          </p>
        </div>
      </header>

      <div className="mb-10 grid gap-6">
        <ExplanationPreferencesPanel initial={data.explanationPreferences} />
        <ExerciseGenerationCard
          concepts={data.generation.concepts}
          language={data.generation.language}
        />
      </div>

      <div className="grid gap-10">
        {data.exercises.length === 0 ? (
          <p className="mx-auto max-w-4xl rounded-2xl border border-border bg-card px-5 py-6 text-sm leading-relaxed text-muted-foreground">
            No verified exercises yet. Use the generation card above to have the
            AI Teacher Engine produce one for a concept.
          </p>
        ) : (
          data.exercises.map((exercise: Exercise) => (
            <article
              aria-label={exercise.title}
              className="mx-auto w-full max-w-4xl"
              key={exercise.id}
            >
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="font-display text-3xl font-semibold tracking-tight">
                      {exercise.title}
                    </h2>
                    <Badge className="border-border bg-background text-muted-foreground">
                      {exercise.language}
                    </Badge>
                  </div>
                  <p className="leading-relaxed text-muted-foreground">
                    {exercise.prompt}
                  </p>
                </CardHeader>
                <CardContent>
                  <ExerciseEditor exercise={exercise} />
                </CardContent>
              </Card>
            </article>
          ))
        )}
      </div>

      <footer className="mt-12 flex flex-col gap-2 border-t border-border pt-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>Submissions run in an ephemeral sandbox, never on the host.</span>
        <span>v1 multi-language sandbox</span>
      </footer>
    </main>
  )
}
