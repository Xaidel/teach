import { describe, expect, it } from 'vitest'

import { decodeDockerLogs } from './runner.server'

describe('decodeDockerLogs', () => {
  it('decodes multiplexed stdout and stderr frames', () => {
    const stdoutFrame = Buffer.alloc(8 + 5)
    stdoutFrame[0] = 1
    stdoutFrame.writeUInt32BE(5, 4)
    stdoutFrame.write('hello', 8)

    const stderrFrame = Buffer.alloc(8 + 5)
    stderrFrame[0] = 2
    stderrFrame.writeUInt32BE(5, 4)
    stderrFrame.write('world', 8)

    expect(decodeDockerLogs(Buffer.concat([stdoutFrame, stderrFrame]))).toBe(
      'helloworld',
    )
  })

  it('falls back to raw text when the buffer is not framed', () => {
    expect(decodeDockerLogs(Buffer.from('plain text'))).toBe('plain text')
  })
})
