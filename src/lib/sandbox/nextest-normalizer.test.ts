import { describe, expect, it } from 'vitest'

import { normalizeNextestJunit } from './nextest-normalizer'
import type { SandboxResult } from './types'

function normalize(xml: string): SandboxResult {
  const result = normalizeNextestJunit(xml)
  if (!result) throw new Error('expected a normalized result')
  return result
}

const PASSING_JUNIT = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="cargo nextest" tests="2" failures="0" errors="0" skipped="0">
  <testsuite name="exercise" tests="2" failures="0" errors="0" skipped="0">
    <testcase name="returns_true_for_even_numbers" classname="exercise::tests" time="0.001"/>
    <testcase name="handles_zero" classname="exercise::tests" time="0.001"/>
  </testsuite>
</testsuites>
`

const FAILING_JUNIT = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="cargo nextest" tests="2" failures="1" errors="0" skipped="1">
  <testsuite name="exercise" tests="2" failures="1" errors="0" skipped="1">
    <testcase name="returns_true_for_even_numbers" classname="exercise::tests" time="0.001">
      <failure type="assertion">assertion failed: exercise::is_even(4)</failure>
    </testcase>
    <testcase name="skipped_case" classname="exercise::tests" time="0.001">
      <skipped/>
    </testcase>
  </testsuite>
</testsuites>
`

const ERRORING_JUNIT = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="cargo nextest" tests="1" failures="0" errors="1" skipped="0">
  <testsuite name="exercise" tests="1" failures="0" errors="1" skipped="0">
    <testcase name="panics_at_runtime" classname="exercise::tests" time="0.002">
      <error type="panic">thread 'main' panicked at src/lib.rs:4:5</error>
    </testcase>
  </testsuite>
</testsuites>
`

describe('normalizeNextestJunit', () => {
  it('normalizes a passing run to passed with all tests passing', () => {
    const result = normalize(PASSING_JUNIT)

    expect(result).toEqual({
      passed: true,
      tests: [
        { name: 'returns_true_for_even_numbers', status: 'passed' },
        { name: 'handles_zero', status: 'passed' },
      ],
    })
  })

  it('marks the result failed when any test fails', () => {
    const result = normalize(FAILING_JUNIT)

    expect(result.passed).toBe(false)
    expect(result.tests).toHaveLength(2)
    expect(result.tests[0]).toMatchObject({
      name: 'returns_true_for_even_numbers',
      status: 'failed',
    })
    expect(result.tests[0]?.message).toContain('assertion failed')
    expect(result.tests[1]).toMatchObject({ status: 'skipped' })
  })

  it('distinguishes errored tests from failures', () => {
    const result = normalize(ERRORING_JUNIT)

    expect(result.passed).toBe(false)
    expect(result.tests[0]).toMatchObject({
      name: 'panics_at_runtime',
      status: 'errored',
    })
  })

  it('returns null for a document with no testcases', () => {
    expect(
      normalizeNextestJunit('<testsuites name="cargo nextest"></testsuites>'),
    ).toBeNull()
  })

  it('returns null for non-XML input', () => {
    expect(normalizeNextestJunit('not xml at all')).toBeNull()
  })
})
