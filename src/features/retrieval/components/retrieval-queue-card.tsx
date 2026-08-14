import { Link } from '@tanstack/react-router'
import { useState } from 'react'

import type { MasteryState } from '#/lib/mastery-states'
import { Alert } from '#/shared/components/ui/alert'
import { Badge } from '#/shared/components/ui/badge'
import { Button } from '#/shared/components/ui/button'
import { Card, CardContent, CardHeader } from '#/shared/components/ui/card'

import { errorMessage } from '../client-utils'
import { startRetrievalReviewFn } from '../retrieval.functions'
import type {
  RetrievalQueueEntry,
  RetrievalQueueView,
  RetrievalTestView,
} from '../retrieval.schema'

/** Human labels for the five mastery states (display mirror). */
const MASTERY_LABELS: Record<MasteryState, string> = {
  unknown: 'Unknown',
  introduced: 'Introduced',
  practiced: 'Practiced',
  demonstrated: 'Demonstrated',
  retained: 'Retained',
}

/**
 * The Retrieval Queue surface (SPEC story 47, PRD §23.1, issue #18): the
 * concepts due for spaced retrieval, bucketed into High Priority (a failed
 * previous review, due now), Due, and Upcoming, each with a button that
 * starts the concept's Refresher Test. In compact mode (the practice home
 * dashboard) only the reviewable buckets render, capped, with a link to
 * the full Daily Review page.
 */
export function RetrievalQueueCard({
  view,
  compact = false,
}: {
  view: RetrievalQueueView
  compact?: boolean
}): React.JSX.Element {
  const [startingId, setStartingId] = useState<string | undefined>()
  const [result, setResult] = useState<RetrievalTestView>()
  const [error, setError] = useState<string>()

  async function handleStart(entry: RetrievalQueueEntry): Promise<void> {
    setError(undefined)
    setResult(undefined)
    setStartingId(entry.conceptId)
    try {
      setResult(
        await startRetrievalReviewFn({ data: { conceptId: entry.conceptId } }),
      )
    } catch (startError) {
      setError(
        errorMessage(
          startError,
          'The Refresher Test could not be started. Try again.',
        ),
      )
    } finally {
      setStartingId(undefined)
    }
  }

  const reviewable = [...view.highPriority, ...view.due]
  const upcoming = view.upcoming
  const reviewableEntries = compact ? reviewable.slice(0, 5) : reviewable

  return (
    <Card aria-label="Retrieval Queue">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-2xl font-semibold tracking-tight">
            Retrieval Queue
          </h2>
          <Badge className="border-border bg-background text-muted-foreground">
            {view.dueCount} due {view.dueCount === 1 ? 'concept' : 'concepts'}
          </Badge>
        </div>
        <p className="leading-relaxed text-muted-foreground">
          Spaced retrieval keeps mastered concepts retained: each concept is due
          on a fixed 24h → 3d → 7d → 21d → 60d schedule since its last
          successful retrieval. Pass a Refresher Test and the concept moves to
          Retained and its interval grows; fail one and it reverts to Practiced
          and is requeued for remediation — history is always preserved.
        </p>
      </CardHeader>
      <CardContent>
        {result ? <ReviewHandoff result={result} /> : null}
        {error ? <Alert>{error}</Alert> : null}

        {reviewable.length === 0 ? (
          <p className="rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
            Nothing is due for review right now. Complete an exercise and the
            concept will be scheduled here 24 hours after your success.
          </p>
        ) : (
          <div className="grid gap-6">
            {reviewableEntries.length > 0 ? (
              <QueueSection
                entries={reviewableEntries}
                onStart={handleStart}
                startingId={startingId}
              />
            ) : null}

            {compact && upcoming.length > 0 ? (
              <p className="text-sm text-muted-foreground">
                {String(upcoming.length)}{' '}
                {upcoming.length === 1 ? 'concept is' : 'concepts are'} upcoming
                —{' '}
                <Link
                  className="font-semibold text-primary underline"
                  to="/retrieval"
                >
                  see the Daily Review →
                </Link>
              </p>
            ) : null}

            {!compact && upcoming.length > 0 ? (
              <QueueSection
                entries={upcoming}
                onStart={handleStart}
                startingId={startingId}
                title="Upcoming"
              />
            ) : null}
          </div>
        )}

        {compact ? (
          <p className="mt-4 border-t border-border pt-4 text-sm">
            <Link
              className="font-semibold text-primary underline"
              to="/retrieval"
            >
              Open the Daily Review →
            </Link>
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

/** One bucket of queue entries (High Priority / Due / Upcoming). */
function QueueSection({
  entries,
  onStart,
  startingId,
  title,
}: {
  entries: RetrievalQueueEntry[]
  onStart: (entry: RetrievalQueueEntry) => Promise<void>
  startingId: string | undefined
  title?: string
}): React.JSX.Element {
  const heading = title ?? 'Due for review'
  return (
    <section aria-label={heading} className="grid gap-3">
      <h3 className="text-xs font-bold uppercase tracking-[0.24em] text-primary">
        {heading}
      </h3>
      <ul className="grid gap-3">
        {entries.map((entry) => (
          <li
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-muted/30 px-4 py-3"
            key={entry.conceptId}
          >
            <div className="grid gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold text-foreground">
                  {entry.slug}
                </span>
                <Badge className="border-border bg-background text-muted-foreground">
                  {MASTERY_LABELS[entry.masteryState]}
                </Badge>
                {entry.remediation ? (
                  <Badge className="border-primary/40 bg-primary/10 text-primary">
                    Failed previous review
                  </Badge>
                ) : null}
              </div>
              <p className="text-sm text-muted-foreground">
                {formatDueStatus(entry.dueAt)} · next interval:{' '}
                {entry.intervalLabel}
              </p>
            </div>
            <Button
              disabled={startingId !== undefined}
              onClick={() => void onStart(entry)}
            >
              {startingId === entry.conceptId
                ? 'Starting...'
                : 'Start Refresher Test'}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Renders a started Refresher Test's hand-off to the practice list. */
function ReviewHandoff({
  result,
}: {
  result: RetrievalTestView
}): React.JSX.Element {
  return (
    <div className="grid gap-2 border-b border-border pb-4 text-sm leading-relaxed text-muted-foreground">
      <p>
        {result.reused ? 'Your Refresher Test for' : 'Refresher Test ready for'}{' '}
        <span className="font-mono text-foreground">{result.conceptSlug}</span>{' '}
        — <span className="font-semibold text-foreground">{result.title}</span>.
        Solve it in the practice list like any other exercise; a pass moves the
        concept to Retained, a failure reverts it to Practiced and schedules
        remediation.
      </p>
      <Link
        className="w-fit font-semibold text-primary underline"
        search={{ exerciseId: result.exerciseId }}
        to="/"
      >
        Go solve it →
      </Link>
    </div>
  )
}

/** A compact human status for a due_at ISO string ("due today", "overdue by 2 days", "due in 3 days"). */
function formatDueStatus(dueAtIso: string): string {
  const diffMs = new Date(dueAtIso).getTime() - Date.now()
  const absMs = Math.abs(diffMs)
  const minutes = Math.floor(absMs / (60 * 1000))
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (minutes < 60) return `due in ${String(minutes)} min`
  if (days >= 1) {
    const label = `${String(days)} ${days === 1 ? 'day' : 'days'}`
    return diffMs <= 0 ? `overdue by ${label}` : `due in ${label}`
  }
  const label = `${String(hours)} ${hours === 1 ? 'hour' : 'hours'}`
  return diffMs <= 0 ? `overdue by ${label}` : `due in ${label}`
}
