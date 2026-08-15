import { Book, BookOpen } from 'lucide-react'
import { useEffect, useState } from 'react'

/** What the AI Teacher Engine is doing while a step's lesson and starting
 * exercise generate — rotated so the wait reads as progress rather than a
 * stalled page. Order doubles as the rough sequence a learner cares about:
 * the lesson first, then the exercise's tests, then the exercise itself. */
const GENERATION_MESSAGES = [
  'Generating the lesson…',
  'Writing the tests…',
  'Preparing the exercise…',
] as const

/** The book flips open/closed on every tick; the message advances every
 * other tick, so the page reads as one continuous "working" animation
 * rather than two clocks running past each other. */
const TICK_MS = 900

/**
 * Full-page interstitial (CurriculumStepPage) shown from the moment a
 * Concept Graph node is clicked until the step's lesson (ConceptPanel) and
 * starting exercise (ConceptExercisePanel) have both settled — replaces the
 * old experience of landing straight on a half-built page with two separate
 * inline "Generating…" strings. The book icon crossfades between its closed
 * and open lucide variants (no built-in "morph" animation exists) to read
 * as a book being opened rather than a generic spinner.
 */
export function StepLoadingScreen(): React.JSX.Element {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => {
      setTick((current) => current + 1)
    }, TICK_MS)
    return () => window.clearInterval(id)
  }, [])

  const isOpen = tick % 2 === 1
  const messageIndex = Math.floor(tick / 2) % GENERATION_MESSAGES.length

  return (
    <div
      aria-label="Preparing this step"
      className="fixed inset-0 z-50 grid place-items-center bg-background"
      role="status"
    >
      <div className="flex flex-col items-center gap-4">
        <span className="relative inline-flex size-16 items-center justify-center rounded-full bg-primary">
          <Book
            aria-hidden="true"
            className={`absolute size-7 text-primary-foreground transition-opacity duration-500 motion-reduce:transition-none ${
              isOpen ? 'opacity-0' : 'opacity-100'
            }`}
          />
          <BookOpen
            aria-hidden="true"
            className={`absolute size-7 text-primary-foreground transition-opacity duration-500 motion-reduce:transition-none ${
              isOpen ? 'opacity-100' : 'opacity-0'
            }`}
          />
        </span>
        <p className="text-sm font-medium text-muted-foreground">
          {GENERATION_MESSAGES[messageIndex]}
        </p>
      </div>
    </div>
  )
}
