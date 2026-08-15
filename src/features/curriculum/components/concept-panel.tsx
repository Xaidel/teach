import { useEffect, useRef, useState } from 'react'

import type { ExplanationPreferences } from '#/features/learners/learners.schema'
import { Alert } from '#/shared/components/ui/alert'
import { Badge } from '#/shared/components/ui/badge'
import { Button } from '#/shared/components/ui/button'

import { errorMessage } from '../client-utils'
import { generateLessonFn } from '../curriculum.functions'
import type {
  CurriculumLanguage,
  CurriculumLesson,
  CurriculumStepStatus,
} from '../curriculum.schema'
import { ExplanationPopover } from './explanation-popover'

type ConceptPanelProps = {
  language: CurriculumLanguage
  conceptSlug: string
  position: number
  difficulty: number
  mastery: string
  status: CurriculumStepStatus
  explanationPreferences: ExplanationPreferences
  /** Fires once the lesson's first generation settles, success or failure —
   * the parent step page uses it to know when to drop its full-page loading
   * screen (StepLoadingScreen). Not called for later regenerations (e.g. via
   * ExplanationPopover), which the page has already revealed by then. */
  onReady?: () => void
}

/**
 * The step page's left column (NodeDetail.dc.html): the concept's identity
 * plus its generated explanation. The lesson generates automatically on
 * arrival — a deliberate reversal of `step-lesson-card.tsx`'s "never
 * auto-generated" decision (issue #135), made so this panel reads like the
 * design's always-populated description instead of starting behind a
 * button. There's no stored description/example on the concept itself
 * (`CurriculumStepDetail.concept` is only id/slug/difficulty) — the
 * generated lesson explanation is the only real content available for this
 * panel, so it stands in for both.
 */
export function ConceptPanel({
  language,
  conceptSlug,
  position,
  difficulty,
  mastery,
  status,
  explanationPreferences,
  onReady,
}: ConceptPanelProps): React.JSX.Element {
  const [lesson, setLesson] = useState<CurriculumLesson>()
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string>()
  const hasNotifiedReadyRef = useRef(false)

  async function handleGenerate(): Promise<void> {
    setError(undefined)
    setIsPending(true)
    try {
      setLesson(await generateLessonFn({ data: { language, conceptSlug } }))
    } catch (generationError) {
      setError(
        errorMessage(
          generationError,
          'The lesson could not be generated. Try again.',
        ),
      )
    } finally {
      setIsPending(false)
      if (!hasNotifiedReadyRef.current) {
        hasNotifiedReadyRef.current = true
        onReady?.()
      }
    }
  }

  useEffect(() => {
    void handleGenerate()
    // Mount-only: this panel owns exactly one concept for its lifetime.
  }, [])

  return (
    <aside
      aria-label={`Concept — ${conceptSlug}`}
      className="flex h-full flex-col gap-4 overflow-y-auto rounded-2xl border border-border bg-card p-6"
      data-slot="concept-panel"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Badge>{language}</Badge>
          <Badge>difficulty {String(difficulty)}</Badge>
          <Badge>mastery: {mastery}</Badge>
          <Badge>{status}</Badge>
        </div>
        <ExplanationPopover
          initial={explanationPreferences}
          onSaved={() => void handleGenerate()}
        />
      </div>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground">
        Step {String(position)} — {conceptSlug}
      </h1>
      {isPending ? (
        <p className="text-sm text-muted-foreground" role="status">
          Generating the lesson…
        </p>
      ) : null}
      {error ? (
        <div className="grid gap-2 justify-self-start">
          <Alert>{error}</Alert>
          <Button
            disabled={isPending}
            onClick={() => void handleGenerate()}
            size="sm"
            type="button"
            variant="outline"
          >
            Try again
          </Button>
        </div>
      ) : null}
      {lesson ? (
        <p className="text-sm leading-relaxed text-foreground">
          {lesson.explanation}
        </p>
      ) : null}
    </aside>
  )
}
