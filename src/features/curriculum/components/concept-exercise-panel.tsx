import { useEffect, useRef, useState } from 'react'

import { cn } from '#/lib/cn'
import { Alert } from '#/shared/components/ui/alert'
import { Badge } from '#/shared/components/ui/badge'
import { Button } from '#/shared/components/ui/button'
import { CodeField } from '../../exercise/components/code-field'
import type { Exercise, ExerciseGuidance } from '../../exercise/exercise.schema'
import {
  FULL_SOLUTION_LEVEL,
  MAX_MANUAL_HINT_LEVEL,
} from '../../exercise/hint-ladder'
import { useExerciseAttempt } from '../../exercise/use-exercise-attempt'

import { errorMessage } from '../client-utils'
import { generateStepExerciseFn } from '../curriculum.functions'
import type { CurriculumLanguage } from '../curriculum.schema'

type ConceptExercisePanelProps = {
  language: CurriculumLanguage
  conceptSlug: string
  guidance: ExerciseGuidance
  exercise: Exercise | null
  /** Fires once, the moment this exercise's attempt first passes. */
  onPassed: () => void
  /** Fires once this slot's first generation settles, success or failure —
   * or immediately on mount if `exercise` already arrived banked and no
   * generation was needed. The parent step page uses it to know when to
   * drop its full-page loading screen (StepLoadingScreen). Not called again
   * for a later guidance swap (guided → independent), which the page has
   * already revealed by then. */
  onReady?: () => void
}

/**
 * The step page's middle + right columns for one exercise slot
 * (NodeDetail.dc.html): the exercise itself generates automatically on
 * arrival if nothing is banked yet (same pattern as the retired
 * `StepExerciseSlot`), so learners land on a working editor rather than a
 * "Generate exercise" button. Splits its own grid into an editor + console
 * (middle) and tests + hint (right) so the parent page only has to place
 * this component once per active slot.
 */
export function ConceptExercisePanel({
  language,
  conceptSlug,
  guidance,
  exercise,
  onPassed,
  onReady,
}: ConceptExercisePanelProps): React.JSX.Element {
  const [slotExercise, setSlotExercise] = useState<Exercise | null>(exercise)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isFallback, setIsFallback] = useState(false)
  const [generationError, setGenerationError] = useState<string>()
  const hasNotifiedReadyRef = useRef(false)

  function notifyReadyOnce(): void {
    if (!hasNotifiedReadyRef.current) {
      hasNotifiedReadyRef.current = true
      onReady?.()
    }
  }

  async function handleGenerate(): Promise<void> {
    setGenerationError(undefined)
    setIsGenerating(true)
    try {
      const output = await generateStepExerciseFn({
        data: { language, conceptSlug, guidance },
      })
      setIsFallback(output.kind === 'verified-fallback')
      setSlotExercise(output.exercise)
    } catch (error) {
      setGenerationError(
        errorMessage(error, 'The exercise could not be generated. Try again.'),
      )
    } finally {
      setIsGenerating(false)
      notifyReadyOnce()
    }
  }

  useEffect(() => {
    // `exercise` is this slot's banked state as of the page load that
    // mounted it. Mount-only: re-checking on every render would re-fire
    // once the slot fills in.
    if (exercise === null) void handleGenerate()
    else notifyReadyOnce()
  }, [])

  const label =
    guidance === 'guided' ? 'Guided exercise' : 'Independent exercise'

  if (!slotExercise) {
    return (
      <div className="grid min-h-0 flex-1 grid-cols-[1fr_320px] gap-4">
        <div className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
            {label}
          </h2>
          {isGenerating ? (
            <p className="mt-3 text-sm text-muted-foreground" role="status">
              Generating the {guidance} exercise…
            </p>
          ) : null}
          {generationError ? (
            <div className="mt-3 grid gap-2 justify-items-start">
              <Alert>{generationError}</Alert>
              <Button
                disabled={isGenerating}
                onClick={() => void handleGenerate()}
                size="sm"
                type="button"
                variant="outline"
              >
                Try again
              </Button>
            </div>
          ) : null}
        </div>
        <div />
      </div>
    )
  }

  return (
    <ActiveExercisePanel
      exercise={slotExercise}
      isFallback={isFallback}
      label={label}
      onPassed={onPassed}
    />
  )
}

/** Only mounted once a slot's exercise exists, so `useExerciseAttempt`'s
 * hook rules stay simple — one exercise per mount, never conditional. */
