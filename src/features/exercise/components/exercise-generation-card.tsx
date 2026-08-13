import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'

import { Alert } from '#/shared/components/ui/alert'
import { Button } from '#/shared/components/ui/button'
import { Card, CardContent, CardHeader } from '#/shared/components/ui/card'
import { Label } from '#/shared/components/ui/label'

import { generateExerciseFn } from '../exercise.functions'
import { MAX_PREFLIGHT_ATTEMPTS } from '../exercise-generation.schema'
import type { GenerateExerciseOutput } from '../exercise-generation.schema'
import type { SandboxLanguage } from '#/lib/sandbox/types'
import { errorMessage } from '../client-utils'

/** One selectable Concept Graph concept for the generation picker. */
export type GenerationConcept = {
  id: string
  slug: string
  difficulty: number
}

/**
 * The exercise generation surface (issue #8): pick a usable Concept Graph
 * concept for the language and have the AI Teacher Engine generate an
 * exercise for it, run through the deterministic Pre-Flight Validation
 * gate. Only a verified exercise is persisted and then appears in the
 * exercise list below.
 */
export function ExerciseGenerationCard({
  language,
  concepts,
}: {
  language: SandboxLanguage
  concepts: GenerationConcept[]
}): React.JSX.Element {
  const router = useRouter()
  const [conceptSlug, setConceptSlug] = useState(
    concepts[0]?.slug ?? 'no-concepts',
  )
  const [isPending, setIsPending] = useState(false)
  const [result, setResult] = useState<GenerateExerciseOutput>()
  const [error, setError] = useState<string>()
  const conceptSelectId = `generate-concept-${language}`

  async function handleGenerate(): Promise<void> {
    setError(undefined)
    setResult(undefined)
    setIsPending(true)
    try {
      setResult(await generateExerciseFn({ data: { language, conceptSlug } }))
      await router.invalidate()
    } catch (generationError) {
      setError(
        errorMessage(
          generationError,
          'The exercise could not be generated. Try again.',
        ),
      )
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Card aria-label={`Exercise generation — ${language}`}>
      <CardHeader>
        <h2 className="font-display text-2xl font-semibold tracking-tight">
          Generate a {language} exercise
        </h2>
        <p className="leading-relaxed text-muted-foreground">
          The AI Teacher Engine generates a real exercise for a target concept;
          Pre-Flight Validation compiles the reference solution, runs the
          generated tests, and confirms the intended broken state fails before
          the exercise is ever shown to you.
        </p>
      </CardHeader>
      <CardContent>
        {concepts.length === 0 ? (
          <p className="rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
            No concepts for {language} yet. Draft the Concept Graph on the
            concepts page first, then generate an exercise here.
          </p>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor={conceptSelectId}>Target concept</Label>
              <select
                className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                disabled={isPending}
                id={conceptSelectId}
                onChange={(event) => setConceptSlug(event.target.value)}
                value={conceptSlug}
              >
                {concepts.map((concept) => (
                  <option key={concept.id} value={concept.slug}>
                    {concept.slug} (difficulty {String(concept.difficulty)})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid justify-items-start gap-2">
              <Button
                disabled={isPending}
                onClick={() => void handleGenerate()}
              >
                {isPending ? 'Generating...' : `Generate ${language} exercise`}
              </Button>
              {isPending ? (
                <p className="sr-only" role="status">
                  Generating and validating the exercise.
                </p>
              ) : null}
              {error ? <Alert>{error}</Alert> : null}
              {result ? (
                result.kind === 'verified-fallback' ? (
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Fell back to a previously verified exercise —{' '}
                    {result.exercise.title}. All{' '}
                    {String(MAX_PREFLIGHT_ATTEMPTS)} generation attempts failed
                    Pre-Flight, so the stored verified exercise for this concept
                    is served as-is (issue #9).
                  </p>
                ) : (
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Verified — {result.exercise.title} (~
                    {String(result.estimatedMinutes)} min). Pre-Flight passed
                    all {String(result.preflight.checks.length)} checks
                    {result.simplified
                      ? ' after a fallback regeneration with a simplified constraint set'
                      : ''}
                    . The exercise now appears in the practice list below.
                  </p>
                )
              ) : null}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
