import { useRouter } from '@tanstack/react-router'

import { Button } from '#/shared/components/ui/button'
import { SANDBOX_LANGUAGES } from '#/lib/sandbox/types'
import type { SandboxLanguage } from '#/lib/sandbox/types'

import type { ConceptReview } from '../concepts.schema'
import { ConceptCard } from './concept-card'
import { DraftPanel } from './draft-panel'

/** The review surface: language switcher, AI draft trigger, and concept list. */
export function ConceptReviewView({
  language,
  review,
}: {
  language: SandboxLanguage
  review: ConceptReview
}): React.JSX.Element {
  const router = useRouter()

  return (
    <div className="grid gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div aria-label="Concept Graph language" className="flex gap-2">
          {SANDBOX_LANGUAGES.map((candidate) => (
            <Button
              key={candidate}
              onClick={() => {
                void router.navigate({
                  to: '/concepts',
                  search: { language: candidate },
                })
              }}
              size="sm"
              variant={candidate === language ? 'default' : 'outline'}
            >
              {candidate}
            </Button>
          ))}
        </div>
        <DraftPanel language={language} />
      </div>

      {review.concepts.length === 0 ? (
        <p className="rounded-2xl border border-border bg-card px-5 py-6 text-sm leading-relaxed text-muted-foreground">
          No concepts drafted for {language} yet. Use “Draft {language}
          concepts” to have the AI Teacher Engine produce the broad initial set,
          then review it here.
        </p>
      ) : (
        <div className="grid gap-5">
          {review.concepts.map((concept) => (
            <ConceptCard concept={concept} key={concept.id} />
          ))}
        </div>
      )}
    </div>
  )
}
