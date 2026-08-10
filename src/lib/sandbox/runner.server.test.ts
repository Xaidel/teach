import Docker from 'dockerode'
import { describe, expect, it } from 'vitest'

import { buildSandboxHostConfig, runRustSubmission } from './runner.server'
import {
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

const PASSING_CODE = `pub fn is_even(n: u32) -> bool {
    n % 2 == 0
}
`

const FAILING_CODE = `pub fn is_even(n: u32) -> bool {
    n % 2 == 1
}
`

const COMPILE_ERROR_CODE = `pub fn is_even(n: u32) -> bool {
`

const PASSING_HARNESS = `#[test]
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

const SPINNING_CODE = `pub fn is_even(_n: u32) -> bool {
    loop {}
}
`

const docker = new Docker()
const daemon = await dockerAvailable()

describe.skipIf(!daemon)('rust sandbox runner against real Docker', () => {
  it('passes a correct submission and normalizes the JUnit result', async () => {
    const result = await runRustSubmission({
      code: PASSING_CODE,
      testSource: PASSING_HARNESS,
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
    const result = await runRustSubmission({
      code: FAILING_CODE,
      testSource: PASSING_HARNESS,
    })

    expect(result.passed).toBe(false)
    expect(
      result.tests.filter((test) => test.status === 'failed'),
    ).toHaveLength(3)
  }, 120_000)

  it('reports a compile error without producing test output', async () => {
    const result = await runRustSubmission({
      code: COMPILE_ERROR_CODE,
      testSource: PASSING_HARNESS,
    })

    expect(result.passed).toBe(false)
    expect(result.message).toBeTruthy()
  }, 120_000)

  it('kills a run that exceeds the timeout and leaves no container behind', async () => {
    const result = await runRustSubmission(
      {
        code: SPINNING_CODE,
        testSource: PASSING_HARNESS,
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
  it('keeps the pinned Rust image tag and execution window', () => {
    expect(RUST_SANDBOX_IMAGE).toBe('teach-sandbox-rust:v1')
    expect(SANDBOX_EXECUTION_TIMEOUT_MS).toBe(10_000)
    expect(SANDBOX_OUTPUT_CAP_BYTES).toBe(1024 * 1024)
  })
})
