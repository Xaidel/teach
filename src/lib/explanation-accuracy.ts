/**
 * The pass threshold of an Explanation Assessment's accuracy score (issue
 * #16, SPEC stories 44-45, ADR-0015).
 *
 * Single source of truth for the value because two features consume it: the
 * explanation-assessment feature computes it into the pass verdict, and the
 * Learner Model's evidence read (`getPassedExplanationAssessmentConceptIds`)
 * re-derives "passed" from the recorded `explanation_assessment` payload —
 * never from the attempt's `outcome` column, which is NULL for explain-mode
 * attempts (no Stage 1 sandbox verdict, ADR-0010/ADR-0021). One constant,
 * one coordinated edit if the bar ever changes.
 *
 * Lives in `src/lib` per the dependency rules' shared-constant precedent
 * (`explanation-depth.ts`, `hint-levels.ts`): the threshold has no single
 * feature owner, and `learners` must not import from `explanation-assessment`
 * (one-way dependency).
 */
export const EXPLANATION_ACCURACY_PASS_THRESHOLD = 0.7
