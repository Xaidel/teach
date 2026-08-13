import { getRouteApi, Link } from '@tanstack/react-router'

import { Badge } from '#/shared/components/ui/badge'
import { Card, CardContent, CardHeader } from '#/shared/components/ui/card'

import { StepLessonCard } from '../components/step-lesson-card'
import { StepExerciseSlot } from '../components/step-exercise-slot'
import type { CurriculumStepDetail } from '../curriculum.schema'

const curriculumStepRoute = getRouteApi('/curriculum/$conceptSlug')

/** Loader data for one Class A step's detail route. */
export type CurriculumStepPageData = CurriculumStepDetail

/** The locked panel shown instead of the step's artifacts while gated. */
function LockedPanel({
  step,
}: {
  step: CurriculumStepDetail
}): React.JSX.Element {
  return (
    <Card aria-label="Step locked">
      <CardHeader>
        <h2 className="font-display text-2xl font-semibold tracking-tight">
          Step locked
        </h2>
        <p className="leading-relaxed text-muted-foreground">
          {step.concept.slug} cannot be started yet — a learner cannot skip
          ahead to a concept whose prerequisites aren&apos;t Practiced. Finish
          the earlier steps first:
        </p>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-1.5">
          {step.prerequisites.map((prerequisite) => (
            <li
              className="rounded-xl border border-border bg-muted/40 px-3 py-2 font-mono text-sm"
              key={prerequisite.id}
            >
              {prerequisite.slug}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

/**
 * One Class A step (SPEC story 2, issue #14): the lesson, the guided
 * exercise, and the independent exercise for a concept, gated by the
 * no-skip-ahead rule (AC 4). The lesson is generated on demand; each
 * exercise slot generates through the Pre-Flight-verified pipeline and
 * renders in the shared exercise editor once banked. Mastery advances
 * through the same attempt-outcome path as every exercise (AC 3).
 */
export function CurriculumStepPage(): React.JSX.Element {
  const data: CurriculumStepPageData = curriculumStepRoute.useLoaderData()
  const language = data.language

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
      <header className="mb-10 grid gap-4 border-b border-border pb-8">
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-primary">
          Class A — Structured Path
        </p>
        <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <h1 className="max-w-3xl font-display text-5xl font-semibold leading-[0.95] tracking-tight sm:text-6xl">
              Step {String(data.position)} — {data.concept.slug}
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              A generated lesson, a guided exercise, and an independent exercise
              for this concept. A full pass on either exercise — guided or
              independent — moves the concept to Practiced in your Learner
              Model.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 md:pb-1">
            <Badge>difficulty {String(data.concept.difficulty)}</Badge>
            <Badge className="border-border bg-background text-muted-foreground">
              mastery: {data.mastery}
            </Badge>
            <Badge className="border-border bg-background text-muted-foreground">
              {data.status}
            </Badge>
          </div>
        </div>
      </header>

      {data.status === 'locked' ? (
        <LockedPanel step={data} />
      ) : (
        <div className="grid gap-10">
          <StepLessonCard language={language} conceptSlug={data.concept.slug} />
          <StepExerciseSlot
            conceptSlug={data.concept.slug}
            description="A first exercise on this concept with the Socratic hint ladder available — get as much guidance as you need to find the fix."
            exercise={data.guidedExercise}
            guidance="guided"
            language={language}
          />
          <StepExerciseSlot
            conceptSlug={data.concept.slug}
            description="A second exercise on this concept solved without hints — passing it shows the concept generalizes beyond guided practice."
            exercise={data.independentExercise}
            guidance="independent"
            language={language}
          />
        </div>
      )}

      <footer className="mt-12 flex flex-col gap-2 border-t border-border pt-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <Link className="hover:text-foreground" to="/curriculum">
          Back to the curriculum
        </Link>
        <span>Submissions run in an ephemeral sandbox, never on the host.</span>
      </footer>
    </main>
  )
}
