/** Status of one normalized test entry. */
export type SandboxTestStatus = 'passed' | 'failed' | 'skipped' | 'errored'

/** One normalized test entry in a Sandbox Result (CONTEXT.md — Sandbox Result). */
export type SandboxTest = {
  name: string
  status: SandboxTestStatus
  message?: string
  output?: string
}

/**
 * The normalized, language-independent pass/fail + diagnostics shape a
 * Sandbox run produces (CONTEXT.md — Sandbox Result).
 */
export type SandboxResult = {
  passed: boolean
  tests: SandboxTest[]
  /** Result-level message, e.g. a compile failure or timeout. */
  message?: string
}

/** The pinned per-language sandbox image (ADR-0011). */
export const RUST_SANDBOX_IMAGE = 'teach-sandbox-rust:v1'

/** Fixed execution window per PRD 5.1 / ADR-0005. */
export const SANDBOX_EXECUTION_TIMEOUT_MS = 10_000

/** Output cap per PRD 5.1 / ADR-0005. */
export const SANDBOX_OUTPUT_CAP_BYTES = 1024 * 1024

/** Memory limit per PRD 5.1 / ADR-0005. */
export const SANDBOX_MEMORY_BYTES = 512 * 1024 * 1024

/** CPU limit per PRD 5.1 / ADR-0005. */
export const SANDBOX_NANOCPUS = 1_000_000_000

/** PID limit per PRD 5.1 / ADR-0005. */
export const SANDBOX_PIDS_LIMIT = 64
