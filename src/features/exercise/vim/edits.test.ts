import { describe, expect, it } from 'vitest'

import {
  applyRangeOperator,
  changeLines,
  deleteChars,
  deleteLines,
  openLineAbove,
  openLineBelow,
  paste,
  yankLines,
} from './edits'

describe('applyRangeOperator', () => {
  it('d cuts the range out and registers it charwise', () => {
    const result = applyRangeOperator('let username = "Karl";', 'd', 4, 12)
    expect(result.value).toBe('let  = "Karl";')
    expect(result.caret).toBe(4)
    expect(result.register).toEqual({ text: 'username', linewise: false })
  })

  it('y reads the range without touching the buffer', () => {
    const result = applyRangeOperator('hello world', 'y', 0, 5)
    expect(result.value).toBe('hello world')
    expect(result.register).toEqual({ text: 'hello', linewise: false })
  })

  it('normalizes a reversed [end, start) range', () => {
    const result = applyRangeOperator('hello world', 'd', 5, 0)
    expect(result.value).toBe(' world')
  })
})

describe('deleteLines / yankLines / changeLines (dd/yy/cc)', () => {
  const value = 'one\ntwo\nthree'

  it('dd removes the line plus its trailing newline', () => {
    const result = deleteLines(value, 4, 1) // pos on "two"
    expect(result.value).toBe('one\nthree')
    expect(result.register).toEqual({ text: 'two\n', linewise: true })
  })

  it('dd on the last line consumes the newline before it instead', () => {
    const result = deleteLines(value, 9, 1) // pos on "three"
    expect(result.value).toBe('one\ntwo')
  })

  it('dd with a count removes several lines at once', () => {
    const result = deleteLines(value, 0, 2)
    expect(result.value).toBe('three')
  })

  it('yy copies the line and leaves the buffer untouched', () => {
    const result = yankLines(value, 0, 1)
    expect(result.value).toBe(value)
    expect(result.register).toEqual({ text: 'one\n', linewise: true })
  })

  it('cc clears the line content, keeping the line itself', () => {
    const result = changeLines(value, 4, 1) // pos on "two"
    expect(result.value).toBe('one\n\nthree')
    expect(result.caret).toBe(4)
  })
})

describe('deleteChars (x)', () => {
  it('deletes count characters without crossing the newline', () => {
    const result = deleteChars('ab\ncd', 0, 5)
    expect(result.value).toBe('\ncd')
    expect(result.register).toEqual({ text: 'ab', linewise: false })
  })
})

describe('paste (p/P)', () => {
  it('charwise p inserts after the cursor and lands on the last char', () => {
    const result = paste('ac', 0, { text: 'b', linewise: false }, true)
    expect(result.value).toBe('abc')
    expect(result.caret).toBe(1)
  })

  it('charwise P inserts before the cursor', () => {
    const result = paste('ac', 1, { text: 'b', linewise: false }, false)
    expect(result.value).toBe('abc')
  })

  it('linewise p inserts a new line below the current one', () => {
    const result = paste('one\ntwo', 0, { text: 'new', linewise: true }, true)
    expect(result.value).toBe('one\nnew\ntwo')
    expect(result.caret).toBe(4)
  })

  it("linewise p after the buffer's last line appends one", () => {
    const result = paste('only', 0, { text: 'new', linewise: true }, true)
    expect(result.value).toBe('only\nnew')
  })

  it('linewise P inserts a new line above the current one', () => {
    const result = paste('one\ntwo', 4, { text: 'new', linewise: true }, false)
    expect(result.value).toBe('one\nnew\ntwo')
    expect(result.caret).toBe(4)
  })
})

describe('openLineBelow / openLineAbove (o/O)', () => {
  it('o opens an empty line below and lands the caret on it', () => {
    const result = openLineBelow('one\ntwo', 0)
    expect(result.value).toBe('one\n\ntwo')
    expect(result.caret).toBe(4)
  })

  it('o on the last line appends a fresh empty line', () => {
    const result = openLineBelow('only', 0)
    expect(result.value).toBe('only\n')
    expect(result.caret).toBe(5)
  })

  it('O opens an empty line above', () => {
    const result = openLineAbove('one\ntwo', 4)
    expect(result.value).toBe('one\n\ntwo')
    expect(result.caret).toBe(4)
  })
})
