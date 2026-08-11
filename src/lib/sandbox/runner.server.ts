import Docker from 'dockerode'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { normalizeGoTestJson } from './go-test-normalizer'
import { normalizeJunit } from './junit-normalizer'
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
import type { SandboxLanguage, SandboxResult } from './types'

/** Stable sandbox orchestration error codes. */
export type SandboxErrorCode =
  | 'SANDBOX_START_FAILED'
  | 'SANDBOX_IMAGE_MISSING'
  | 'SANDBOX_UNSUPPORTED_LANGUAGE'

/** Error surfaced when a sandbox run cannot start or completes abnormally. */
export class SandboxError extends Error {
  readonly code: SandboxErrorCode

  /** Creates a sandbox error. */
  constructor(
    code: SandboxErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'SandboxError'
    this.code = code
  }
}

/** Input for one sandbox run: learner code plus the exercise's test harness. */
export type SandboxSubmissionInput = {
  language: SandboxLanguage
  code: string
  testSource: string
}

/** Per-language orchestration for one sandbox run (ADR-0011). */
type LanguageSandboxConfig = {
  image: string
  materialize: (
    workspace: string,
    input: SandboxSubmissionInput,
  ) => Promise<void>
  /** The toolchain command run inside the container. */
  cmd: string[]
  /** Path (inside the workspace) the toolchain writes its structured output to. */
  outputFile: string
  /** Maps the toolchain's native test output to the Sandbox Result shape. */
  normalize: (content: string) => SandboxResult | null
}

const RUST_SKELETON_DIR = fileURLToPath(
  new URL('../../../sandbox/rust/skeleton/', import.meta.url),
)
const GO_SKELETON_DIR = fileURLToPath(
  new URL('../../../sandbox/go/skeleton/', import.meta.url),
)

/**
 * Builds the hardened HostConfig every sandbox run enforces (PRD 5.1,
 * ADR-0005): memory, CPU, PID, network, and filesystem limits. Identical
 * limits for every language image.
 */
export function buildSandboxHostConfig(
  workspaceHostPath: string,
): Docker.HostConfig {
  return {
    Binds: [`${workspaceHostPath.replaceAll('\\', '/')}:/project`],
    Memory: SANDBOX_MEMORY_BYTES,
    NanoCpus: SANDBOX_NANOCPUS,
    PidsLimit: SANDBOX_PIDS_LIMIT,
    NetworkMode: 'none',
    ReadonlyRootfs: true,
    Tmpfs: {
      '/cache': 'uid=1001,gid=1001,exec',
      '/tmp': 'uid=1001,gid=1001,exec',
    },
  }
}

/**
 * Decodes a dockerode multiplexed log buffer (8-byte frame headers when the
 * container has no TTY) into plain text.
 */
export function decodeDockerLogs(buffer: Buffer): string {
  const chunks: string[] = []
  let offset = 0
  while (offset + 8 <= buffer.length) {
    const payloadLength = buffer.readUInt32BE(offset + 4)
    offset += 8
    if (offset + payloadLength > buffer.length) {
      break
    }
    chunks.push(
      buffer.subarray(offset, offset + payloadLength).toString('utf8'),
    )
    offset += payloadLength
  }
  if (chunks.length === 0 && buffer.length > 0) {
    return buffer.toString('utf8')
  }
  return chunks.join('')
}

async function materializeRustProject(
  workspace: string,
  input: SandboxSubmissionInput,
): Promise<void> {
  await copyFile(
    join(RUST_SKELETON_DIR, 'Cargo.toml'),
    join(workspace, 'Cargo.toml'),
  )
  await copyFile(
    join(RUST_SKELETON_DIR, 'Cargo.lock'),
    join(workspace, 'Cargo.lock'),
  )
  await mkdir(join(workspace, 'src'), { recursive: true })
  await mkdir(join(workspace, 'tests'), { recursive: true })
  await mkdir(join(workspace, 'output'), { recursive: true })
  await mkdir(join(workspace, '.config'), { recursive: true })
  await writeFile(
    join(workspace, '.config', 'nextest.toml'),
    '[profile.sandbox.junit]\npath = "/project/output/junit.xml"\n',
    'utf8',
  )
  await writeFile(join(workspace, 'src', 'lib.rs'), input.code, 'utf8')
  await writeFile(
    join(workspace, 'tests', 'exercise.rs'),
    input.testSource,
    'utf8',
  )
}

async function materializeGoProject(
  workspace: string,
  input: SandboxSubmissionInput,
): Promise<void> {
  await copyFile(join(GO_SKELETON_DIR, 'go.mod'), join(workspace, 'go.mod'))
  await mkdir(join(workspace, 'output'), { recursive: true })
  await writeFile(join(workspace, 'exercise.go'), input.code, 'utf8')
  await writeFile(
    join(workspace, 'exercise_test.go'),
    input.testSource,
    'utf8',
  )
}

