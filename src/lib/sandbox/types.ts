import { z } from 'zod'

/** Status of one normalized test entry (CONTEXT.md — Sandbox Result). */
export const SandboxTestStatusSchema = z.enum([
  'passed',
  'failed',
  'skipped',
  'errored',
])

export type SandboxTestStatus = z.infer<typeof SandboxTestStatusSchema>

/** One normalized test entry in a Sandbox Result (CONTEXT.md — Sandbox Result). */
export const SandboxTestSchema = z
  .object({
    name: z.string(),
    status: SandboxTestStatusSchema,
    message: z.string().optional(),
    output: z.string().optional(),
  })
  .strict()

export type SandboxTest = z.infer<typeof SandboxTestSchema>

/**
 * The normalized, language-independent pass/fail + diagnostics shape a
 * Sandbox run produces (CONTEXT.md — Sandbox Result). The single
 * authoritative definition of the shape; validated at runtime where
 * sandbox output enters persistence. Parsed strictly: sandbox output is
 * untrusted input, so unknown keys fail loudly instead of being stripped.
 */
export const SandboxResultSchema = z
  .object({
    passed: z.boolean(),
    tests: z.array(SandboxTestSchema),
    message: z.string().optional(),
  })
  .strict()

export type SandboxResult = z.infer<typeof SandboxResultSchema>

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
