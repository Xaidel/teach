import type { AnalyzeMisconceptionsOutput } from '#/lib/ai/schemas'
// Shared home for the threshold (see src/lib/explanation-accuracy.ts): the
// Learner Model's gate evidence read re-derives "passed" from the payload
// with it, so the constant cannot live in this feature alone.
export { EXPLANATION_ACCURACY_PASS_THRESHOLD } from '#/lib/explanation-accuracy'

/**
 * Per-finding penalty weights of the accuracy formula (issue #16). A claim
 * the explanation gets wrong, or a conflation of distinct concepts, is
 * penalized more heavily than a mere omission: a learner who says the wrong
 * thing (or blurs two concepts together) has actively engaged the material
 * incorrectly, which is a stronger signal than never touching it.
 */
export const INCORRECT_CLAIM_PENALTY = 0.25
export const CONFLATED_PAIR_PENALTY = 0.25

/**
 * The explanation-accuracy score, computed deterministically app-side from
 * `analyzeMisconceptions`' output (issue #23 contract: the model never
 * scores; ticket #16 owns the formula).
 *
 * The formula is a simple average over the concept's required sub-concepts,
 * minus weighted penalties for incorrect and conflated findings:
 *
 *   coverage  = (requiredCount - |missing|) / requiredCount
 *   accuracy  = clamp01(coverage - 0.25 * |incorrect| - 0.25 * |conflated|)
 *
 * where requiredCount = prerequisiteSlugs.length + 1 — the concept's
 * prerequisites (the required sub-concepts the Concept Graph defines, SPEC
 * story 45) plus the concept itself, which any explanation of the concept
 * must engage with. `missing` findings name omitted sub-concepts; one
 * finding lowers coverage by exactly one required sub-concept's share, so a
 * concept with many prerequisites is more forgiving of a single omission
 * than a leaf concept with none.
 *
 * `missing` findings are constrained to the required vocabulary — the
 * concept itself plus its prerequisites — before counting. The model's
 * finding schema leaves `concept` a free string, so an out-of-vocabulary
 * finding (a related concept, a made-up slug) would otherwise silently cost
 * a full `1/requiredCount` of coverage on a deterministic formula the
 * ticket owns; such findings are dropped from the count (the raw analysis
 * still surfaces in the recorded payload and result for display).
 *
 * Every term is a multiple of 0.25 (one finding = one quarter of a
 * sub-concept at minimum), so the result is exactly representable as a
 * binary float — deterministic equality in tests, no rounding needed.
 */
export function computeExplanationAccuracy(input: {
  conceptSlug: string
  prerequisiteSlugs: string[]
  analysis: AnalyzeMisconceptionsOutput
}): number {
  const requiredSlugs = new Set([input.conceptSlug, ...input.prerequisiteSlugs])
  const requiredMissingCount = input.analysis.missing.filter((finding) =>
    requiredSlugs.has(finding.concept),
  ).length

  const requiredCount = input.prerequisiteSlugs.length + 1
  const coverage = Math.max(
    0,
    (requiredCount - requiredMissingCount) / requiredCount,
  )

  const accuracy =
    coverage -
    INCORRECT_CLAIM_PENALTY * input.analysis.incorrect.length -
    CONFLATED_PAIR_PENALTY * input.analysis.conflated.length

  return Math.min(1, Math.max(0, accuracy))
}
