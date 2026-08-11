import { describe, expect, it } from 'vitest'

import { normalizeGoTestJson } from './go-test-normalizer'
import type { SandboxResult } from './types'

function normalize(stream: string): SandboxResult {
  const result = normalizeGoTestJson(stream)
  if (!result) throw new Error('expected a normalized result')
  return result
}

const PASSING_STREAM = `{"Time":"2026-08-11T10:00:00Z","Action":"start","Package":"exercise"}
{"Time":"2026-08-11T10:00:00Z","Action":"run","Package":"exercise","Test":"TestIsEvenEvenNumbers"}
{"Time":"2026-08-11T10:00:00Z","Action":"output","Package":"exercise","Test":"TestIsEvenEvenNumbers","Output":"=== RUN   TestIsEvenEvenNumbers\\n"}
{"Time":"2026-08-11T10:00:00Z","Action":"pass","Package":"exercise","Test":"TestIsEvenEvenNumbers","Elapsed":0.001}
{"Time":"2026-08-11T10:00:00Z","Action":"run","Package":"exercise","Test":"TestIsEvenZero"}
{"Time":"2026-08-11T10:00:00Z","Action":"pass","Package":"exercise","Test":"TestIsEvenZero","Elapsed":0.001}
{"Time":"2026-08-11T10:00:00Z","Action":"pass","Package":"exercise","Elapsed":0.002}
`

const FAILING_STREAM = `{"Time":"2026-08-11T10:00:00Z","Action":"run","Package":"exercise","Test":"TestIsEvenOddNumbers"}
{"Time":"2026-08-11T10:00:00Z","Action":"output","Package":"exercise","Test":"TestIsEvenOddNumbers","Output":"--- FAIL: TestIsEvenOddNumbers (0.00s)\\n"}
{"Time":"2026-08-11T10:00:00Z","Action":"output","Package":"exercise","Test":"TestIsEvenOddNumbers","Output":"    exercise_test.go:11: 7 is odd\\n"}
{"Time":"2026-08-11T10:00:00Z","Action":"fail","Package":"exercise","Test":"TestIsEvenOddNumbers"}
{"Time":"2026-08-11T10:00:00Z","Action":"output","Package":"exercise","Output":"FAIL\\n"}
{"Time":"2026-08-11T10:00:00Z","Action":"fail","Package":"exercise"}
`

const SKIPPED_STREAM = `{"Time":"2026-08-11T10:00:00Z","Action":"run","Package":"exercise","Test":"TestSkipped"}
{"Time":"2026-08-11T10:00:00Z","Action":"output","Package":"exercise","Test":"TestSkipped","Output":"=== SKIP\\n"}
{"Time":"2026-08-11T10:00:00Z","Action":"skip","Package":"exercise","Test":"TestSkipped"}
{"Time":"2026-08-11T10:00:00Z","Action":"pass","Package":"exercise"}
`

const BUILD_FAILURE_STREAM = `{"Time":"2026-08-11T10:00:00Z","Action":"start","Package":"exercise"}
{"ImportPath":"exercise","Action":"build-output","Output":"# exercise\\n"}
{"ImportPath":"exercise","Action":"build-output","Output":"./exercise.go:3:1: syntax error: unexpected EOF\\n"}
{"ImportPath":"exercise","Action":"build-fail"}
{"Time":"2026-08-11T10:00:00Z","Action":"output","Package":"exercise","Output":"FAIL\\texercise [build failed]\\n"}
{"Time":"2026-08-11T10:00:00Z","Action":"fail","Package":"exercise"}
`

describe('normalizeGoTestJson', () => {
  it('normalizes a passing run to passed with all tests passing', () => {
    const result = normalize(PASSING_STREAM)

    expect(result.passed).toBe(true)
    expect(result.tests.map((test) => test.name).sort()).toEqual(
      ['TestIsEvenEvenNumbers', 'TestIsEvenZero'].sort(),
    )
    expect(result.tests.every((test) => test.status === 'passed')).toBe(true)
  })

  it('marks the result failed when any test fails and carries the failure output', () => {
    const result = normalize(FAILING_STREAM)

    expect(result.passed).toBe(false)
    expect(result.tests).toHaveLength(1)
    expect(result.tests[0]).toMatchObject({
      name: 'TestIsEvenOddNumbers',
      status: 'failed',
    })
    expect(result.tests[0]?.message).toContain('exercise_test.go:11: 7 is odd')
    expect(result.tests[0]?.output).toContain('--- FAIL: TestIsEvenOddNumbers')
  })

  it('counts skipped tests as non-failing', () => {
    const result = normalize(SKIPPED_STREAM)

    expect(result.passed).toBe(true)
    expect(result.tests[0]).toMatchObject({ status: 'skipped' })
  })

  it('returns a decoded message for a build failure with no test-scoped events', () => {
    const result = normalizeGoTestJson(BUILD_FAILURE_STREAM)

    expect(result).not.toBeNull()
    expect(result?.passed).toBe(false)
    expect(result?.tests).toEqual([])
    expect(result?.message).toContain('# exercise')
    expect(result?.message).toContain('./exercise.go:3:1: syntax error')
  })

  it('returns null for empty or non-JSON input', () => {
    expect(normalizeGoTestJson('')).toBeNull()
    expect(normalizeGoTestJson('not json\nat all\n')).toBeNull()
  })
})
