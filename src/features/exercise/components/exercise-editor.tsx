import { Alert } from '#/shared/components/ui/alert'
import { Button } from '#/shared/components/ui/button'
import { Label } from '#/shared/components/ui/label'

import type { Exercise, HintRequestAction } from '../exercise.schema'
import { useExerciseAttempt } from '../use-exercise-attempt'
import { CodeField } from './code-field'
import { ResultPanel } from './result-panel'

/** Renders the code editor and submit flow for one exercise. */
export function ExerciseEditor({
  exercise,
}: {
  exercise: Exercise
}): React.JSX.Element {
  const attempt = useExerciseAttempt(exercise)
  const codeInputId = `exercise-code-${exercise.slug}`
  const codeErrorId = `exercise-code-error-${exercise.slug}`

  async function handleSubmit(
    event: React.SyntheticEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault()
    await attempt.submit()
  }

  return (
    <form
      aria-busy={attempt.isPending || attempt.isHintPending}
      className="grid gap-5"
      data-slot="exercise-editor"
      onSubmit={handleSubmit}
    >
      <div className="grid gap-2">
        <Label htmlFor={codeInputId}>Your solution</Label>
        <CodeField
          describedBy={attempt.error ? codeErrorId : undefined}
          disabled={attempt.isPending || attempt.isHintPending}
          id={codeInputId}
          language={exercise.language}
          onChange={attempt.setCode}
          value={attempt.code}
        />
      </div>
      {attempt.error ? <Alert id={codeErrorId}>{attempt.error}</Alert> : null}
      {attempt.isPending ? (
        <p className="sr-only" role="status">
          Evaluating submission in the sandbox.
        </p>
      ) : null}
      {attempt.isHintPending ? (
        <p className="sr-only" role="status">
          Generating the requested hint.
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          Runs {exercise.language}&apos;s real test toolchain in an isolated,
          network-disabled container with a 10-second limit.
        </p>
        <Button
          disabled={attempt.isPending || attempt.isHintPending}
          type="submit"
        >
          {attempt.isPending ? 'Evaluating...' : 'Submit for evaluation'}
        </Button>
      </div>
      {attempt.outcome ? (
        <ResultPanel
          hint={attempt.outcome.hint}
          isHintPending={attempt.isHintPending}
          {...(attempt.hintsDisabled
            ? {}
            : {
                onRequestHint: (action: HintRequestAction) =>
                  void attempt.requestHint(action),
              })}
          result={attempt.outcome.result}
          stage2Review={attempt.outcome.stage2Review}
        />
      ) : null}
      {attempt.hintsDisabled ? (
        <p className="text-xs text-muted-foreground">
          Independent exercise — hints are disabled for this step.
        </p>
      ) : null}
    </form>
  )
}
