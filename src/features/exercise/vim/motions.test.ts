import { describe, expect, it } from 'vitest'

import {
  findCharBackward,
  findCharForward,
  firstNonBlank,
  innerWordRange,
  lineBounds,
  lineCount,
  lineEndPos,
  moveByLines,
  offsetOfLine,
  wordBackward,
  wordEnd,
  wordForward,
} from './motions'

describe('lineBounds / offsetOfLine / lineCount', () => {
  const value = 'ab\ncd\n\nef'

  it('finds the [start, end) content span for a position on any line', () => {
    expect(lineBounds(value, 1)).toEqual({ start: 0, end: 2 })
    expect(lineBounds(value, 3)).toEqual({ start: 3, end: 5 })
    expect(lineBounds(value, 6)).toEqual({ start: 6, end: 6 })
    expect(lineBounds(value, 8)).toEqual({ start: 7, end: 9 })
  })

  it('counts lines and locates a line by 1-indexed number', () => {
    expect(lineCount(value)).toBe(4)
    expect(offsetOfLine(value, 1)).toBe(0)
    expect(offsetOfLine(value, 2)).toBe(3)
    expect(offsetOfLine(value, 4)).toBe(7)
    expect(offsetOfLine(value, 99)).toBe(7) // clamps to the last line
  })
})

describe('firstNonBlank / lineEndPos', () => {
  it('finds the first non-space column, or the line start when blank', () => {
    expect(firstNonBlank('  let x = 1;', 0)).toBe(2)
    expect(firstNonBlank('   ', 1)).toBe(0)
  })

  it('finds the last character of the line, or the start when empty', () => {
    expect(lineEndPos('abc\ndef', 1)).toBe(2)
    expect(lineEndPos('abc\n\ndef', 4)).toBe(4)
  })
})

describe('moveByLines', () => {
  const value = 'ab\nc\nabcdef'

  it('holds column and clamps to the target line length', () => {
    expect(moveByLines(value, 2, 1)).toBe(4) // "ab"[col2] -> "c"[col0..1 clamp]
    expect(moveByLines(value, 3, 1)).toBe(5) // "c"[col0] -> "abcdef"[col0]
  })

  it('clamps at the buffer edges instead of wrapping', () => {
    expect(moveByLines(value, 1, -5)).toBe(1)
    expect(moveByLines(value, 3, 5)).toBe(5) // "c"[col0] -> last line[col0]
  })
})

describe('word motions', () => {
  const value = 'hello world rust'

  it('w steps to the start of the next word', () => {
    expect(wordForward(value, 0, false)).toBe(6)
    expect(wordForward(value, 6, false)).toBe(12)
  })

  it('b steps to the start of the previous word', () => {
    expect(wordBackward(value, 12, false)).toBe(6)
    expect(wordBackward(value, 6, false)).toBe(0)
  })

  it('e steps to the end of the current or next word', () => {
    expect(wordEnd(value, 0, false)).toBe(4)
    expect(wordEnd(value, 4, false)).toBe(10)
  })

  it('w treats punctuation as its own word, W does not', () => {
    const punctuated = 'hello-world foo_bar'
    expect(wordForward(punctuated, 0, false)).toBe(5) // stops at "-"
    expect(wordForward(punctuated, 0, true)).toBe(12) // "foo_bar" (WORD)
  })

  it('w carries across a line break, treating it as whitespace', () => {
    expect(wordForward('ab\ncd', 0, false)).toBe(3)
  })
})

describe('findCharForward / findCharBackward', () => {
  it('finds the next/previous occurrence on the same line only', () => {
    const value = 'let username = value;'
    expect(findCharForward(value, 0, '=')).toBe(13)
    expect(findCharBackward(value, value.length, '=')).toBe(13)
  })

  it('returns null when the character is not on the line', () => {
    expect(findCharForward('abc\ndef', 0, 'd')).toBeNull()
  })
})

describe('innerWordRange', () => {
  it('iw covers just the word run under the cursor', () => {
    expect(innerWordRange('let username = "Karl";', 5, false)).toEqual({
      start: 4,
      end: 12,
    })
  })

  it('aw extends the run by one trailing whitespace gap', () => {
    expect(innerWordRange('foo bar baz', 0, true)).toEqual({
      start: 0,
      end: 4,
    })
  })
})
