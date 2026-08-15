/**
 * Pure caret-motion math for the vim keybinding layer — no DOM, no React,
 * so every rule here is unit-testable in isolation. Everything operates on
 * a plain `value: string` and a zero-based character offset `pos`, mapping
 * onto vim's classic motions (`h`/`j`/`k`/`l`, `w`/`b`/`e`, `0`/`^`/`$`,
 * `gg`/`G`, `f`/`F`/`t`/`T`, and the `iw`/`aw` text objects). `use-vim-mode`
 * is the only caller — it owns the DOM and the multi-key state machine
 * (counts, pending `g`/`f`/operator keys); this module just answers "where
 * does this motion land".
 */

/** vim's three character classes for word motions: a run of the same class
 * (or a whitespace gap) is what `w`/`b`/`e` step across. */
type CharClass = 'space' | 'word' | 'punct'

function charClass(ch: string | undefined): CharClass {
  if (ch === undefined || /\s/.test(ch)) return 'space'
  if (/[A-Za-z0-9_]/.test(ch)) return 'word'
  return 'punct'
}

/** The `[start, end)` line containing `pos` — `end` is the newline's index,
 * or `value.length` on the last line, so `value.slice(start, end)` is the
 * line's content with no trailing `\n`. */
export function lineBounds(
  value: string,
  pos: number,
): { start: number; end: number } {
  const start = value.lastIndexOf('\n', Math.max(pos - 1, 0)) + 1
  const nextBreak = value.indexOf('\n', pos)
  const end = nextBreak === -1 ? value.length : nextBreak
  return { start, end }
}

/** The zero-based line index containing `pos`. */
export function lineIndexAt(value: string, pos: number): number {
  return value.slice(0, pos).split('\n').length - 1
}

/** How many lines `value` has (a trailing newline doesn't count as an
 * extra, blank line — same as vim's line count). */
export function lineCount(value: string): number {
  return value.split('\n').length
}

/** The character offset where 1-indexed `line` starts, clamping to the
 * buffer's first/last line. */
export function offsetOfLine(value: string, line: number): number {
  const lines = value.split('\n')
  const target = Math.min(Math.max(line, 1), lines.length) - 1
  let offset = 0
  for (let index = 0; index < target; index += 1) {
    offset += (lines[index]?.length ?? 0) + 1
  }
  return offset
}

/** `^` — the first non-blank column of `pos`'s line, or its start if the
 * line is blank. */
export function firstNonBlank(value: string, pos: number): number {
  const { start, end } = lineBounds(value, pos)
  for (let index = start; index < end; index += 1) {
    if (!/\s/.test(value[index] ?? '')) return index
  }
  return start
}

/** `$` — the last character of `pos`'s line (not the newline); the empty
 * line's own start when the line is empty. */
export function lineEndPos(value: string, pos: number): number {
  const { start, end } = lineBounds(value, pos)
  return Math.max(start, end - 1)
}

/** `j`/`k` (via `delta: ±1`) and `Ctrl-d/u/f/b` (via a larger `delta`):
 * steps `pos` `delta` lines up or down, holding column and clamping it to
 * the target line's length — vim doesn't chase the caret past a shorter
 * line. Clamps `delta` itself to the buffer's first/last line rather than
 * wrapping or erroring. */
export function moveByLines(value: string, pos: number, delta: number): number {
  if (delta === 0) return pos
  const lines = value.split('\n')
  const { start } = lineBounds(value, pos)
  const column = pos - start
  const currentIndex = lineIndexAt(value, pos)
  const targetIndex = Math.min(
    Math.max(currentIndex + delta, 0),
    lines.length - 1,
  )
  const targetStart = offsetOfLine(value, targetIndex + 1)
  const targetLine = lines[targetIndex] ?? ''
  return targetStart + Math.min(column, targetLine.length)
}

function sameClass(
  value: string,
  index: number,
  cls: CharClass,
  big: boolean,
): boolean {
  const actual = charClass(value[index])
  if (actual === 'space') return false
  return big ? true : actual === cls
}

/** `w`/`W` — the start of the next word (or WORD, when `big`). Whitespace
 * (including line breaks, which match `\s`) separates words, so `w`
 * naturally carries onto the next line, same as vim. Lands on
 * `value.length` past the last word. */
export function wordForward(value: string, pos: number, big: boolean): number {
  const n = value.length
  let index = Math.min(pos, n)
  if (index >= n) return n

  const startClass = charClass(value[index])
  if (startClass !== 'space') {
    while (index < n && sameClass(value, index, startClass, big)) index += 1
  }
  while (index < n && charClass(value[index]) === 'space') index += 1
  return index
}

/** `b`/`B` — the start of the previous word (or WORD). */
export function wordBackward(value: string, pos: number, big: boolean): number {
  let index = pos - 1
  if (index <= 0) return 0

  while (index > 0 && charClass(value[index]) === 'space') index -= 1
  if (index === 0) return 0

  const cls = charClass(value[index])
  while (index > 0 && sameClass(value, index - 1, cls, big)) index -= 1
  return index
}

/** `e`/`E` — the end of the current or next word (or WORD); inclusive, so
 * the result lands on the last character rather than one past it. */
export function wordEnd(value: string, pos: number, big: boolean): number {
  const n = value.length
  if (n === 0) return 0
  let index = pos + 1
  while (index < n && charClass(value[index]) === 'space') index += 1
  if (index >= n) return n - 1

  const cls = charClass(value[index])
  while (index + 1 < n && sameClass(value, index + 1, cls, big)) index += 1
  return index
}

/** `f`/`F` — the next/previous occurrence of `char` on `pos`'s own line
 * (vim's line-bound find), or `null` if there isn't one. */
export function findCharForward(
  value: string,
  pos: number,
  char: string,
): number | null {
  const { end } = lineBounds(value, pos)
  for (let index = pos + 1; index < end; index += 1) {
    if (value[index] === char) return index
  }
  return null
}

export function findCharBackward(
  value: string,
  pos: number,
  char: string,
): number | null {
  const { start } = lineBounds(value, pos)
  for (let index = pos - 1; index >= start; index -= 1) {
    if (value[index] === char) return index
  }
  return null
}

/** `iw`/`aw` — the `[start, end)` range of the word run touching `pos`.
 * `iw` ("inner word") is just that run; `aw` ("a word") extends it by one
 * adjacent whitespace run, preferring the trailing one — the same rule
 * vim's text objects use. */
export function innerWordRange(
  value: string,
  pos: number,
  around: boolean,
): { start: number; end: number } {
  const n = value.length
  if (n === 0) return { start: 0, end: 0 }

  const at = Math.min(pos, n - 1)
  const cls = charClass(value[at])
  let start = at
  let end = at + 1
  while (start > 0 && charClass(value[start - 1]) === cls) start -= 1
  while (end < n && charClass(value[end]) === cls) end += 1

  if (!around) return { start, end }

  if (end < n && charClass(value[end]) === 'space') {
    while (end < n && charClass(value[end]) === 'space') end += 1
  } else {
    while (start > 0 && charClass(value[start - 1]) === 'space') start -= 1
  }
  return { start, end }
}
