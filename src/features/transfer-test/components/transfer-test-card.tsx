import { Link } from '@tanstack/react-router'
import { useState } from 'react'

import { Alert } from '#/shared/components/ui/alert'
import { Badge } from '#/shared/components/ui/badge'
import { Button } from '#/shared/components/ui/button'
import { Card, CardContent, CardHeader } from '#/shared/components/ui/card'
import { Label } from '#/shared/components/ui/label'

import { errorMessage } from '../client-utils'
import { generateTransferTestExerciseFn } from '../transfer-test.functions'
import type {
  TransferTestEligibleConcept,
  TransferTestExerciseView,
} from '../transfer-test.schema'

/**
 * The Transfer Test surface (SPEC story 46, ADR-0015, ADR-0010, issue #17):
 * pick a Practiced concept and generate a structurally different exercise
 * (debug mode) for it, through the exact same generation + Pre-Flight
 * pipeline as any other exercise. Solving it — like any exercise — happens
 * in the practice list; a passed Transfer Test is required, alongside a
 * passed Explanation Assessment, before the concept can be promoted to
 * Demonstrated.
 */
export function TransferTestCard({
  concepts,
}: {
  concepts: TransferTestEligibleConcept[]
}): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string | undefined>(
    concepts[0]?.conceptId,
  )
  const [isPending, setIsPending] = useState(false)
  const [result, setResult] = useState<TransferTestExerciseView>()
  const [error, setError] = useState<string>()

  const selected = concepts.find((concept) => concept.conceptId === selectedId)

  async function handleGenerate(): Promise<void> {
    if (!selectedId) return
    setError(undefined)
    setResult(undefined)
    setIsPending(true)
    try {
      setResult(
        await generateTransferTestExerciseFn({
          data: { conceptId: selectedId },
        }),
      )
    } catch (generationError) {
      setError(
        errorMessage(
          generationError,
          'The Transfer Test exercise could not be generated. Try again.',
        ),
      )
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Card aria-label="Transfer Test">
      <CardHeader>
        <h2 className="font-display text-2xl font-semibold tracking-tight">
          Transfer your mastery to a new problem
        </h2>
        <p className="leading-relaxed text-muted-foreground">
          Passing one exercise pattern isn&apos;t the same as understanding a
          concept. Once a concept is Practiced, generate a structurally
          different exercise for it — a debug-mode challenge with a known defect
          — through the same generation and Pre-Flight pipeline as any other
          exercise. It's required, alongside a passed Explanation Assessment,
          before the concept can be promoted to Demonstrated.
        </p>
      </CardHeader>
      <CardContent>
        {concepts.length === 0 ? (
          <p className="rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
            No concepts are eligible yet. Reach Practiced on a concept (pass a
            generated exercise targeting it) and it will appear here for its
            Transfer Test.
          </p>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Eligible concepts</Label>
              <ul className="flex flex-wrap gap-2">
                {concepts.map((concept) => (
                  <li key={concept.conceptId}>
                    <button
                      aria-pressed={concept.conceptId === selectedId}
                      className={
                        concept.conceptId === selectedId
                          ? 'inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                          : 'inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                      }
                      onClick={() => setSelectedId(concept.conceptId)}
                      type="button"
                    >
                      <span className="font-mono">{concept.slug}</span>
                      {concept.hasPassedTest ? (
                        <Badge className="border-primary/40 bg-primary/10 text-primary">
                          Transfer Test passed
                        </Badge>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="grid justify-items-start gap-2">
              <Button
                disabled={isPending || !selected}
                onClick={() => void handleGenerate()}
              >
                {isPending
                  ? 'Generating...'
                  : `Generate a Transfer Test${selected ? ` for "${selected.slug}"` : ''}`}
              </Button>
              {isPending ? (
                <p className="sr-only" role="status">
                  Generating and validating the Transfer Test exercise.
                </p>
              ) : null}
              {error ? <Alert>{error}</Alert> : null}
            </div>

            {result ? <TransferTestResult result={result} /> : null}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/** Renders a generated Transfer Test's hand-off to the practice list. */
function TransferTestResult({
  result,
}: {
  result: TransferTestExerciseView
}): React.JSX.Element {
  return (
    <div className="grid gap-2 border-t border-border pt-4 text-sm leading-relaxed text-muted-foreground">
      <p>
        {result.reused ? 'Your Transfer Test for' : 'Transfer Test ready for'}{' '}
        <span className="font-mono text-foreground">{result.conceptSlug}</span>{' '}
        — <span className="font-semibold text-foreground">{result.title}</span>.
        Solve it in the practice list like any other exercise; a pass is
        recorded as Transfer Test evidence automatically.
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
