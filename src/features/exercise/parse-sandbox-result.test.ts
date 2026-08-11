import { describe, expect, it } from 'vitest'

import { ExerciseError, parseSandboxResult } from './exercise.schema'

function codeOf(fn: () => unknown): ExerciseError['code'] | undefined {
  try {
    fn()
    return undefined
  } catch (error) {
    return error instanceof ExerciseError ? error.code : undefined
  }
}

describe('parseSandboxResult', () => {
  it('returns the validated result for well-formed sandbox output', () => {
    const result = parseSandboxResult({
      passed: true,
      tests: [{ name: 'handles_zero', status: 'passed' }],
    })

    expect(result).toEqual({
      passed: true,
      tests: [{ name: 'handles_zero', status: 'passed' }],
    })
  })

  it('maps a malformed sandbox result to SANDBOX_RESULT_INVALID', () => {
    expect(
      codeOf(() =>
        parseSandboxResult({
          passed: true,
          tests: [{ name: 'handles_zero', status: 'not-a-status' }],
        }),
      ),
    ).toBe('SANDBOX_RESULT_INVALID')
  })

  it('rejects unknown keys under strict parsing', () => {
    expect(
      codeOf(() =>
        parseSandboxResult({
          passed: true,
          tests: [{ name: 'handles_zero', status: 'passed' }],
          surpriseField: 'unexpected',
        }),
      ),
    ).toBe('SANDBOX_RESULT_INVALID')
  })

  it('rejects unknown keys on a nested test entry', () => {
    expect(
      codeOf(() =>
        parseSandboxResult({
          passed: true,
          tests: [{ name: 'handles_zero', status: 'passed', extra: 1 }],
        }),
      ),
    ).toBe('SANDBOX_RESULT_INVALID')
  })
})
