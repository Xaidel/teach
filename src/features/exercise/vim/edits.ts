import { lineBounds, lineIndexAt, offsetOfLine } from './motions'

/** What a delete/change/yank left behind — text for the unnamed register,
 * and whether it's a whole-line ("linewise") or in-line ("charwise")
 * chunk, which controls how `p`/`P` paste it back. */
export type Register = { text: string; linewise: boolean }

/** The result of any mutating edit: the new buffer, where the caret
 * belongs afterward, and (for delete/yank) what went into the register. */
export type EditResult = {
  value: string
  caret: number
  register?: Register
}

/** `d`/`c`/`y` over an explicit `[start, end)` range (already resolved
 * from a motion or text object) — `d`/`c` cut the range out, `y` leaves
 * the buffer untouched and just reads it. */
export function applyRangeOperator(
  value: string,
  operator: 'd' | 'c' | 'y',
  start: number,
  end: number,
): EditResult {
  const [from, to] = start <= end ? [start, end] : [end, start]
  const text = value.slice(from, to)

  if (operator === 'y') {
    return { value, caret: from, register: { text, linewise: false } }
  }
  return {
    value: value.slice(0, from) + value.slice(to),
    caret: from,
    register: { text, linewise: false },
  }
}

/** The `[start, end)` span covering `count` whole lines starting at
 * `pos`'s line, plus whether it reaches the buffer's last line — `dd`/`yy`
 * swallow the line's own trailing newline (except at the buffer's end,
 * where there isn't one), while `cc` needs the content only. Shared by
 * `deleteLines`/`yankLines`/`changeLines` below. */
function lineSpan(
  value: string,
  pos: number,
  count: number,
): { start: number; end: number; contentEnd: number; isBufferEnd: boolean } {
  const lines = value.split('\n')
  const startIndex = lineIndexAt(value, pos)
  const endIndex = Math.min(
    startIndex + Math.max(count, 1) - 1,
    lines.length - 1,
  )
  const start = offsetOfLine(value, startIndex + 1)
  const isBufferEnd = endIndex === lines.length - 1
  const end = isBufferEnd ? value.length : offsetOfLine(value, endIndex + 2)
  const contentEnd = lineBounds(value, offsetOfLine(value, endIndex + 1)).end
  return { start, end, contentEnd, isBufferEnd }
}

/** `dd` — delete `count` whole lines, register gets them linewise. */
export function deleteLines(
  value: string,
  pos: number,
  count: number,
): EditResult {
  const { start, end, isBufferEnd } = lineSpan(value, pos, count)
  // The last line in the buffer has no trailing "\n" to absorb, so pull in
  // the newline *before* it instead — otherwise deleting the final line
  // would leave a dangling blank line behind.
  const deleteFrom = isBufferEnd && start > 0 ? start - 1 : start
  const text = value.slice(start, end)
  const newValue = value.slice(0, deleteFrom) + value.slice(end)
  const newLineCount = newValue.split('\n').length
  const caretLine = Math.min(lineIndexAt(value, pos), newLineCount - 1)
  return {
    value: newValue,
    caret: offsetOfLine(newValue, caretLine + 1),
    register: { text, linewise: true },
  }
}

/** `yy` — copy `count` whole lines without touching the buffer. */
export function yankLines(
  value: string,
  pos: number,
  count: number,
): EditResult {
  const { start, end } = lineSpan(value, pos, count)
  return {
    value,
    caret: start,
    register: { text: value.slice(start, end), linewise: true },
  }
}

/** `cc` — clear `count` lines' content (collapsing them to one empty line
 * when `count > 1`) and hand back a caret ready for insert mode. */
export function changeLines(
  value: string,
  pos: number,
  count: number,
): EditResult {
  const { start, contentEnd } = lineSpan(value, pos, count)
  return {
    value: value.slice(0, start) + value.slice(contentEnd),
    caret: start,
    register: { text: value.slice(start, contentEnd), linewise: true },
  }
}

/** `x` — delete `count` characters starting at `pos`, stopping at the end
 * of the line (vim's `x` doesn't reach across the newline). */
export function deleteChars(
  value: string,
  pos: number,
  count: number,
): EditResult {
  const { end } = lineBounds(value, pos)
  const to = Math.min(pos + Math.max(count, 1), end)
  return applyRangeOperator(value, 'd', pos, to)
}

/** `p`/`P` — paste the register after/before the caret. A linewise
 * register always lands as whole new lines; a charwise one is spliced
 * into the current line at (`after`) or before (`!after`) the caret. */
export function paste(
  value: string,
  pos: number,
  register: Register,
  after: boolean,
): EditResult {
  if (register.linewise) {
    // Normalize to the line's bare content — the newline that separates it
    // from what follows gets added back explicitly below, since where it
    // goes (and whether one is needed at all) depends on whether the
    // insertion point is mid-buffer or at the very end.
    const body = register.text.endsWith('\n')
      ? register.text.slice(0, -1)
      : register.text
    if (after) {
      const { end } = lineBounds(value, pos)
      if (end === value.length) {
        // Appending after the buffer's last line: there's no following
        // newline to anchor to, so don't invent a trailing one either.
        const prefix = value.length > 0 ? '\n' : ''
        return {
          value: value + prefix + body,
          caret: value.length + prefix.length,
        }
      }
      const insertAt = end + 1
      return {
        value: value.slice(0, insertAt) + body + '\n' + value.slice(insertAt),
        caret: insertAt,
      }
    }
    const { start } = lineBounds(value, pos)
    return {
      value: value.slice(0, start) + body + '\n' + value.slice(start),
      caret: start,
    }
  }

  const at = after ? Math.min(pos + 1, value.length) : pos
  return {
    value: value.slice(0, at) + register.text + value.slice(at),
    caret: at + Math.max(register.text.length - 1, 0),
  }
}

/** `o` — open a new empty line below `pos`'s line and place the caret on
 * it, ready for insert mode. */
export function openLineBelow(value: string, pos: number): EditResult {
  const { end } = lineBounds(value, pos)
  return {
    value: value.slice(0, end) + '\n' + value.slice(end),
    caret: end + 1,
  }
}

/** `O` — open a new empty line above `pos`'s line. */
export function openLineAbove(value: string, pos: number): EditResult {
  const { start } = lineBounds(value, pos)
  return {
    value: value.slice(0, start) + '\n' + value.slice(start),
    caret: start,
  }
}
