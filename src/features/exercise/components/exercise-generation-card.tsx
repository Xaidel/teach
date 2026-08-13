import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'

import { Alert } from '#/shared/components/ui/alert'
import { Button } from '#/shared/components/ui/button'
import { Card, CardContent, CardHeader } from '#/shared/components/ui/card'
import { Label } from '#/shared/components/ui/label'

import { generateExerciseFn } from '../exercise.functions'
import {
  MAX_PREFLIGHT_ATTEMPTS,
  PRE_FLIGHT_REPEATED_FAILURE_THRESHOLD,
} from '../exercise-generation.schema'
import type {
  GenerateExerciseOutput,
  PreFlightAttemptAggregate,
} from '../exercise-generation.schema'
import type { SandboxLanguage } from '#/lib/sandbox/types'
import type { ExerciseDefect } from '#/lib/ai/schemas'
import { errorMessage } from '../client-utils'

/**
 * The adversarial label suffix shared by the generated and verified-fallback
 * branches (issue #120): ` — adversarial (kind) description`. Rendered when
 * the served exercise declares a defect; kinds are stored snake_case and
 * displayed with spaces.
 */
function renderAdversarialLabel(defect: ExerciseDefect): string {
  return ` — adversarial (${defect.kind.replaceAll('_', ' ')}) ${defect.description}`
}

/** One selectable Concept Graph concept for the generation picker. */
export type GenerationConcept = {
  id: string
  slug: string
  difficulty: number
  /**
   * The concept's Pre-Flight attempt aggregate (SPEC story 35), or null
   * when no generation has ever been attempted for it — the raw material
   * of the repeated-failure quality signal.
   */
  preFlight: PreFlightAttemptAggregate | null
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
  const [isAdversarial, setIsAdversarial] = useState(false)
  const [isPending, setIsPending] = useState(false)
  const [result, setResult] = useState<GenerateExerciseOutput>()
  const [error, setError] = useState<string>()
  const conceptSelectId = `generate-concept-${language}`
  const adversarialToggleId = `generate-adversarial-${language}`
  const selectedConcept = concepts.find(
    (concept) => concept.slug === conceptSlug,
  )
  const preFlightSignal =
    selectedConcept?.preFlight &&
    selectedConcept.preFlight.failedAttempts >=
      PRE_FLIGHT_REPEATED_FAILURE_THRESHOLD
      ? selectedConcept.preFlight
      : null

  async function handleGenerate(): Promise<void> {
    setError(undefined)
    setResult(undefined)
    setIsPending(true)
    try {
      setResult(
        await generateExerciseFn({
          data: { language, conceptSlug, adversarial: isAdversarial },
        }),
      )
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
          the exercise is ever shown to you. Adversarial exercises start from
          broken code with one known defect to find and fix — verified by the
          same Pre-Flight gate.
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
                className="h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
            <div className="grid gap-1.5">
              <div className="flex items-start gap-2">
                <input
                  checked={isAdversarial}
                  className="mt-1 size-4 rounded border border-input bg-background accent-foreground"
                  disabled={isPending}
                  id={adversarialToggleId}
                  onChange={(event) => setIsAdversarial(event.target.checked)}
                  type="checkbox"
                />
                <Label
                  className="text-sm leading-relaxed text-muted-foreground"
                  htmlFor={adversarialToggleId}
                >
                  Adversarial — start from broken code containing one known
                  defect; the task is to find and fix it (SPEC stories 51-52).
                </Label>
              </div>
            </div>
            {preFlightSignal ? (
              <p className="rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
                <strong className="font-semibold text-foreground">
                  Quality signal
                </strong>{' '}
                — {String(preFlightSignal.failedAttempts)} of the{' '}
                {String(preFlightSignal.totalAttempts)} Pre-Flight runs for this
                concept failed; repeated failures mean generation has been
                unreliable here.
              </p>
            ) : null}
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
                    {result.exercise.title}
                    {result.defect ? renderAdversarialLabel(result.defect) : ''}
                    . All {String(MAX_PREFLIGHT_ATTEMPTS)} generation attempts
                    failed Pre-Flight, so the stored verified exercise for this
                    concept is served as-is (issue #9).
                  </p>
                ) : (
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Verified — {result.exercise.title} (~
                    {String(result.estimatedMinutes)} min). Pre-Flight passed
                    all {String(result.preflight.checks.length)} checks
                    {result.simplified
                      ? ' after a fallback regeneration with a simplified constraint set'
                      : ''}
                    {result.defect ? renderAdversarialLabel(result.defect) : ''}
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
