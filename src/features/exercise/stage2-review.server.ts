import { TeacherEngineError } from '#/lib/ai/client.server'
import type {
  CriterionVerdict,
  EvaluationRubric,
  ReviewSubmissionOutput,
} from '#/lib/ai/schemas'

import type { Stage2Review, Stage2ReviewCriterion } from './exercise.schema'

/**
 * Derives the app-side Stage 2 review from the AI Teacher Engine's
 * per-criterion verdicts. The model output's arrays mirror the rubric's
 * lists entry-for-entry (see ReviewSubmissionOutputSchema); a missing,
 * extra, or reworded entry is invalid model output. Pass/fail is derived
 * here, deterministically: only `required` and `prohibited` violations
 * block progress (PRD §18); `advisory` verdicts are carried through but
 * never block.
 *
 * The refactor request is composed app-side from the violated criteria —
 * the model never writes the blocking headline, so it can never contradict
 * the deterministic verdict (SPEC story 28).
 */
export function buildStage2Review(
  rubric: EvaluationRubric,
  output: ReviewSubmissionOutput,
): Stage2Review {
  const criteria: Stage2ReviewCriterion[] = [
    ...attachKind(rubric.required, output.required, 'required'),
    ...attachKind(rubric.prohibited, output.prohibited, 'prohibited'),
    ...attachKind(rubric.advisory, output.advisory, 'advisory'),
  ]

  const blocking = criteria.filter(
    (criterion) =>
      criterion.kind !== 'advisory' && criterion.verdict === 'violated',
  )

  return {
    passed: blocking.length === 0,
    refactorRequest:
      blocking.length > 0 ? buildRefactorRequest(blocking) : null,
    criteria,
  }
}

/** One deterministic refactor-request headline naming the violated criteria. */
function buildRefactorRequest(violated: Stage2ReviewCriterion[]): string {
  const findings = violated
    .map((criterion) => `"${criterion.criterion}" — ${criterion.explanation}`)
    .join(' ')
  return `Refactor the submission to address: ${findings}`
}

/**
 * Attaches the rubric kind to one output array, verifying it mirrors the
 * rubric's list entry-for-entry — same length, same criterion texts in the
 * same order. Anything else is invalid model output.
 */
function attachKind(
  rubricEntries: string[],
  verdicts: CriterionVerdict[],
  kind: 'required' | 'prohibited' | 'advisory',
): Stage2ReviewCriterion[] {
  if (verdicts.length !== rubricEntries.length) {
    throw new TeacherEngineError(
      'invalid_output',
      `The AI Teacher Engine returned ${String(verdicts.length)} ${kind} verdicts for ${String(rubricEntries.length)} ${kind} rubric criteria.`,
    )
  }

  return verdicts.map((verdict, index) => {
    const rubricEntry = rubricEntries[index]
    if (rubricEntry === undefined || verdict.criterion !== rubricEntry) {
      throw new TeacherEngineError(
        'invalid_output',
        `The AI Teacher Engine reworded or reordered the ${kind} rubric criterion "${rubricEntry ?? '(missing)'}".`,
      )
    }
    return { ...verdict, kind }
  })
}
