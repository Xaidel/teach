import { useState } from 'react'

import { errorMessage } from './client-utils'
import { startRetrievalReviewFn } from './retrieval.functions'
import type { RetrievalTestView } from './retrieval.schema'

/**
 * The start-a-Refresher-Test state machine shared by the Retrieval Queue
 * card (issue #18's dashboard entry point) and the Daily Review page (its
 * full-page counterpart): clears prior error/result, marks the starting
 * concept, calls the server function, maps failures to a readable message,
 * and clears the starting flag. One hook keeps the two surfaces from
 * drifting into different behaviors.
 *
 * `fallbackMessage` is the copy shown when the failure is not a typed
 * `RetrievalError` (each surface words it for its context).
 */
export function useStartRetrievalReview(fallbackMessage: string): {
  startingId: string | undefined
  isStarting: boolean
  result: RetrievalTestView | undefined
  error: string | undefined
  start: (conceptId: string) => Promise<void>
} {
  const [startingId, setStartingId] = useState<string | undefined>()
  const [result, setResult] = useState<RetrievalTestView>()
  const [error, setError] = useState<string>()

  async function start(conceptId: string): Promise<void> {
    setError(undefined)
    setResult(undefined)
    setStartingId(conceptId)
    try {
      setResult(await startRetrievalReviewFn({ data: { conceptId } }))
    } catch (startError) {
      setError(errorMessage(startError, fallbackMessage))
    } finally {
      setStartingId(undefined)
    }
  }

  return {
    startingId,
    isStarting: startingId !== undefined,
    result,
    error,
    start,
  }
}
