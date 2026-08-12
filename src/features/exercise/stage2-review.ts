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

  const blocking = criteria.some(
    (criterion) =>
      criterion.kind !== 'advisory' && criterion.verdict === 'violated',
  )

  return {
    passed: !blocking,
    refactorRequest: blocking ? output.overall : null,
    criteria,
  }
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
