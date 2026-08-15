import { getRouteApi, Link } from '@tanstack/react-router'
import { Book, Moon, Sun } from 'lucide-react'
import { useState } from 'react'

import type { ExplanationPreferences } from '#/features/learners/learners.schema'
import { Card, CardContent, CardHeader } from '#/shared/components/ui/card'
import { useTheme } from '#/shared/hooks/use-theme'

import type { ExerciseGuidance } from '../../exercise/exercise.schema'
import { ConceptExercisePanel } from '../components/concept-exercise-panel'
import { ConceptPanel } from '../components/concept-panel'
import { StepLoadingScreen } from '../components/step-loading-screen'
import type { CurriculumStepDetail } from '../curriculum.schema'

const curriculumStepRoute = getRouteApi('/curriculum/$conceptSlug')

/** Loader data for one Class A step's detail route. */
export type CurriculumStepPageData = CurriculumStepDetail & {
  explanationPreferences: ExplanationPreferences
}

/** The locked panel shown instead of the step's artifacts while gated. */
function LockedPanel({
  step,
}: {
  step: CurriculumStepDetail
}): React.JSX.Element {
  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
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
      <Link
        className="mt-6 inline-block text-sm text-muted-foreground hover:text-foreground"
        to="/curriculum"
      >
        ← Concept Graph
      </Link>
    </main>
  )
}

/**
 * One Class A step (SPEC story 2, issue #14; NodeDetail.dc.html): the
 * concept panel and one active exercise slot, laid out as the design's
 * three columns. The guided exercise is shown first — passing it swaps the
 * same slot to the independent exercise (`ConceptExercisePanel`'s
 * `onPassed`) — either one passing moves the concept to Practiced (AC 3).
 * Gated by the no-skip-ahead rule (AC 4).
 */
export function CurriculumStepPage(): React.JSX.Element {
  const data: CurriculumStepPageData = curriculumStepRoute.useLoaderData()
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'
  const [activeGuidance, setActiveGuidance] =
    useState<ExerciseGuidance>('guided')
  // The lesson always regenerates on arrival (ConceptPanel has no banked
  // state), so it starts unready; the guided exercise only needs to
  // generate when nothing was banked yet — mirrors ConceptExercisePanel's
  // own "generate only if null" check. Both flip true (and stay true) once
  // that panel's first generation settles, success or failure — see each
  // component's `onReady`.
  const [isLessonReady, setIsLessonReady] = useState(false)
  const [isExerciseReady, setIsExerciseReady] = useState(
    data.guidedExercise !== null,
  )

  if (data.status === 'locked') {
    return <LockedPanel step={data} />
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {isLessonReady && isExerciseReady ? null : <StepLoadingScreen />}
      <nav className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-border px-5 py-3 sm:px-8">
        <Link
          className="justify-self-start text-sm text-muted-foreground hover:text-foreground"
          to="/curriculum"
        >
          ← Concept Graph
        </Link>
        <span className="inline-flex size-9 items-center justify-center justify-self-center rounded-full bg-primary">
          <Book aria-hidden="true" className="size-4 text-primary-foreground" />
        </span>
        <button
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          className="inline-flex size-9 items-center justify-center justify-self-end rounded-full border border-border text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

      <div className="grid min-h-0 flex-1 grid-cols-[320px_1fr] gap-4 p-4">
        <ConceptPanel
          conceptSlug={data.concept.slug}
          difficulty={data.concept.difficulty}
          explanationPreferences={data.explanationPreferences}
          language={data.language}
          mastery={data.mastery}
          onReady={() => setIsLessonReady(true)}
          position={data.position}
          status={data.status}
        />
        <ConceptExercisePanel
          conceptSlug={data.concept.slug}
          exercise={
            activeGuidance === 'guided'
              ? data.guidedExercise
              : data.independentExercise
          }
          guidance={activeGuidance}
          key={activeGuidance}
          language={data.language}
          onPassed={() => {
            setActiveGuidance((current) =>
              current === 'guided' ? 'independent' : current,
            )
          }}
          onReady={() => setIsExerciseReady(true)}
        />
      </div>
    </div>
  )
}
