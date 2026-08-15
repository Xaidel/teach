import { useState } from 'react'
import { Link } from '@tanstack/react-router'

import type { ExerciseGenerationLanguage } from '#/features/exercise/exercise-generation.schema'
import { MASTERY_LABELS } from '#/lib/mastery-states'
import { Alert } from '#/shared/components/ui/alert'
import { Badge } from '#/shared/components/ui/badge'
import { Button } from '#/shared/components/ui/button'
import { Card, CardContent, CardHeader } from '#/shared/components/ui/card'
import { Label } from '#/shared/components/ui/label'
import { Textarea } from '#/shared/components/ui/textarea'

import { errorMessage } from '../client-utils'
import { startTacticalSprintFn } from '../tactical-sprint.functions'
import type { TacticalSprintResult } from '../tactical-sprint.schema'

/**
 * The Tactical Sprint (Class B) entry surface (SPEC stories 4-7, ticket
 * #13): a learner pastes an AI-generated snippet they don't understand, the
 * AI Teacher Engine identifies the concepts it depends on, the platform
 * targets the one they're weakest on, and a 5-10 minute exercise is
 * generated and Pre-Flight-verified for it. The generated exercise is a
 * normal persisted exercise — solving it happens on the practice page's
 * existing exercise flow, not a duplicate one here.
 */
export function TacticalSprintCard({
  language,
}: {
  language: ExerciseGenerationLanguage
}): React.JSX.Element {
  const [snippet, setSnippet] = useState('')
  const [isPending, setIsPending] = useState(false)
  const [result, setResult] = useState<TacticalSprintResult>()
  const [error, setError] = useState<string>()
  const snippetInputId = `tactical-sprint-snippet-${language}`

  async function handleAnalyze(): Promise<void> {
    setError(undefined)
    setResult(undefined)
    setIsPending(true)
    try {
      setResult(await startTacticalSprintFn({ data: { language, snippet } }))
    } catch (analysisError) {
      setError(
        errorMessage(
          analysisError,
          'The snippet could not be analyzed. Try again.',
        ),
      )
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Card aria-label={`Tactical Sprint — ${language}`}>
      <CardHeader>
        <h2 className="font-display text-2xl font-semibold tracking-tight">
          Paste a snippet you don&apos;t understand
        </h2>
        <p className="leading-relaxed text-muted-foreground">
          The AI Teacher Engine identifies the concepts behind an AI-generated
          snippet, compares them against your current mastery, and turns the one
          you&apos;re weakest on into a 5-10 minute targeted exercise — verified
          by the same Pre-Flight gate as any other exercise.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor={snippetInputId}>{language} snippet</Label>
            <Textarea
              className="min-h-40 font-mono text-xs leading-relaxed"
              disabled={isPending}
              id={snippetInputId}
              onChange={(event) => setSnippet(event.target.value)}
              placeholder={`Paste the ${language} snippet you don't understand...`}
              spellCheck={false}
              value={snippet}
            />
          </div>
          <div className="grid justify-items-start gap-2">
            <Button
              disabled={isPending || snippet.trim().length === 0}
              onClick={() => void handleAnalyze()}
            >
              {isPending ? 'Analyzing...' : 'Analyze snippet'}
            </Button>
            {isPending ? (
              <p className="sr-only" role="status">
                Identifying concepts and generating a targeted exercise.
              </p>
            ) : null}
            {error ? <Alert>{error}</Alert> : null}
          </div>
          {result ? (
            <div className="grid gap-4 border-t border-border pt-4">
              <div className="grid gap-2">
                <h3 className="text-sm font-semibold text-foreground">
                  Concepts in this snippet
                </h3>
                <ul className="grid gap-2">
                  {result.identifiedConcepts.map((concept) => {
                    const isTarget = concept.slug === result.targetConceptSlug
                    return (
                      <li
                        className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm"
                        key={concept.slug}
                      >
                        <span className="font-mono font-semibold text-foreground">
                          {concept.slug}
                        </span>
                        <Badge>{MASTERY_LABELS[concept.masteryState]}</Badge>
                        {!concept.matched ? <Badge>New concept</Badge> : null}
                        {isTarget ? (
                          <Badge className="border-primary/40 bg-primary/10 text-primary">
                            Target — weakest
                          </Badge>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              </div>
              <div className="grid gap-2 rounded-2xl border border-border bg-muted/40 px-4 py-3">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Exercise ready —{' '}
                  <span className="font-semibold text-foreground">
                    {result.exercise.exercise.title}
                  </span>
                  {result.exercise.kind === 'generated'
                    ? ` (~${String(result.exercise.estimatedMinutes)} min).`
                    : '.'}{' '}
                  It now appears in the practice list.
                </p>
                <Link
                  className="inline-flex w-fit rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  search={{ exerciseId: result.exercise.exercise.id }}
                  to="/practice"
                >
                  Go solve it
                </Link>
              </div>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
