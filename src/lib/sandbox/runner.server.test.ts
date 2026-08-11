import Docker from 'dockerode'
import { describe, expect, it } from 'vitest'

import {
  buildSandboxHostConfig,
  runSandboxSubmission,
} from './runner.server'
import {
  GO_SANDBOX_IMAGE,
  PYTHON_SANDBOX_IMAGE,
  RUST_SANDBOX_IMAGE,
  SANDBOX_EXECUTION_TIMEOUT_MS,
  SANDBOX_MEMORY_BYTES,
  SANDBOX_NANOCPUS,
  SANDBOX_OUTPUT_CAP_BYTES,
  SANDBOX_PIDS_LIMIT,
} from './types'

async function dockerAvailable(): Promise<boolean> {
  try {
    await new Docker().ping()
    return true
  } catch {
    return false
  }
}

const RUST_PASSING_CODE = `pub fn is_even(n: u32) -> bool {
    n % 2 == 0
}
`

const RUST_FAILING_CODE = `pub fn is_even(n: u32) -> bool {
    n % 2 == 1
}
`

const RUST_COMPILE_ERROR_CODE = `pub fn is_even(n: u32) -> bool {
`

const RUST_SPINNING_CODE = `pub fn is_even(_n: u32) -> bool {
    loop {}
}
`

const RUST_PASSING_HARNESS = `#[test]
fn returns_true_for_even_numbers() {
    assert!(exercise::is_even(4), "4 is even");
}

#[test]
fn returns_false_for_odd_numbers() {
    assert!(!exercise::is_even(7), "7 is odd");
}

#[test]
fn handles_zero() {
    assert!(exercise::is_even(0), "0 is even");
}
`

const GO_PASSING_CODE = `package exercise

func IsEven(n uint32) bool {
	return n%2 == 0
}
`

const GO_FAILING_CODE = `package exercise

func IsEven(n uint32) bool {
	return n%2 == 1
}
`

const GO_COMPILE_ERROR_CODE = `package exercise

func IsEven(n uint32) bool {
`

const GO_SPINNING_CODE = `package exercise

func IsEven(_ uint32) bool {
	for {
	}
}
`

const GO_PASSING_HARNESS = `package exercise

import "testing"

func TestIsEvenEvenNumbers(t *testing.T) {
	if !IsEven(4) {
		t.Error("4 is even")
	}
}

func TestIsEvenOddNumbers(t *testing.T) {
	if IsEven(7) {
		t.Error("7 is odd")
	}
}

func TestIsEvenZero(t *testing.T) {
	if !IsEven(0) {
		t.Error("0 is even")
	}
}
`

const PYTHON_PASSING_CODE = `def is_even(n: int) -> bool:
    return n % 2 == 0
`

const PYTHON_FAILING_CODE = `def is_even(n: int) -> bool:
    return n % 2 == 1
`

const PYTHON_IMPORT_ERROR_CODE = `def is_even(n: int) -> bool:
`

const PYTHON_SPINNING_CODE = `def is_even(n: int) -> bool:
    while True:
        pass
`

const PYTHON_PASSING_HARNESS = `from exercise import is_even


def test_even_numbers():
    assert is_even(4) is True, "4 is even"


def test_odd_numbers():
    assert is_even(7) is False, "7 is odd"


def test_zero():
    assert is_even(0) is True, "0 is even"
`

const docker = new Docker()
const daemon = await dockerAvailable()

describe.skipIf(!daemon)('rust sandbox runner against real Docker', () => {
  it('passes a correct submission and normalizes the JUnit result', async () => {
    const result = await runSandboxSubmission({
      language: 'rust',
      code: RUST_PASSING_CODE,
      testSource: RUST_PASSING_HARNESS,
    })

    expect(result.passed).toBe(true)
    expect(result.tests.map((test) => test.name).sort()).toEqual(
      [
        'returns_true_for_even_numbers',
        'returns_false_for_odd_numbers',
        'handles_zero',
      ].sort(),
    )
    expect(result.tests.every((test) => test.status === 'passed')).toBe(true)
  }, 120_000)

  it('fails a submission whose tests do not pass', async () => {
    const result = await runSandboxSubmission({
      language: 'rust',
      code: RUST_FAILING_CODE,
      testSource: RUST_PASSING_HARNESS,
    })

    expect(result.passed).toBe(false)
    expect(
      result.tests.filter((test) => test.status === 'failed'),
    ).toHaveLength(3)
  }, 120_000)

  it('reports a compile error without producing test output', async () => {
    const result = await runSandboxSubmission({
      language: 'rust',
      code: RUST_COMPILE_ERROR_CODE,
      testSource: RUST_PASSING_HARNESS,
    })

    expect(result.passed).toBe(false)
    expect(result.message).toBeTruthy()
  }, 120_000)

  it('kills a run that exceeds the timeout and leaves no container behind', async () => {
    const result = await runSandboxSubmission(
      {
        language: 'rust',
        code: RUST_SPINNING_CODE,
        testSource: RUST_PASSING_HARNESS,
      },
      { timeoutMs: 1_000 },
    )

    expect(result.passed).toBe(false)
    expect(result.message).toMatch(/killed/)

    const leftovers = await docker.listContainers({
      all: true,
      filters: { name: ['sandbox-'] },
    })
    expect(leftovers).toHaveLength(0)
  }, 120_000)
})