function ActiveExercisePanel({
  exercise,
  label,
  isFallback,
  onPassed,
}: {
  exercise: Exercise
  label: string
  isFallback: boolean
  onPassed: () => void
}): React.JSX.Element {
  const attempt = useExerciseAttempt(exercise)
  const codeInputId = `concept-exercise-code-${exercise.slug}`
  const codeErrorId = `concept-exercise-code-error-${exercise.slug}`
  const passed = attempt.outcome?.result.passed ?? false

  useEffect(() => {
    if (passed) onPassed()
    // Fires once per transition into "passed" — `passed` is a primitive,
    // so a later re-submission that stays passed doesn't re-trigger it.
  }, [passed])

  const failedCount = attempt.outcome
    ? attempt.outcome.result.tests.filter(
        (test) => test.status === 'failed' || test.status === 'errored',
      ).length
    : 0
  const testCount = attempt.outcome?.result.tests.length ?? 0
  const hint = attempt.outcome?.hint ?? null
  const nextLevel = hint ? hint.level + 1 : 0
  const canRequestNextHint =
    !!attempt.outcome && !passed && nextLevel <= MAX_MANUAL_HINT_LEVEL
  const canRequestFullSolution =
    !!attempt.outcome && !passed && hint?.level === MAX_MANUAL_HINT_LEVEL

  async function handleSubmit(
    event: React.SyntheticEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault()
    await attempt.submit()
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[1fr_320px] gap-4">
      <form
        aria-busy={attempt.isPending || attempt.isHintPending}
        className="flex min-h-0 flex-col gap-3 rounded-2xl border border-border bg-card p-6"
        data-slot="concept-exercise-panel"
        onSubmit={handleSubmit}
      >
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
            {label}
          </h2>
          {isFallback ? (
            <Badge className="border-border bg-background text-muted-foreground">
              verified fallback
            </Badge>
          ) : null}
        </div>
        <h3 className="font-display text-xl font-semibold text-foreground">
          {exercise.title}
        </h3>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {exercise.prompt}
        </p>
        <label className="sr-only" htmlFor={codeInputId}>
          Your solution
        </label>
        <CodeField
          describedBy={attempt.error ? codeErrorId : undefined}
          disabled={attempt.isPending || attempt.isHintPending}
          id={codeInputId}
          language={exercise.language}
          onChange={attempt.setCode}
          value={attempt.code}
        />
        {attempt.error ? <Alert id={codeErrorId}>{attempt.error}</Alert> : null}
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Runs {exercise.language}&apos;s real test toolchain in an isolated,
            network-disabled container.
          </p>
          <Button
            disabled={attempt.isPending || attempt.isHintPending}
            type="submit"
          >
            {attempt.isPending ? 'Evaluating...' : 'Submit for evaluation'}
          </Button>
        </div>
        <div
          className={cn(
            'rounded-xl border px-4 py-3 text-sm font-semibold',
            !attempt.outcome
              ? 'border-border bg-background text-muted-foreground'
              : passed
                ? 'border-primary/30 bg-primary/10 text-primary'
                : 'border-destructive/30 bg-destructive/8 text-destructive',
          )}
        >
          {!attempt.outcome
            ? 'Submit your code to run the test cases.'
            : passed
              ? `Passed — all ${String(testCount)} test${testCount === 1 ? '' : 's'} ran successfully.`
              : `Failed — ${String(failedCount)} of ${String(testCount)} test${testCount === 1 ? '' : 's'} did not pass.`}
        </div>
        {attempt.outcome?.result.message && !hint ? (
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-background p-3 font-mono text-xs leading-relaxed text-foreground">
            {attempt.outcome.result.message}
          </pre>
        ) : null}
      </form>

      <div className="flex min-h-0 flex-col gap-4">
        <div className="rounded-2xl border border-border bg-card p-4">
          <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
            Tests
          </h2>
          {attempt.outcome && attempt.outcome.result.tests.length > 0 ? (
            <ul className="mt-3 divide-y divide-border">
              {attempt.outcome.result.tests.map((test) => (
                <li
                  className="flex items-center justify-between gap-3 py-2"
                  key={test.name}
                >
                  <span className="truncate font-mono text-xs text-foreground">
                    {test.name}
                  </span>
                  <Badge
                    className={
                      test.status === 'passed'
                        ? 'border-primary/30 bg-primary/10 text-primary'
                        : test.status === 'skipped'
                          ? undefined
                          : 'border-destructive/30 bg-destructive/10 text-destructive'
                    }
                  >
                    {test.status}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : exercise.sampleTests && exercise.sampleTests.length > 0 ? (
            <ul className="mt-3 divide-y divide-border">
              {exercise.sampleTests.map((sample, index) => (
                <li className="py-2" key={index}>
                  <p className="text-[10px] uppercase tracking-[0.05em] text-muted-foreground">
                    Input → Expected
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-foreground">
                    {sample.input} → {sample.expected}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              Submit your code to see test results.
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-4">
          <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">
            Hint
          </h2>
          {attempt.hintsDisabled ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Independent exercise — hints are disabled for this step.
            </p>
          ) : hint ? (
            <div className="mt-3 grid gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                Level {hint.level}
              </p>
              <p className="text-sm leading-relaxed text-foreground">
                {hint.content}
              </p>
              {canRequestNextHint || canRequestFullSolution ? (
                <div className="flex flex-wrap gap-2">
                  {canRequestNextHint ? (
                    <Button
                      disabled={attempt.isHintPending}
                      onClick={() => void attempt.requestHint('next')}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {attempt.isHintPending
                        ? 'Requesting...'
                        : `Request Level ${String(nextLevel)}`}
                    </Button>
                  ) : null}
                  {canRequestFullSolution ? (
                    <Button
                      disabled={attempt.isHintPending}
                      onClick={() => void attempt.requestHint('full_solution')}
                      size="sm"
                      type="button"
                    >
                      Show full solution · Level {String(FULL_SOLUTION_LEVEL)}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : attempt.outcome && !passed ? (
            <Button
              className="mt-3"
              disabled={attempt.isHintPending}
              onClick={() => void attempt.requestHint('next')}
              size="sm"
              type="button"
              variant="outline"
            >
              {attempt.isHintPending ? 'Requesting...' : 'Get a hint'}
            </Button>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              Submit your code to unlock hints.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
