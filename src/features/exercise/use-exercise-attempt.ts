import { useState } from 'react'

import { requestHintFn, submitExerciseFn } from './exercise.functions'
import type {
  Exercise,
  HintRequestAction,
  SubmitExerciseOutput,
} from './exercise.schema'

/** One exercise's submit/hint state and actions — the code being edited,
 * the last evaluation outcome, and the Socratic hint escalation. Shared by
 * every surface that lets a learner attempt an exercise (`ExerciseEditor`
 * for `/practice`'s flat list, `ConceptExercisePanel` for a Class A step)
 * so the submission/hint logic itself lives in exactly one place. */
export type ExerciseAttempt = {
  code: string
  setCode: (code: string) => void
  outcome: SubmitExerciseOutput | undefined
  error: string | undefined
  isPending: boolean
  isHintPending: boolean
  /** An independent exercise (issue #14's curriculum step) is solved
   * without Socratic scaffolding: the server rejects hint requests for it
   * regardless of the UI, so callers gate the hint affordance on this. */
  hintsDisabled: boolean
  submit: () => Promise<void>
  requestHint: (action: HintRequestAction) => Promise<void>
}

/** Drives one exercise attempt: code editing, sandboxed submission, and
 * hint escalation against the persisted attempt. */
export function useExerciseAttempt(exercise: Exercise): ExerciseAttempt {
  const [code, setCode] = useState(exercise.starterCode)
  const [outcome, setOutcome] = useState<SubmitExerciseOutput>()
  const [error, setError] = useState<string>()
  const [isPending, setIsPending] = useState(false)
  const [isHintPending, setIsHintPending] = useState(false)
  const hintsDisabled = exercise.guidance === 'independent'

  async function submit(): Promise<void> {
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

  async function requestHint(action: HintRequestAction): Promise<void> {
    if (!outcome) return

    setError(undefined)
    setIsHintPending(true)
    try {
      const response = await requestHintFn({
        data: { attemptId: outcome.attemptId, action },
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

  return {
    code,
    setCode,
    outcome,
    error,
    isPending,
    isHintPending,
    hintsDisabled,
    submit,
    requestHint,
  }
}