async function materializePythonProject(
  workspace: string,
  input: SandboxSubmissionInput,
): Promise<void> {
  await mkdir(join(workspace, 'output'), { recursive: true })
  await writeFile(join(workspace, 'exercise.py'), input.code, 'utf8')
  await writeFile(
    join(workspace, 'test_exercise.py'),
    input.testSource,
    'utf8',
  )
}

const SANDBOX_LANGUAGE_CONFIGS: Partial<
  Record<SandboxLanguage, LanguageSandboxConfig>
> = {
    rust: {
      image: RUST_SANDBOX_IMAGE,
      materialize: materializeRustProject,
      cmd: ['cargo', 'nextest', 'run', '--no-fail-fast', '--profile', 'sandbox'],
      outputFile: join('output', 'junit.xml'),
      normalize: normalizeJunit,
    },
    go: {
      image: GO_SANDBOX_IMAGE,
      materialize: materializeGoProject,
      cmd: [
        'sh',
        '-c',
        'go test -json -count=1 -vet=off ./... > /project/output/go-test.json',
      ],
      outputFile: join('output', 'go-test.json'),
      normalize: normalizeGoTestJson,
    },
    python: {
      image: PYTHON_SANDBOX_IMAGE,
      materialize: materializePythonProject,
      cmd: [
        'pytest',
        '--junit-xml=/project/output/junit.xml',
        '-q',
        '-p',
        'no:cacheprovider',
      ],
      outputFile: join('output', 'junit.xml'),
      normalize: normalizeJunit,
    },
  }

/**
 * Runs one submission in a fresh ephemeral sandbox container of the
 * submission's language image and returns the normalized Sandbox Result. The
 * container is always removed and the per-run Sandbox Workspace always
 * deleted, whether the run passed, failed, or was killed by the watchdog.
 */
export async function runSandboxSubmission(
  input: SandboxSubmissionInput,
  options: { timeoutMs?: number } = {},
): Promise<SandboxResult> {
  const config = SANDBOX_LANGUAGE_CONFIGS[input.language]
  if (!config) {
    throw new SandboxError(
      'SANDBOX_UNSUPPORTED_LANGUAGE',
      `No sandbox image or toolchain is configured for "${input.language}".`,
    )
  }

  const timeoutMs = options.timeoutMs ?? SANDBOX_EXECUTION_TIMEOUT_MS
  const runId = randomUUID()
  const containerName = `sandbox-${runId}`
  const workspace = await mkdtemp(join(tmpdir(), `teach-sandbox-${runId}-`))
  const docker = new Docker()

  let container: Docker.Container | undefined
  let watchdog: NodeJS.Timeout | undefined
  const runState: { timedOut: boolean } = { timedOut: false }

  try {
    await config.materialize(workspace, input)

    try {
      container = await docker.createContainer({
        Image: config.image,
        name: containerName,
        WorkingDir: '/project',
        Cmd: config.cmd,
        HostConfig: buildSandboxHostConfig(workspace),
      })
    } catch (error) {
      throw new SandboxError(
        'SANDBOX_IMAGE_MISSING',
        `The sandbox image ${config.image} could not be used. Run pnpm run sandbox:build and confirm Docker is running.`,
        { cause: error },
      )
    }

    watchdog = setTimeout(() => {
      runState.timedOut = true
      void container?.kill().catch(() => {
        /* The watchdog kill is best-effort; removal is guaranteed in finally. */
      })
    }, timeoutMs)

    try {
      await container.start()
      await container.wait()
    } catch (error) {
      throw new SandboxError(
        'SANDBOX_START_FAILED',
        `The sandbox run for ${config.image} failed to execute.`,
        { cause: error },
      )
    } finally {
      clearTimeout(watchdog)
    }

    if (runState.timedOut) {
      return {
        passed: false,
        tests: [],
        message: `Execution exceeded the ${String(Math.round(timeoutMs / 1000))}s sandbox limit and was killed.`,
      }
    }

    const outputPath = join(workspace, config.outputFile)
    let output: string | null = null
    try {
      const buffer = await readFile(outputPath)
      output = buffer.subarray(0, SANDBOX_OUTPUT_CAP_BYTES).toString('utf8')
    } catch {
      output = null
    }

    let excerpt = ''
    if (output) {
      const normalized = config.normalize(output)
      if (normalized) {
        return normalized
      }
      // No structured result (e.g. a build failure): the toolchain still
      // wrote an excerpt worth surfacing as the result message.
      excerpt = output.trim().slice(-4_000)
    }

    if (!excerpt) {
      try {
        const logBuffer = await container.logs({ stdout: true, stderr: true })
        excerpt = decodeDockerLogs(logBuffer).trim().slice(-4_000)
      } catch {
        excerpt = ''
      }
    }

    return {
      passed: false,
      tests: [],
      message:
        excerpt ||
        'The submission failed without producing test output. Check the code for compile errors.',
    }
  } finally {
    if (watchdog) clearTimeout(watchdog)
    if (container) {
      await container.remove({ force: true }).catch(() => {
        /* Best-effort removal; the workspace is deleted regardless. */
      })
    }
    await rm(workspace, { recursive: true, force: true })
  }
}
