/**
 * Maps an unknown error from the retrieval feature's server surface to a
 * readable message (mirrors the other features' client-utils helpers):
 * surfaces the typed error message when one exists, else the fallback.
 */
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return fallback
}
