import { Link } from '@tanstack/react-router'

import { ExplanationAssessmentCard } from '../components/explanation-assessment-card'
import type { ExplanationAssessmentOverview } from '../explanation-assessment.schema'

/**
 * The Explanation Assessment route (SPEC stories 44-45, issue #16): the
 * learner freely explains a Practiced concept in their own words, the AI
 * Teacher Engine compares it against the Concept Graph, and the platform
 * records a deterministic accuracy signal toward the Practiced →
 * Demonstrated gate (ADR-0015).
 */
export function ExplanationAssessmentPage({
  overview,
}: {
  overview: ExplanationAssessmentOverview
}): React.JSX.Element {
  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
      <header className="mb-10 grid gap-4 border-b border-border pb-8">
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-primary">
          Explanation Assessment
        </p>
        <div>
          <h1 className="max-w-3xl font-display text-5xl font-semibold leading-[0.95] tracking-tight sm:text-6xl">
            Passing code doesn&apos;t prove you know it.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Explain a concept you&apos;ve practiced in your own words. The AI
            Teacher Engine checks your explanation against the Concept Graph for
            missing sub-concepts, incorrect claims, and conflated ideas — and
            the score becomes evidence in your Learner Model.
          </p>
        </div>
      </header>

      <ExplanationAssessmentCard concepts={overview.concepts} />

      <footer className="mt-12 flex flex-col gap-2 border-t border-border pt-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>
          A passed assessment is one of two required signals for promoting a
          concept to Demonstrated — the other is a passed Transfer Test.
        </span>
        <Link className="font-semibold text-foreground underline" to="/">
          Go to the practice list
        </Link>
      </footer>
    </main>
  )
}
