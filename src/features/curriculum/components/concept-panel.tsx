import { useEffect, useRef, useState } from 'react'

import type { ExplanationPreferences } from '#/features/learners/learners.schema'
import { Alert } from '#/shared/components/ui/alert'
import { Badge } from '#/shared/components/ui/badge'
import { Button } from '#/shared/components/ui/button'

import type { LessonInlineSegment } from '../client-utils'
import { errorMessage, parseLessonBlocks } from '../client-utils'
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
    // Hide whatever's on screen while this runs, so a regeneration (from the
    // popover, or a retry after failure) reads as "generating a fresh
    // explanation" rather than leaving the stale one up alongside the
    // loading text. On failure we put the previous explanation straight
    // back — regeneration failing shouldn't cost the learner the one they
    // already had.
    const previousLesson = lesson
    setError(undefined)
    setLesson(undefined)
    setIsPending(true)
    try {
      setLesson(await generateLessonFn({ data: { language, conceptSlug } }))
    } catch (generationError) {
      setLesson(previousLesson)
      setError(
        previousLesson
          ? "That's not possible right now — showing the previous explanation."
          : errorMessage(
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
    // The panel's own width is fixed by the step page's drag-to-resize
    // column (`use-resizable-column.ts`), so this only scrolls vertically.
    // `scrollbar-hidden` (styles.css) keeps that scroll working without the
    // scrollbar chrome.
    <aside
      aria-label={`Concept — ${conceptSlug}`}
      className="scrollbar-hidden flex h-full flex-col gap-4 overflow-y-auto rounded-2xl border border-border bg-card p-6"
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
      {lesson ? <LessonExplanation lesson={lesson} /> : null}
    </aside>
  )
}

/**
 * Renders a generated lesson's explanation with real text hierarchy:
 * headings, paragraphs, and lists as their semantic elements, and fenced
 * code as a monospace block — instead of dumping the markdown the AI
 * Teacher was prompted to produce (`explain-concept.prompt.ts`) as one
 * flat paragraph of text.
 */
function LessonExplanation({
  lesson,
}: {
  lesson: CurriculumLesson
}): React.JSX.Element {
  const blocks = parseLessonBlocks(lesson.explanation)

  return (
    <div className="grid gap-2">
      {blocks.map((block, index) => {
        // Block order within a single generated explanation is stable.
        switch (block.type) {
          case 'heading': {
            const Heading = block.level === 2 ? 'h2' : 'h3'
            return (
              <Heading
                className={
                  block.level === 2
                    ? 'text-base font-semibold text-foreground'
                    : 'text-sm font-semibold text-foreground'
                }
                key={index}
              >
                <InlineSegments segments={block.segments} />
              </Heading>
            )
          }
          case 'list':
            return (
              <ul className="grid list-disc gap-1 pl-5" key={index}>
                {block.items.map((item, itemIndex) => (
                  <li
                    className="text-sm leading-relaxed text-foreground"
                    key={itemIndex}
                  >
                    <InlineSegments segments={item} />
                  </li>
                ))}
              </ul>
            )
          case 'paragraph':
            return (
              <p
                className="text-sm leading-relaxed text-foreground"
                key={index}
              >
                <InlineSegments segments={block.segments} />
              </p>
            )
          case 'code':
            return (
              <pre
                className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-background p-4 font-mono text-xs leading-relaxed text-foreground"
                key={index}
              >
                <code>{block.code}</code>
              </pre>
            )
        }
      })}
    </div>
  )
}

/** Renders a line's inline markdown spans — bold, code, and plain text. */
function InlineSegments({
  segments,
}: {
  segments: LessonInlineSegment[]
}): React.JSX.Element {
  return (
    <>
      {segments.map((segment, index) => {
        // Segment order within a line is stable.
        switch (segment.type) {
          case 'bold':
            return (
              <strong className="font-semibold" key={index}>
                {segment.text}
              </strong>
            )
          case 'code':
            return (
              <code
                className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
                key={index}
              >
                {segment.text}
              </code>
            )
          case 'text':
            return segment.text
        }
      })}
    </>
  )
}
