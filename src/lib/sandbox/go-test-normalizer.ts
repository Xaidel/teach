import type { SandboxResult, SandboxTest, SandboxTestStatus } from './types'

const TEST_MESSAGE_CAP_BYTES = 16_000
const TEST_OUTPUT_CAP_BYTES = 64_000

/**
 * One line of `go test -json` output (ADR-0011: Go's native structured test
 * output). Actions: `run`/`pass`/`fail`/`skip` at test scope, `start`/
 * `pass`/`fail` at package scope, `output` carrying streamed text.
 */
type GoTestEvent = {
  Action: string
  Test?: string
  Package?: string
  Output?: string
}

type GoTestAccumulator = {
  status: SandboxTestStatus
  message?: string
  output?: string
}

function applyOutput(acc: GoTestAccumulator, output: string): void {
  acc.output = `${acc.output ?? ''}${output}`
}

function applyTerminal(acc: GoTestAccumulator, action: string): void {
  if (action === 'pass') acc.status = 'passed'
  else if (action === 'fail') acc.status = 'failed'
  else if (action === 'skip') acc.status = 'skipped'
}

function toSandboxTest(name: string, acc: GoTestAccumulator): SandboxTest {
  const trimmed = acc.output?.trim()
  const output = trimmed?.slice(-TEST_OUTPUT_CAP_BYTES)
  const message =
    (acc.status === 'failed' || acc.status === 'errored') && output
      ? output.slice(-TEST_MESSAGE_CAP_BYTES)
      : undefined

  return {
    name,
    status: acc.status,
    ...(message ? { message } : {}),
    ...(output ? { output } : {}),
  }
}

/**
 * Normalizes `go test -json` output into the shared Sandbox Result shape
 * (ADR-0011). Returns null when the stream contains no test-scoped events —
 * for example a package build failure, whose compile errors the caller
 * surfaces as the result message instead.
 */
export function normalizeGoTestJson(stream: string): SandboxResult | null {
  const tests = new Map<string, GoTestAccumulator>()
  let packageFailed = false

  for (const line of stream.split('\n')) {
    if (!line.trim()) continue
    let event: GoTestEvent
    try {
      event = JSON.parse(line) as GoTestEvent
    } catch {
      continue
    }
    if (typeof event.Action !== 'string') continue

    if (event.Test) {
      let acc = tests.get(event.Test)
      if (!acc) {
        acc = { status: 'passed' }
        tests.set(event.Test, acc)
      }
      if (event.Action === 'output' && typeof event.Output === 'string') {
        applyOutput(acc, event.Output)
      } else {
        applyTerminal(acc, event.Action)
      }
    } else if (event.Action === 'fail') {
      packageFailed = true
    }
  }

  if (tests.size === 0) {
    return null
  }

  const normalized = [...tests.entries()].map(([name, acc]) =>
    toSandboxTest(name, acc),
  )

  const passed =
    !packageFailed &&
    normalized.every(
      (test) => test.status === 'passed' || test.status === 'skipped',
    )

  return { passed, tests: normalized }
}
