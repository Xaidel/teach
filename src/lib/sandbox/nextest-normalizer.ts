import { normalizeJunit } from './junit-normalizer'
import type { SandboxResult } from './types'

/**
 * Normalizes cargo-nextest JUnit XML into the shared Sandbox Result shape
 * (ADR-0011: one per-language normalizer over that language's native
 * structured test output). cargo-nextest and pytest both emit the JUnit wire
 * format, so they share the parser in junit-normalizer.
 */
export function normalizeNextestJunit(xml: string): SandboxResult | null {
  return normalizeJunit(xml)
}
