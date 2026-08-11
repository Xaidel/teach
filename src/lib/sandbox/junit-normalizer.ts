import { XMLParser } from 'fast-xml-parser'

import type { SandboxResult, SandboxTest, SandboxTestStatus } from './types'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  parseTagValue: false,
})

const TEST_MESSAGE_CAP_BYTES = 16_000
const TEST_OUTPUT_CAP_BYTES = 64_000

type JunitTestcase = {
  '@_name'?: string
  failure?: string | object
  error?: string | object
  skipped?: string | object | null
  'system-out'?: string
}

type JunitTestsuite = {
  testcase?: JunitTestcase | JunitTestcase[]
  'system-out'?: string
}

type JunitRoot = {
  testsuite?: JunitTestsuite | JunitTestsuite[]
  testsuites?: {
    testsuite?: JunitTestsuite | JunitTestsuite[]
  }
}

function textOf(value: string | object): string {
  if (typeof value === 'string') {
    return value
  }
  const inner = value as Record<string, unknown>
  const text = inner['#text']
  if (typeof text === 'string') {
    return text
  }
  const message = inner['@_message']
  if (typeof message === 'string') {
    return message
  }
  return ''
}

function statusOf(testcase: JunitTestcase): SandboxTestStatus {
  if (testcase.error) return 'errored'
  if (testcase.failure) return 'failed'
  if (Object.hasOwn(testcase, 'skipped')) return 'skipped'
  return 'passed'
}

function normalizeTestcase(testcase: JunitTestcase): SandboxTest | null {
  const name = testcase['@_name']?.trim()
  if (!name) return null

  const status = statusOf(testcase)
  const message =
    status === 'failed' && testcase.failure
      ? textOf(testcase.failure)
      : status === 'errored' && testcase.error
        ? textOf(testcase.error)
        : undefined
  const systemOut = testcase['system-out']
  const output = systemOut?.trim()
    ? systemOut.slice(0, TEST_OUTPUT_CAP_BYTES)
    : undefined

  return {
    name,
    status,
    ...(message ? { message: message.slice(0, TEST_MESSAGE_CAP_BYTES) } : {}),
    ...(output ? { output } : {}),
  }
}

/**
 * Normalizes JUnit XML (cargo-nextest's `--junit` output or pytest's
 * `--junit-xml` output — ADR-0011) into the shared Sandbox Result shape.
 * Returns null when the document contains no runnable testcases (for example
 * a build failure that produced no JUnit output).
 */
export function normalizeJunit(xml: string): SandboxResult | null {
  const parsed = parser.parse(xml) as JunitRoot
  const suites = parsed.testsuites?.testsuite ?? parsed.testsuite
  const suiteList = Array.isArray(suites) ? suites : suites ? [suites] : []

  const tests: SandboxTest[] = []
  for (const suite of suiteList) {
    if (!suite.testcase) continue
    const cases = Array.isArray(suite.testcase)
      ? suite.testcase
      : [suite.testcase]
    for (const testcase of cases) {
      const normalized = normalizeTestcase(testcase)
      if (normalized) tests.push(normalized)
    }
  }

  if (tests.length === 0) {
    return null
  }

  const passed = tests.every(
    (test) => test.status === 'passed' || test.status === 'skipped',
  )
  return { passed, tests }
}
