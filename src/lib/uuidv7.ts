import { getRandomValues } from 'node:crypto'

/**
 * Generates a UUIDv7 string: 48-bit Unix epoch milliseconds, a version-7
 * nibble, a variant-10 nibble pair, and 62 random bits.
 */
export function uuidv7(): string {
  const bytes = new Uint8Array(16)
  getRandomValues(bytes)

  const now = BigInt(Date.now())
  bytes.set(
    [
      Number((now >> 40n) & 0xffn),
      Number((now >> 32n) & 0xffn),
      Number((now >> 24n) & 0xffn),
      Number((now >> 16n) & 0xffn),
      Number((now >> 8n) & 0xffn),
      Number(now & 0xffn),
    ],
    0,
  )

  const versionByte = bytes[6] ?? 0
  const variantByte = bytes[8] ?? 0
  bytes[6] = (versionByte & 0x0f) | 0x70
  bytes[8] = (variantByte & 0x3f) | 0x80

  const hex = Buffer.from(bytes).toString('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-')
}
