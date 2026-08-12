import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'

import { Alert } from '#/shared/components/ui/alert'
import { Badge } from '#/shared/components/ui/badge'
import { Button } from '#/shared/components/ui/button'
import type { SandboxLanguage } from '#/lib/sandbox/types'

import { draftConceptsFn } from '../concepts.functions'
import { errorMessage } from '../client-utils'
import type { DraftConceptsOutput } from '../concepts.schema'

/** Formats one dropped edge for the draft report. */
function edgeLabel(edge: { from: string; to: string; kind: string }): string {
  return `${edge.from} → ${edge.to} (${edge.kind})`
}

/** Triggers and reports one AI Concept Graph draft for a language. */
export function DraftPanel({
  language,
}: {
  language: SandboxLanguage
}): React.JSX.Element {
  const router = useRouter()
  const [isPending, setIsPending] = useState(false)
  const [result, setResult] = useState<DraftConceptsOutput>()
  const [error, setError] = useState<string>()

  async function handleDraft(): Promise<void> {
    setError(undefined)
    setResult(undefined)
    setIsPending(true)
    try {
      setResult(await draftConceptsFn({ data: { language } }))
      await router.invalidate()
    } catch (draftError) {
      setError(errorMessage(draftError, 'The draft could not be generated.'))
    } finally {
      setIsPending(false)
    }
  }

  return (
    <div className="grid justify-items-start gap-2">
      <Button disabled={isPending} onClick={() => void handleDraft()}>
        {isPending ? 'Drafting...' : `Draft ${language} concepts`}
      </Button>
      {isPending ? (
        <p className="sr-only" role="status">
          Drafting the {language} Concept Graph.
        </p>
      ) : null}
      {error ? <Alert>{error}</Alert> : null}
      {result ? (
        <div className="grid max-w-xl gap-1.5 text-sm leading-relaxed text-muted-foreground">
          <p>
            Draft complete: {String(result.conceptsInserted)} concepts and{' '}
            {String(result.edgesInserted)} edges written
            {result.duplicateConcepts + result.duplicateEdges > 0
              ? ` (${String(result.duplicateConcepts)} duplicate concepts, ${String(result.duplicateEdges)} duplicate edges skipped)`
              : ''}
            .
          </p>
          {result.cycleEdges.length > 0 ? (
            <p>
              <Badge className="mr-1.5 border-destructive/30 bg-destructive/10 text-destructive">
                Excluded — cycle
              </Badge>
              {result.cycleEdges.map((edge) => edgeLabel(edge)).join(', ')}
            </p>
          ) : null}
          {result.droppedDanglingEdges.length > 0 ? (
            <p>
              <Badge className="mr-1.5 border-destructive/30 bg-destructive/10 text-destructive">
                Dropped — dangling
              </Badge>
              {result.droppedDanglingEdges
                .map((edge) => edgeLabel(edge))
                .join(', ')}
            </p>
          ) : null}
          {result.droppedSelfLoops.length > 0 ? (
            <p>
              <Badge className="mr-1.5 border-destructive/30 bg-destructive/10 text-destructive">
                Dropped — self-loop
              </Badge>
              {result.droppedSelfLoops
                .map((edge) => edgeLabel(edge))
                .join(', ')}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