describe.skipIf(!daemon)('go sandbox runner against real Docker', () => {
  it('passes a correct submission and normalizes the go test -json result', async () => {
    const result = await runSandboxSubmission({
      language: 'go',
      code: GO_PASSING_CODE,
      testSource: GO_PASSING_HARNESS,
    })

    expect(result.passed).toBe(true)
    expect(result.tests.map((test) => test.name).sort()).toEqual(
      [
        'TestIsEvenEvenNumbers',
        'TestIsEvenOddNumbers',
        'TestIsEvenZero',
      ].sort(),
    )
    expect(result.tests.every((test) => test.status === 'passed')).toBe(true)
  }, 120_000)

  it('fails a submission whose tests do not pass', async () => {
    const result = await runSandboxSubmission({
      language: 'go',
      code: GO_FAILING_CODE,
      testSource: GO_PASSING_HARNESS,
    })

    expect(result.passed).toBe(false)
    expect(
      result.tests.filter((test) => test.status === 'failed'),
    ).toHaveLength(3)
  }, 120_000)

  it('reports a build error without test-scoped events', async () => {
    const result = await runSandboxSubmission({
      language: 'go',
      code: GO_COMPILE_ERROR_CODE,
      testSource: GO_PASSING_HARNESS,
    })

    expect(result.passed).toBe(false)
    expect(result.message).toBeTruthy()
    expect(result.message).toMatch(/syntax error/)
  }, 120_000)

  it('kills a run that exceeds the timeout and leaves no container behind', async () => {
    const result = await runSandboxSubmission(
      {
        language: 'go',
        code: GO_SPINNING_CODE,
        testSource: GO_PASSING_HARNESS,
      },
      { timeoutMs: 1_000 },
    )

    expect(result.passed).toBe(false)
    expect(result.message).toMatch(/killed/)

    const leftovers = await docker.listContainers({
      all: true,
      filters: { name: ['sandbox-'] },
    })
    expect(leftovers).toHaveLength(0)
  }, 120_000)
})

describe.skipIf(!daemon)('python sandbox runner against real Docker', () => {
  it('passes a correct submission and normalizes the pytest JUnit result', async () => {
    const result = await runSandboxSubmission({
      language: 'python',
      code: PYTHON_PASSING_CODE,
      testSource: PYTHON_PASSING_HARNESS,
    })

    expect(result.passed).toBe(true)
    expect(result.tests.map((test) => test.name).sort()).toEqual(
      ['test_even_numbers', 'test_odd_numbers', 'test_zero'].sort(),
    )
    expect(result.tests.every((test) => test.status === 'passed')).toBe(true)
  }, 120_000)

  it('fails a submission whose tests do not pass', async () => {
    const result = await runSandboxSubmission({
      language: 'python',
      code: PYTHON_FAILING_CODE,
      testSource: PYTHON_PASSING_HARNESS,
    })

    expect(result.passed).toBe(false)
    expect(
      result.tests.filter((test) => test.status === 'failed'),
    ).toHaveLength(3)
  }, 120_000)

  it('reports an import error as an errored collection', async () => {
    const result = await runSandboxSubmission({
      language: 'python',
      code: PYTHON_IMPORT_ERROR_CODE,
      testSource: PYTHON_PASSING_HARNESS,
    })

    expect(result.passed).toBe(false)
    expect(result.tests.length).toBeGreaterThan(0)
    expect(result.tests.some((test) => test.status === 'errored')).toBe(true)
  }, 120_000)

  it('kills a run that exceeds the timeout and leaves no container behind', async () => {
    const result = await runSandboxSubmission(
      {
        language: 'python',
        code: PYTHON_SPINNING_CODE,
        testSource: PYTHON_PASSING_HARNESS,
      },
      { timeoutMs: 1_000 },
    )

    expect(result.passed).toBe(false)
    expect(result.message).toMatch(/killed/)

    const leftovers = await docker.listContainers({
      all: true,
      filters: { name: ['sandbox-'] },
    })
    expect(leftovers).toHaveLength(0)
  }, 120_000)
})

describe('buildSandboxHostConfig', () => {
  it('enforces every PRD 5.1 resource limit on every run', () => {
    const config = buildSandboxHostConfig(
      'C:/Users/me/AppData/Local/Temp/workspace',
    )

    expect(config.Memory).toBe(SANDBOX_MEMORY_BYTES)
    expect(config.Memory).toBe(512 * 1024 * 1024)
    expect(config.NanoCpus).toBe(SANDBOX_NANOCPUS)
    expect(config.NanoCpus).toBe(1_000_000_000)
    expect(config.PidsLimit).toBe(SANDBOX_PIDS_LIMIT)
    expect(config.PidsLimit).toBe(64)
    expect(config.NetworkMode).toBe('none')
    expect(config.ReadonlyRootfs).toBe(true)
    expect(config.Tmpfs).toEqual({
      '/cache': 'uid=1001,gid=1001,exec',
      '/tmp': 'uid=1001,gid=1001,exec',
    })
    expect(config.Binds).toEqual([
      'C:/Users/me/AppData/Local/Temp/workspace:/project',
    ])
  })

  it('normalizes Windows backslashes in bind-mount paths', () => {
    const config = buildSandboxHostConfig('C:\\Users\\me\\Temp\\workspace')
    expect(config.Binds?.[0]).toBe('C:/Users/me/Temp/workspace:/project')
  })
})

describe('sandbox constants', () => {
  it('keeps the pinned per-language image tags and execution window', () => {
    expect(RUST_SANDBOX_IMAGE).toBe('teach-sandbox-rust:v1')
    expect(GO_SANDBOX_IMAGE).toBe('teach-sandbox-go:v1')
    expect(PYTHON_SANDBOX_IMAGE).toBe('teach-sandbox-python:v1')
    expect(SANDBOX_EXECUTION_TIMEOUT_MS).toBe(10_000)
    expect(SANDBOX_OUTPUT_CAP_BYTES).toBe(1024 * 1024)
  })
})
