import { describe, expect, it } from 'vitest'

import { uuidv7 } from './uuidv7'

const UUIDV7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('uuidv7', () => {
  it('produces version-7, variant-10 UUIDs', () => {
    const value = uuidv7()
    expect(value).toMatch(UUIDV7_PATTERN)
  })

  it('encodes the current Unix epoch milliseconds in the timestamp bytes', () => {
    const before = BigInt(Date.now())
    const value = uuidv7()
    const after = BigInt(Date.now())

    const timestampHex = value.replaceAll('-', '').slice(0, 12)
    const timestamp = BigInt(`0x${timestampHex}`)

    expect(timestamp).toBeGreaterThanOrEqual(before)
    expect(timestamp).toBeLessThanOrEqual(after)
  })

  it('is unique across many calls', () => {
    const seen = new Set<string>()
    for (let index = 0; index < 10_000; index += 1) {
      seen.add(uuidv7())
    }
    expect(seen.size).toBe(10_000)
  })
})
