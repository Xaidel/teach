import { useState } from 'react'

import { Alert } from '#/shared/components/ui/alert'
import { Button } from '#/shared/components/ui/button'

import { errorMessage } from '../client-utils'
import { RetrievalQueueCard } from '../components/retrieval-queue-card'
import { startRetrievalReviewFn } from '../retrieval.functions'
import type { RetrievalQueueView, RetrievalTestView } from '../retrieval.schema'

/**
 * The Daily Review session (SPEC story 48, issue #18 AC 3): the ambient,
 * user-initiated retrieval surface. Shows the full Retrieval Queue and
 * offers a single "Start Daily Review" action that begins the Refresher
 * Test on the highest-priority due concept — the learner walks the queue
 * one review at a time, never interrupted mid-activity.
 */
export function RetrievalPage({
  view,
}: {
  view: RetrievalQueueView
}): React.JSX.Element {
  const [isStarting, setIsStarting] = useState(false)
  const [result, setResult] = useState<RetrievalTestView>()
  const [error, setError] = useState<string>()

  const topEntry = view.highPriority[0] ?? view.due[0]

  async function handleStartDailyReview(): Promise<void> {
    if (!topEntry) return
    setError(undefined)
    setResult(undefined)
    setIsStarting(true)
    try {
      setResult(
        await startRetrievalReviewFn({
          data: { conceptId: topEntry.conceptId },
        }),
      )
    } catch (startError) {
      setError(
        errorMessage(
          startError,
          'The Daily Review could not be started. Try again.',
        ),
      )
    } finally {
      setIsStarting(false)
    }
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
      <header className="mb-10 grid gap-4 border-b border-border pb-8">
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-primary">
          Spaced retrieval
        </p>
        <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <h1 className="max-w-3xl font-display text-5xl font-semibold leading-[0.95] tracking-tight sm:text-6xl">
              Daily Review.
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Concepts are due on a fixed 24h → 3d → 7d → 21d → 60d schedule
              since your last successful retrieval. Start a Refresher Test on
              any due concept — pass to move it to Retained and grow its
              interval, fail to revert it to Practiced and schedule remediation.
            </p>
          </div>
          <div className="grid justify-items-start gap-2">
            <Button
              disabled={isStarting || !topEntry}
              onClick={() => void handleStartDailyReview()}
            >
              {isStarting
                ? 'Starting...'
                : topEntry
                  ? 'Start Daily Review'
                  : 'Nothing due'}
            </Button>
            {isStarting ? (
              <p className="sr-only" role="status">
                Starting the Daily Review for the top due concept.
              </p>
            ) : null}
            {error ? <Alert>{error}</Alert> : null}
          </div>
        </div>
      </header>

      {result ? (
        <p className="mb-8 max-w-4xl rounded-2xl border border-border bg-card px-5 py-4 text-sm leading-relaxed text-muted-foreground">
          Daily Review started for{' '}
          <span className="font-mono text-foreground">
            {result.conceptSlug}
          </span>{' '}
          —{' '}
          <span className="font-semibold text-foreground">{result.title}</span>.
          Head to the practice list to solve it, then come back for the next
          one.
        </p>
      ) : null}

      <RetrievalQueueCard view={view} />

      <footer className="mt-12 border-t border-border pt-6 text-sm text-muted-foreground">
        Retrieval is ambient and user-initiated — it never interrupts active
        work.
      </footer>
    </main>
  )
}
