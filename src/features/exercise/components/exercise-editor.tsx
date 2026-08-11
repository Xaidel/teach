import { useState } from 'react'

import { Alert } from '#/shared/components/ui/alert'
import { Button } from '#/shared/components/ui/button'
import { Label } from '#/shared/components/ui/label'
import { Textarea } from '#/shared/components/ui/textarea'

import { requestHintFn, submitExerciseFn } from '../exercise.functions'
import type {
  Exercise,
  HintRequestAction,
  SubmitExerciseOutput,
} from '../exercise.schema'
import { ResultPanel } from './result-panel'

/** Renders the code editor and submit flow for one exercise. */
export function ExerciseEditor({
  exercise,
}: {
  exercise: Exercise
}): React.JSX.Element {
  const [code, setCode] = useState(exercise.starterCode)
  const [outcome, setOutcome] = useState<SubmitExerciseOutput>()
  const [error, setError] = useState<string>()
  const [isPending, setIsPending] = useState(false)
  const [isHintPending, setIsHintPending] = useState(false)
  const codeInputId = `exercise-code-${exercise.slug}`
  const codeErrorId = `exercise-code-error-${exercise.slug}`

  async function handleSubmit(
    event: React.SyntheticEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault()
    setError(undefined)
    setOutcome(undefined)
    setIsHintPending(false)
    setIsPending(true)
    try {
      setOutcome(
        await submitExerciseFn({ data: { exerciseId: exercise.id, code } }),
      )
    } catch {
      setError('The submission could not be evaluated. Try again.')
    } finally {
      setIsPending(false)
    }
  }

  async function handleHintRequest(action: HintRequestAction): Promise<void> {
    if (!outcome) return

    setError(undefined)
    setIsHintPending(true)
    try {
      const response = await requestHintFn({
        data: { submissionId: outcome.submissionId, action },
      })
      setOutcome((current) =>
        current ? { ...current, hint: response.hint } : current,
      )
    } catch {
      setError('The requested hint could not be generated. Try again.')
    } finally {
      setIsHintPending(false)
    }
  }

  return (
    <form
      aria-busy={isPending || isHintPending}
      className="grid gap-5"
      data-slot="exercise-editor"
      onSubmit={handleSubmit}
    >
      <div className="grid gap-2">
        <Label htmlFor={codeInputId}>Your solution</Label>
        <Textarea
          aria-describedby={error ? codeErrorId : undefined}
          className="min-h-64 font-mono text-xs leading-relaxed"
          disabled={isPending || isHintPending}
          id={codeInputId}
          name="code"
          onChange={(event) => setCode(event.target.value)}
          spellCheck={false}
          value={code}
        />
      </div>
      {error ? <Alert id={codeErrorId}>{error}</Alert> : null}
      {isPending ? (
        <p className="sr-only" role="status">
          Evaluating submission in the sandbox.
        </p>
      ) : null}
      {isHintPending ? (
        <p className="sr-only" role="status">
          Generating the requested hint.
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          Runs {exercise.language}&apos;s real test toolchain in an isolated,
          network-disabled container with a 10-second limit.
        </p>
        <Button disabled={isPending || isHintPending} type="submit">
          {isPending ? 'Evaluating...' : 'Submit for evaluation'}
        </Button>
      </div>
      {outcome ? (
        <ResultPanel
          hint={outcome.hint}
          isHintPending={isHintPending}
          onRequestHint={handleHintRequest}
          result={outcome.result}
        />
      ) : null}
    </form>
  )
}
