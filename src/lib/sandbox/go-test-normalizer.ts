import type { SandboxResult, SandboxTest, SandboxTestStatus } from './types'
import { SANDBOX_TEST_MESSAGE_CAP_BYTES, SANDBOX_TEST_OUTPUT_CAP_BYTES } from './types'

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
  const output = trimmed?.slice(-SANDBOX_TEST_OUTPUT_CAP_BYTES)
  const message =
    acc.status === 'failed' && output
      ? output.slice(-SANDBOX_TEST_MESSAGE_CAP_BYTES)
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
 * (ADR-0011). Package-scope `output` events are accumulated so a build
 * failure surfaces as a decoded result message (`tests: []`, `passed:
 * false`) rather than the raw JSON stream. Returns null only when the stream
 * carries neither test-scoped events nor package output.
 */
export function normalizeGoTestJson(stream: string): SandboxResult | null {
  const tests = new Map<string, GoTestAccumulator>()
  let packageFailed = false
  let packageOutput = ''

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
    } else if (
      (event.Action === 'output' || event.Action === 'build-output') &&
      typeof event.Output === 'string'
    ) {
      // Package-scope streamed text: build failures arrive either as the
      // classic `output` events or Go 1.21+'s `build-output` events.
      packageOutput += event.Output
    } else if (event.Action === 'fail' || event.Action === 'build-fail') {
      packageFailed = true
    }
  }

  if (tests.size === 0) {
    const message = packageOutput.trim()
    if (!message) return null
    return {
      passed: false,
      tests: [],
      message: message.slice(-SANDBOX_TEST_MESSAGE_CAP_BYTES),
    }
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
