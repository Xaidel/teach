import { getRouteApi, Link } from '@tanstack/react-router'

import { Badge } from '#/shared/components/ui/badge'
import { Card, CardHeader } from '#/shared/components/ui/card'

import type {
  Curriculum,
  CurriculumStep,
  CurriculumStepStatus,
} from '../curriculum.schema'

const curriculumRoute = getRouteApi('/curriculum/')

/** Loader data for the Class A sequence route. */
export type CurriculumPageData = Curriculum

/** Human-readable badge label per step status. */
const STATUS_LABELS: Record<CurriculumStepStatus, string> = {
  locked: 'Locked',
  available: 'Available',
  started: 'Started',
  complete: 'Complete',
}

/** One row of the sequence: position, concept, mastery, status, prerequisites. */
function StepRow({ step }: { step: CurriculumStep }): React.JSX.Element {
  const statusBadgeClass =
    step.status === 'locked'
      ? 'border-border bg-background text-muted-foreground'
      : step.status === 'complete'
        ? 'border-primary/30 bg-primary/10 text-primary'
        : 'border-border bg-muted/40 text-foreground'
  const prerequisiteSlugs = step.prerequisites.map((p) => p.slug).join(', ')

  return (
    <Card aria-label={`Step ${String(step.position)} — ${step.concept.slug}`}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="border-border bg-background text-muted-foreground">
              Step {String(step.position)}
            </Badge>
            <h2 className="font-display text-2xl font-semibold tracking-tight">
              {step.concept.slug}
            </h2>
            <Badge>difficulty {String(step.concept.difficulty)}</Badge>
            <Badge className={statusBadgeClass}>
              {STATUS_LABELS[step.status]}
            </Badge>
            <Badge className="border-border bg-background text-muted-foreground">
              mastery: {step.mastery}
            </Badge>
          </div>
          {step.status !== 'locked' ? (
            <Link
              className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90"
              to="/curriculum/$conceptSlug"
              params={{ conceptSlug: step.concept.slug }}
            >
              {step.status === 'complete' ? 'Review' : 'Start'}
            </Link>
          ) : null}
        </div>
        <p className="leading-relaxed text-muted-foreground">
          {prerequisiteSlugs.length > 0
            ? `Requires Practiced mastery of: ${prerequisiteSlugs}.`
            : 'No prerequisites — the first step of the path.'}
        </p>
      </CardHeader>
    </Card>
  )
}

/**
 * The Class A sequence page (SPEC story 1, issue #14): the usable Rust
 * Concept Graph ordered by prerequisites, each concept as a step with its
 * mastery and status. Locked steps show the prerequisite gate; available,
 * started, and complete steps link into the step page (lesson → guided →
 * independent).
 */
export function CurriculumPage(): React.JSX.Element {
  const data: CurriculumPageData = curriculumRoute.useLoaderData()

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
      <header className="mb-10 grid gap-4 border-b border-border pb-8">
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-primary">
          Class A — Structured Path
        </p>
        <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <h1 className="max-w-3xl font-display text-5xl font-semibold leading-[0.95] tracking-tight sm:text-6xl">
              The {data.language} curriculum.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              A sequential path built from the Concept Graph&apos;s prerequisite
              order. Each step presents a lesson, a guided exercise, and an
              independent exercise — a step unlocks once every prerequisite is
              Practiced, and completing it updates the Learner Model.
            </p>
          </div>
          <p className="text-sm font-semibold text-muted-foreground md:pb-1">
            {String(data.steps.length)} steps
          </p>
        </div>
      </header>

      <div className="grid gap-6">
        {data.steps.length === 0 ? (
          <p className="mx-auto max-w-4xl rounded-2xl border border-border bg-card px-5 py-6 text-sm leading-relaxed text-muted-foreground">
            No usable concepts for {data.language} yet. Draft the Concept Graph
            on the concepts page first — validation-passing concepts appear here
            in prerequisite order.
          </p>
        ) : (
          data.steps.map((step) => (
            <StepRow key={step.concept.id} step={step} />
          ))
        )}
      </div>

      <footer className="mt-12 flex flex-col gap-2 border-t border-border pt-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <Link className="hover:text-foreground" to="/">
          Back to practice home
        </Link>
        <span>
          Class A · progress anchored to concepts, not lesson checkboxes
        </span>
      </footer>
    </main>
  )
}
