import { getRouteApi, useRouter } from '@tanstack/react-router'

import { ConceptReviewView } from '../components/concept-review'
import type { ConceptReview } from '../concepts.schema'
import { normalizeConceptLanguage } from '../concepts.schema'

const conceptsRoute = getRouteApi('/concepts')

/** Renders the in-app Concept Graph review surface for one language (ADR-0016). */
export function ConceptReviewPage(): React.JSX.Element {
  const router = useRouter()
  const review: ConceptReview = conceptsRoute.useLoaderData()
  const language = normalizeConceptLanguage(
    (router.state.location.search as Record<string, unknown> | undefined)
      ?.language,
  )

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
      <header className="mb-10 grid gap-4 border-b border-border pb-8">
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-primary">
          Concept Graph
        </p>
        <div>
          <h1 className="max-w-3xl font-display text-5xl font-semibold leading-[0.95] tracking-tight sm:text-6xl">
            {language} concepts — structural review.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Drafted by the AI Teacher Engine, then reviewed for structural
            soundness: naming, prerequisite sanity, and plausible difficulty.
            Review status is a personal tracking marker only — the deterministic
            Concept Validation check is what gates usability.
          </p>
        </div>
      </header>

      <ConceptReviewView language={language} review={review} />
    </main>
  )
}
