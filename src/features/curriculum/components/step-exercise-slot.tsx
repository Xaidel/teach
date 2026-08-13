import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'

import { Alert } from '#/shared/components/ui/alert'
import { Button } from '#/shared/components/ui/button'
import { Card, CardContent, CardHeader } from '#/shared/components/ui/card'
import { ExerciseEditor } from '../../exercise/components/exercise-editor'
import type { Exercise } from '../../exercise/exercise.schema'
import { MAX_PREFLIGHT_ATTEMPTS } from '../../exercise/exercise-generation.schema'

import { generateStepExerciseFn } from '../curriculum.functions'
import type { GenerateStepExerciseInput } from '../curriculum.schema'
import { errorMessage } from '../client-utils'

/**
 * One exercise slot of a Class A step (SPEC story 2, issue #14): guided or
 * independent. The slot's exercise is generated through the same
 * Pre-Flight-verified pipeline as any exercise (the no-skip-ahead gate runs
 * server-side before generation); an already-banked exercise for the slot
 * renders directly in the editor, and a new one can be generated any time.
 * The editor renders hints for the guided slot only — the independent
 * slot's exercise is served hint-free (the server rejects hint requests for
 * it regardless of the UI).
 */
export function StepExerciseSlot({
  language,
  conceptSlug,
  guidance,
  exercise,
  description,
}: {
  language: 'rust'
  conceptSlug: string
  guidance: GenerateStepExerciseInput['guidance']
  exercise: Exercise | null
  description: string
}): React.JSX.Element {
  const router = useRouter()
  const [slotExercise, setSlotExercise] = useState<Exercise | null>(exercise)
  const [isPending, setIsPending] = useState(false)
  const [isFallback, setIsFallback] = useState(false)
  const [error, setError] = useState<string>()

  const label =
    guidance === 'guided' ? 'Guided exercise' : 'Independent exercise'

  async function handleGenerate(): Promise<void> {
    setError(undefined)
    setIsPending(true)
    try {
      const output = await generateStepExerciseFn({
        data: { language, conceptSlug, guidance },
      })
      setIsFallback(output.kind === 'verified-fallback')
      setSlotExercise(output.exercise)
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
    <Card aria-label={`${label} — ${conceptSlug}`}>
      <CardHeader>
        <h2 className="font-display text-2xl font-semibold tracking-tight">
          {label}
        </h2>
        <p className="leading-relaxed text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid justify-items-start gap-2">
          <Button disabled={isPending} onClick={() => void handleGenerate()}>
            {isPending ? 'Generating...' : `Generate ${guidance} exercise`}
          </Button>
          {isPending ? (
            <p className="sr-only" role="status">
              Generating and validating the exercise.
            </p>
          ) : null}
          {error ? <Alert>{error}</Alert> : null}
          {isFallback && slotExercise ? (
            <p className="text-sm leading-relaxed text-muted-foreground">
              Fell back to a previously verified exercise — {slotExercise.title}
              . All {String(MAX_PREFLIGHT_ATTEMPTS)} generation attempts failed
              Pre-Flight, so the stored verified exercise for this concept is
              served as-is.
            </p>
          ) : null}
        </div>
        {slotExercise ? <ExerciseEditor exercise={slotExercise} /> : null}
      </CardContent>
    </Card>
  )
}
