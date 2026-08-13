/**
 * Whether the learner has a passed Transfer Test recorded for the concept.
 *
 * The Transfer Test evidence shape is owned by ticket #17 (Transfer
 * Testing); until #17 lands, no TT evidence exists in the schema, so this
 * deterministically returns false. That is what keeps ADR-0015's gate
 * honest while only one half of it is built: a concept must not reach
 * Demonstrated with an EA pass alone. Ticket #17 fills this seam with its
 * own evidence read when it lands; making that read async then requires
 * `await` at the seam's call site (`promoteToDemonstrated` in
 * mastery.server.ts) and a resolved promise from its mock
 * (mastery.server.test.ts).
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
