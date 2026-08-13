import { Link, getRouteApi } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'

import type { ExplanationPreferences } from '#/features/learners/learners.schema'
import { cn } from '#/lib/cn'
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
  const { exerciseId: targetExerciseId }: { exerciseId?: string } =
    exerciseRoute.useSearch()
  const targetRef = useRef<HTMLElement | null>(null)

  // A Tactical Sprint hand-off (issue #13) lands here with `exerciseId` set
  // to the generated exercise's id — scroll straight to it once on load
  // rather than leaving the learner to find it in the flat list below.
  useEffect(() => {
    if (targetExerciseId) {
      targetRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [targetExerciseId])

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
        <div className="grid gap-2">
          <Link
            className="w-fit text-sm font-semibold text-primary underline"
            to="/tactical-sprint"
          >
            Don&apos;t understand an AI-generated snippet? Try a Tactical Sprint
            →
          </Link>
          <Link
            className="w-fit text-sm font-semibold text-primary underline"
            to="/explanation-assessment"
          >
            Ready to be assessed on a Practiced concept? Explain it in your own
            words →
          </Link>
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
          data.exercises.map((exercise: Exercise) => {
            const isTarget = exercise.id === targetExerciseId
            return (
              <article
                aria-label={exercise.title}
                className={cn(
                  'mx-auto w-full max-w-4xl',
                  isTarget &&
                    'rounded-3xl ring-2 ring-primary ring-offset-4 ring-offset-background',
                )}
                key={exercise.id}
                ref={isTarget ? targetRef : undefined}
              >
                <Card>
                  <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h2 className="font-display text-3xl font-semibold tracking-tight">
                        {exercise.title}
                      </h2>
                      <div className="flex flex-wrap items-center gap-2">
                        {isTarget ? (
                          <Badge className="border-primary/40 bg-primary/10 text-primary">
                            From Tactical Sprint
                          </Badge>
                        ) : null}
                        <Badge className="border-border bg-background text-muted-foreground">
                          {exercise.language}
                        </Badge>
                      </div>
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
            )
          })
        )}
      </div>

      <footer className="mt-12 flex flex-col gap-2 border-t border-border pt-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>Submissions run in an ephemeral sandbox, never on the host.</span>
        <span>v1 multi-language sandbox</span>
      </footer>
    </main>
  )
}
