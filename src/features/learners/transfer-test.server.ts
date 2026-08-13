/**
 * Whether the learner has a passed Transfer Test recorded for the concept.
 *
 * The Transfer Test evidence shape is owned by ticket #17 (Transfer
 * Testing); until #17 lands, no TT evidence exists in the schema, so this
 * deterministically returns false. That is what keeps ADR-0015's gate
 * honest while only one half of it is built: a concept must not reach
 * Demonstrated with an EA pass alone. Ticket #17 fills this seam with its
 * own evidence read (making it async) when it lands; nothing in the gate's
 * call sites changes.
 *
 * Its own module, so the ADR-0015 gate's positive branch can be exercised
 * in tests by mocking this seam across the module boundary.
 */
export function hasPassedTransferTest(
  learnerId: string,
  conceptId: string,
): boolean {
  void learnerId
  void conceptId
  return false
}
