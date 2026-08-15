import { useRef, useState } from 'react'

import type { EditResult, Register } from './vim/edits'
import {
  applyRangeOperator,
  changeLines,
  deleteChars,
  deleteLines,
  openLineAbove,
  openLineBelow,
  paste,
  yankLines,
} from './vim/edits'
import {
  findCharBackward,
  findCharForward,
  firstNonBlank,
  innerWordRange,
  lineBounds,
  lineCount,
  lineEndPos,
  lineIndexAt,
  moveByLines,
  offsetOfLine,
  wordBackward,
  wordEnd,
  wordForward,
} from './vim/motions'

/** The active vim mode, mirroring the reference cheat sheet's mode table:
 * `normal` for navigation/commands, `insert` for typing, the three
 * `visual*` variants for selecting, and `command`/`search` for the
 * `:`/`/`/`?` prompt line. */
export type VimMode =
  | 'normal'
  | 'insert'
  | 'visual'
  | 'visual-line'
  | 'visual-block'
  | 'command'
  | 'search'

type Operator = 'd' | 'c' | 'y'
type FindType = 'f' | 'F' | 't' | 'T'
type VisualKind = 'visual' | 'visual-line' | 'visual-block'

type Pending = {
  /** Digits typed before an operator or a bare motion, e.g. the `3` in
   * `3dw` or `5j`. */
  count: string
  operator: Operator | null
  /** Digits typed after the operator, before its motion, e.g. the `3` in
   * `d3w` — multiplies with `count`. */
  operatorCount: string
  /** Set once an operator is followed by `i`/`a`, awaiting the text
   * object's own key (only `w` is supported: `iw`/`aw`). */
  textObject: 'i' | 'a' | null
  /** Set after a lone `g`, awaiting the second `g` of `gg`. */
  awaitingG: boolean
  /** Set after `f`/`F`/`t`/`T`, awaiting the target character. */
  awaitingFind: FindType | null
}

const EMPTY_PENDING: Pending = {
  count: '',
  operator: null,
  operatorCount: '',
  textObject: null,
  awaitingG: false,
  awaitingFind: null,
}

const MODE_LABEL: Record<VimMode, string> = {
  normal: 'NORMAL',
  insert: 'INSERT',
  visual: 'VISUAL',
  'visual-line': 'VISUAL LINE',
  'visual-block': 'VISUAL BLOCK',
  command: 'COMMAND',
  search: 'SEARCH',
}

/** Resolves the single-key motions that compose with an operator or move
 * the caret on their own: `h`/`j`/`k`/`l`, `w`/`b`/`e` (and their
 * WORD/big-word variants `W`/`B`/`E`), `0`/`^`/`$`. `f`/`F`/`t`/`T` need a
 * second key (the target character), and `gg`/`G` are linewise rather than
 * a caret offset, so both are resolved separately by the caller. `null`
 * for any key this function doesn't own. */
function resolveMotion(
  value: string,
  pos: number,
  key: string,
  count: number,
): { target: number } | null {
  switch (key) {
    case 'h':
      return { target: Math.max(0, pos - count) }
    case 'l':
      return { target: Math.min(value.length, pos + count) }
    case 'j':
      return { target: moveByLines(value, pos, count) }
    case 'k':
      return { target: moveByLines(value, pos, -count) }
    case '0':
      return { target: lineBounds(value, pos).start }
    case '^':
      return { target: firstNonBlank(value, pos) }
    case '$':
      return { target: lineEndPos(value, pos) }
    case 'w':
    case 'W': {
      let target = pos
      for (let i = 0; i < count; i += 1)
        target = wordForward(value, target, key === 'W')
      return { target }
    }
    case 'b':
    case 'B': {
      let target = pos
      for (let i = 0; i < count; i += 1)
        target = wordBackward(value, target, key === 'B')
      return { target }
    }
    case 'e':
    case 'E': {
      let target = pos
      for (let i = 0; i < count; i += 1)
        target = wordEnd(value, target, key === 'E')
      return { target }
    }
    default:
      return null
  }
}

/** `f`/`t` search forward on the line, landing on (`f`) or just before
 * (`t`) the character; `F`/`T` mirror that backward. `null` when the
 * character isn't on the line, matching vim's no-op. */
function resolveFind(
  value: string,
  pos: number,
  type: FindType,
  char: string,
): number | null {
  if (type === 'f') return findCharForward(value, pos, char)
  if (type === 't') {
    const found = findCharForward(value, pos, char)
    return found === null ? null : found - 1
  }
  if (type === 'F') return findCharBackward(value, pos, char)
  const found = findCharBackward(value, pos, char)
  return found === null ? null : found + 1
}

function flipFind(type: FindType): FindType {
  if (type === 'f') return 'F'
  if (type === 'F') return 'f'
  if (type === 't') return 'T'
  return 't'
}

/** `/`/`?`/`n`/`N` — the next match of `term` from `pos`, wrapping around
 * the buffer once (vim's default `wrapscan`). `null` when `term` doesn't
 * occur anywhere. */
function searchFrom(
  value: string,
  pos: number,
  term: string,
  direction: 1 | -1,
): number | null {
  if (!term) return null
  if (direction === 1) {
    const after = value.indexOf(term, pos + 1)
    if (after !== -1) return after
    const wrapped = value.indexOf(term)
    return wrapped === -1 ? null : wrapped
  }
  if (pos > 0) {
    const before = value.lastIndexOf(term, pos - 1)
    if (before !== -1) return before
  }
  const wrapped = value.lastIndexOf(term)
  return wrapped === -1 ? null : wrapped
}

// `e`/`$`/`f`/`t` land ON their target character, so an operator range
// built from them has to include it (`target + 1`); every other motion
// here is exclusive when moving forward. Moving *backward* needs no such
// adjustment — slicing `[target, pos)` already includes whatever
// character a backward motion (`b`, `F`, `T`, …) landed on, matching how
// vim's own backward-exclusive motions behave too (`resolveFind` above
// already shifts `t`/`T`'s target so this one rule covers both). This is
// a simplification of vim's real inclusive/exclusive motion table, close
// enough for the motions this layer supports.
const INCLUSIVE_FORWARD_KEYS = new Set(['e', 'E', '$', 'f', 't'])

function operatorRange(
  pos: number,
  target: number,
  key: string,
): { start: number; end: number } {
  if (target >= pos && INCLUSIVE_FORWARD_KEYS.has(key)) {
    return { start: pos, end: target + 1 }
  }
  return { start: Math.min(pos, target), end: Math.max(pos, target) }
}

/** `dgg`/`dG`/visual-line `d`/`y`/`c`: line-span operators that cover every
 * whole line between two positions (order-independent), reusing the same
 * `deleteLines`/`yankLines`/`changeLines` that back `dd`/`yy`/`cc`. */
function applyLinewiseOperator(
  value: string,
  operator: Operator,
  fromPos: number,
  toPos: number,
): EditResult {
  const fromLine = lineIndexAt(value, Math.min(fromPos, toPos))
  const toLine = lineIndexAt(value, Math.max(fromPos, toPos))
  const start = offsetOfLine(value, fromLine + 1)
  const count = toLine - fromLine + 1
  if (operator === 'd') return deleteLines(value, start, count)
  if (operator === 'y') return yankLines(value, start, count)
  return changeLines(value, start, count)
}

/** `d`/`y`/`c` over a charwise visual span `[lo, hi]` (both inclusive, as
 * visual selections are in vim). */
function applyCharwiseVisual(
  value: string,
  lo: number,
  hi: number,
  operator: Operator,
): EditResult {
  return applyRangeOperator(value, operator, lo, Math.min(hi + 1, value.length))
}

/** A vim keybinding layer for a plain `<textarea>`, wired to the reference
 * cheat sheet's command set: the mode table (`normal`/`insert`/`visual*`/
 * `command`/`search`), insert entry (`i a I A o O`), the motions (`h j k l
 * w b e W B E 0 ^ $ gg G f F t T ; ,`), search (`/ ? n N`), editing (`x dd
 * yy p P u Ctrl-r`), the change/delete operators (`c d y` composed with a
 * motion or `iw`/`aw`, plus their doubled linewise form `cc`/`dd`/`yy`),
 * visual selection (`v V Ctrl-v`) with `d`/`y`/`c` acting on it, and counts
 * (`3w`, `2dd`, `10G`, …).
 *
 * Deliberately out of scope, because a single-selection `<textarea>` can't
 * represent them: `Ctrl-v`'s rectangular block editing is approximated as
 * an ordinary charwise span (real per-column block edits with no way to
 * show the user the rectangle would be more confusing than helpful), and
 * `:` command mode only understands a bare line number (`:10`) — there's
 * no file here to `:w`/`:q`.
 *
 * Disabled by default, so an unmodified field behaves like an ordinary
 * textarea until a learner opts in; unhandled modifier combos (Alt/Cmd,
 * and every Ctrl combo but the handful listed above) pass through
 * untouched so native shortcuts — copy, paste, browser undo — keep
 * working.
 */
export function useVimMode(onChange: (value: string) => void): {
  enabled: boolean
  mode: VimMode
  /** The vim-style status line: the current mode plus any keys already
   * typed toward a multi-key command (`d`, `2d`, `g`, `f`…). */
  statusText: string
  /** The `:`/`/`/`?` prompt's buffer (e.g. `":10"`, `"/rust"`), shown in
   * place of `statusText` while in command or search mode. */
  commandLine: string | null
  toggleEnabled: () => void
  handleKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void
} {
  const [enabled, setEnabled] = useState(false)
  const [mode, setMode] = useState<VimMode>('normal')
  const [pending, setPending] = useState<Pending>(EMPTY_PENDING)
  const [commandLine, setCommandLine] = useState<{
    trigger: ':' | '/' | '?'
    buffer: string
  } | null>(null)

  const registerRef = useRef<Register | null>(null)
  const lastFindRef = useRef<{ type: FindType; char: string } | null>(null)
  const lastSearchRef = useRef<{ term: string; direction: 1 | -1 } | null>(null)
  const undoStackRef = useRef<{ value: string; caret: number }[]>([])
  const redoStackRef = useRef<{ value: string; caret: number }[]>([])
  const visualRef = useRef<{ anchor: number; head: number } | null>(null)

  function toggleEnabled(): void {
    setEnabled((current) => !current)
    setMode('normal')
    setPending(EMPTY_PENDING)
    setCommandLine(null)
    visualRef.current = null
  }

  function moveCaret(field: HTMLTextAreaElement, pos: number): void {
    field.setSelectionRange(pos, pos)
  }

  /** Applies a mutating edit: DOM-first, same as the browser's own typing
   * path — set `field.value` and the caret directly, then notify React via
   * `onChange`. Since the value we hand back matches what's already on the
   * DOM node, React's controlled-input reconciliation leaves it (and the
   * caret) alone on the next render instead of resetting it. */
  function commit(field: HTMLTextAreaElement, result: EditResult): void {
    undoStackRef.current.push({
      value: field.value,
      caret: field.selectionStart,
    })
    if (undoStackRef.current.length > 200) undoStackRef.current.shift()
    redoStackRef.current = []
    field.value = result.value
    field.setSelectionRange(result.caret, result.caret)
    onChange(result.value)
    if (result.register) registerRef.current = result.register
  }

  function undo(field: HTMLTextAreaElement): void {
    const previous = undoStackRef.current.pop()
    if (!previous) return
    redoStackRef.current.push({
      value: field.value,
      caret: field.selectionStart,
    })
    field.value = previous.value
    field.setSelectionRange(previous.caret, previous.caret)
    onChange(previous.value)
  }

  function redo(field: HTMLTextAreaElement): void {
    const next = redoStackRef.current.pop()
    if (!next) return
    undoStackRef.current.push({
      value: field.value,
      caret: field.selectionStart,
    })
    field.value = next.value
    field.setSelectionRange(next.caret, next.caret)
    onChange(next.value)
  }

  function combinedCount(): { count: number; explicit: boolean } {
    const c1 = pending.count === '' ? undefined : Number(pending.count)
    const c2 =
      pending.operatorCount === '' ? undefined : Number(pending.operatorCount)
    return {
      count: (c1 ?? 1) * (c2 ?? 1),
      explicit: c1 !== undefined || c2 !== undefined,
    }
  }

  /** Finishes an operator: `y` just updates the register and moves the
   * caret to the range's start; `d`/`c` cut the range, and `c` drops into
   * insert mode afterward. Always clears `pending`. */
  function finishOperator(
    field: HTMLTextAreaElement,
    result: EditResult,
  ): void {
    if (pending.operator === 'y') {
      if (result.register) registerRef.current = result.register
      moveCaret(field, result.caret)
    } else {
      commit(field, result)
      if (pending.operator === 'c') setMode('insert')
    }
    setPending(EMPTY_PENDING)
  }

  function finishOperatorRange(
    field: HTMLTextAreaElement,
    key: string,
    target: number,
  ): void {
    const { start, end } = operatorRange(field.selectionStart, target, key)
    finishOperator(
      field,
      applyRangeOperator(field.value, pending.operator ?? 'y', start, end),
    )
  }

  function applyVisualSelection(
    field: HTMLTextAreaElement,
    kind: VisualKind,
  ): void {
    const range = visualRef.current
    if (!range) return
    const value = field.value
    const lo = Math.min(range.anchor, range.head)
    const hi = Math.max(range.anchor, range.head)
    if (kind === 'visual-line') {
      field.setSelectionRange(
        lineBounds(value, lo).start,
        lineBounds(value, hi).end,
      )
    } else {
      // visual-block is approximated as a charwise span — see the hook's
      // doc comment.
      field.setSelectionRange(lo, Math.min(hi + 1, value.length))
    }
  }

  function enterVisual(field: HTMLTextAreaElement, kind: VisualKind): void {
    const pos = field.selectionStart
    visualRef.current = { anchor: pos, head: pos }
    setMode(kind)
    applyVisualSelection(field, kind)
  }

  /** `d`/`x`/`y`/`c` while a visual selection is active: cut or copy the
   * highlighted span and return to normal (or insert, for `c`). */
  function applyVisualOperator(
    field: HTMLTextAreaElement,
    kind: VisualKind,
    operator: Operator,
  ): void {
    const range = visualRef.current
    if (!range) return
    const value = field.value
    const lo = Math.min(range.anchor, range.head)
    const hi = Math.max(range.anchor, range.head)
    const result =
      kind === 'visual-line'
        ? applyLinewiseOperator(value, operator, lo, hi)
        : applyCharwiseVisual(value, lo, hi, operator)

    visualRef.current = null
    if (operator === 'y') {
      if (result.register) registerRef.current = result.register
      setMode('normal')
      moveCaret(field, result.caret)
      return
    }
    commit(field, result)
    setMode(operator === 'c' ? 'insert' : 'normal')
  }

  function runCommandLine(field: HTMLTextAreaElement): void {
    if (commandLine) {
      if (commandLine.trigger === ':') {
        const line = Number(commandLine.buffer)
        if (Number.isInteger(line) && line > 0) {
          moveCaret(
            field,
            firstNonBlank(field.value, offsetOfLine(field.value, line)),
          )
        }
      } else {
        const direction = commandLine.trigger === '/' ? 1 : -1
        const term = commandLine.buffer
        if (term) {
          lastSearchRef.current = { term, direction }
          const target = searchFrom(
            field.value,
            field.selectionStart,
            term,
            direction,
          )
          if (target !== null) moveCaret(field, target)
        }
      }
    }
    setCommandLine(null)
    setMode('normal')
  }

  /** `gg`/`G` (bare, or as an operator's motion): jumps to line `count`
   * when a count was typed, otherwise to the first line (`gg`) or last
   * (`G`). */
  function jumpToLine(field: HTMLTextAreaElement, key: 'g' | 'G'): void {
    const { count, explicit } = combinedCount()
    const line = explicit ? count : key === 'g' ? 1 : lineCount(field.value)
    const target = firstNonBlank(field.value, offsetOfLine(field.value, line))
    if (pending.operator) {
      finishOperator(
        field,
        applyLinewiseOperator(
          field.value,
          pending.operator,
          field.selectionStart,
          target,
        ),
      )
    } else {
      moveCaret(field, target)
      setPending(EMPTY_PENDING)
    }
  }

  function handleAwaitingFind(field: HTMLTextAreaElement, char: string): void {
    const type = pending.awaitingFind
    if (!type) return
    lastFindRef.current = { type, char }
    const target = resolveFind(field.value, field.selectionStart, type, char)
    if (target === null) {
      setPending(EMPTY_PENDING)
      return
    }
    if (pending.operator) {
      finishOperatorRange(field, type, target)
    } else {
      moveCaret(field, target)
      setPending(EMPTY_PENDING)
    }
  }

  function handleTextObject(field: HTMLTextAreaElement, key: string): void {
    if (key !== 'w') {
      setPending(EMPTY_PENDING)
      return
    }
    const { start, end } = innerWordRange(
      field.value,
      field.selectionStart,
      pending.textObject === 'a',
    )
    finishOperator(
      field,
      applyRangeOperator(field.value, pending.operator ?? 'y', start, end),
    )
  }

  function handleAwaitingG(field: HTMLTextAreaElement, key: string): void {
    if (key === 'g') jumpToLine(field, 'g')
    else setPending(EMPTY_PENDING)
  }

  function handleOperatorPending(
    field: HTMLTextAreaElement,
    key: string,
  ): void {
    if (key === pending.operator) {
      const { count } = combinedCount()
      const { operator } = pending
      const value = field.value
      const pos = field.selectionStart
      const result =
        operator === 'd'
          ? deleteLines(value, pos, count)
          : operator === 'y'
            ? yankLines(value, pos, count)
            : changeLines(value, pos, count)
      finishOperator(field, result)
      return
    }
    if (key === 'i' || key === 'a') {
      setPending({ ...pending, textObject: key })
      return
    }
    if (key === 'g') {
      setPending({ ...pending, awaitingG: true })
      return
    }
    if (key === 'G') {
      jumpToLine(field, 'G')
      return
    }
    if (key === 'f' || key === 'F' || key === 't' || key === 'T') {
      setPending({ ...pending, awaitingFind: key })
      return
    }
    if (pending.operator === 'c' && (key === 'w' || key === 'W')) {
      // vim's well-known cw/cW quirk: from a non-blank character, it
      // changes to the end of the word (like `ce`) instead of consuming
      // the word's trailing whitespace the way `dw` would. From a blank,
      // it falls through to the ordinary word-forward motion below.
      const value = field.value
      const pos = field.selectionStart
      if (!/\s/.test(value[pos] ?? '')) {
        const { count } = combinedCount()
        let target = pos
        for (let i = 0; i < count; i += 1)
          target = wordEnd(value, target, key === 'W')
        finishOperatorRange(field, 'e', target) // reuse `e`'s inclusive rule
        return
      }
    }
    const { count } = combinedCount()
    const motion = resolveMotion(field.value, field.selectionStart, key, count)
    if (motion) finishOperatorRange(field, key, motion.target)
    else setPending(EMPTY_PENDING)
  }

  function handleFreshNormalKey(field: HTMLTextAreaElement, key: string): void {
    switch (key) {
      case 'i':
        setMode('insert')
        break
      case 'a':
        setMode('insert')
        moveCaret(
          field,
          Math.min(
            field.selectionStart + 1,
            lineBounds(field.value, field.selectionStart).end,
          ),
        )
        break
      case 'I':
        setMode('insert')
        moveCaret(field, firstNonBlank(field.value, field.selectionStart))
        break
      case 'A':
        setMode('insert')
        moveCaret(field, lineBounds(field.value, field.selectionStart).end)
        break
      case 'o':
        commit(field, openLineBelow(field.value, field.selectionStart))
        setMode('insert')
        break
      case 'O':
        commit(field, openLineAbove(field.value, field.selectionStart))
        setMode('insert')
        break
      case 'v':
        enterVisual(field, 'visual')
        break
      case 'V':
        enterVisual(field, 'visual-line')
        break
      case ':':
        setCommandLine({ trigger: ':', buffer: '' })
        setMode('command')
        break
      case '/':
        setCommandLine({ trigger: '/', buffer: '' })
        setMode('search')
        break
      case '?':
        setCommandLine({ trigger: '?', buffer: '' })
        setMode('search')
        break
      case 'x':
        commit(
          field,
          deleteChars(field.value, field.selectionStart, combinedCount().count),
        )
        break
      case 'p':
      case 'P':
        if (registerRef.current) {
          commit(
            field,
            paste(
              field.value,
              field.selectionStart,
              registerRef.current,
              key === 'p',
            ),
          )
        }
        break
      case 'u':
        undo(field)
        break
      case 'd':
      case 'c':
      case 'y':
        setPending({ ...pending, operator: key, operatorCount: '' })
        return // keep the accumulated count; awaiting the motion next
      case 'g':
        setPending({ ...pending, awaitingG: true })
        return
      case 'G':
        jumpToLine(field, 'G')
        return
      case 'f':
      case 'F':
      case 't':
      case 'T':
        setPending({ ...pending, awaitingFind: key })
        return
      case ';':
      case ',': {
        const last = lastFindRef.current
        if (last) {
          const type = key === ';' ? last.type : flipFind(last.type)
          const target = resolveFind(
            field.value,
            field.selectionStart,
            type,
            last.char,
          )
          if (target !== null) moveCaret(field, target)
        }
        break
      }
      case 'n':
      case 'N': {
        const last = lastSearchRef.current
        if (last) {
          const direction =
            key === 'n' ? last.direction : (-last.direction as 1 | -1)
          const target = searchFrom(
            field.value,
            field.selectionStart,
            last.term,
            direction,
          )
          if (target !== null) moveCaret(field, target)
        }
        break
      }
      default: {
        const motion = resolveMotion(
          field.value,
          field.selectionStart,
          key,
          combinedCount().count,
        )
        if (motion) moveCaret(field, motion.target)
      }
    }
    setPending(EMPTY_PENDING)
  }

  function handleNormalKey(field: HTMLTextAreaElement, key: string): void {
    if (key === 'Escape') {
      setPending(EMPTY_PENDING)
      return
    }
    if (pending.awaitingFind) {
      handleAwaitingFind(field, key)
      return
    }
    if (pending.textObject) {
      handleTextObject(field, key)
      return
    }
    if (pending.awaitingG) {
      handleAwaitingG(field, key)
      return
    }
    const countBuffer = pending.operator ? pending.operatorCount : pending.count
    if (/^[0-9]$/.test(key) && !(key === '0' && countBuffer === '')) {
      setPending(
        pending.operator
          ? { ...pending, operatorCount: pending.operatorCount + key }
          : { ...pending, count: pending.count + key },
      )
      return
    }
    if (pending.operator) {
      handleOperatorPending(field, key)
      return
    }
    handleFreshNormalKey(field, key)
  }

  function handleCtrlKey(field: HTMLTextAreaElement, key: string): void {
    if (key === 'r') {
      redo(field)
      return
    }
    if (key === 'v') {
      enterVisual(field, 'visual-block')
      return
    }
    const lineHeight = parseFloat(window.getComputedStyle(field).lineHeight)
    const visibleLines =
      lineHeight > 0 && field.clientHeight > 0
        ? Math.max(1, Math.floor(field.clientHeight / lineHeight))
        : 20
    const half = Math.max(1, Math.floor(visibleLines / 2))
    if (key === 'd')
      moveCaret(field, moveByLines(field.value, field.selectionStart, half))
    else if (key === 'u')
      moveCaret(field, moveByLines(field.value, field.selectionStart, -half))
    else if (key === 'f')
      moveCaret(
        field,
        moveByLines(field.value, field.selectionStart, visibleLines),
      )
    else if (key === 'b')
      moveCaret(
        field,
        moveByLines(field.value, field.selectionStart, -visibleLines),
      )
  }

  function handleVisualKey(
    field: HTMLTextAreaElement,
    kind: VisualKind,
    key: string,
    ctrlKey: boolean,
  ): void {
    const range = visualRef.current
    if (!range) {
      setMode('normal')
      return
    }
    if (pending.awaitingG) {
      setPending(EMPTY_PENDING)
      if (key === 'g') {
        const target = firstNonBlank(field.value, offsetOfLine(field.value, 1))
        visualRef.current = { anchor: range.anchor, head: target }
        applyVisualSelection(field, kind)
      }
      return
    }
    if (key === 'g') {
      setPending({ ...pending, awaitingG: true })
      return
    }
    if (key === 'G') {
      const target = firstNonBlank(
        field.value,
        offsetOfLine(field.value, lineCount(field.value)),
      )
      visualRef.current = { anchor: range.anchor, head: target }
      applyVisualSelection(field, kind)
      return
    }
    if (
      key === 'Escape' ||
      (key === 'v' && !ctrlKey && kind === 'visual') ||
      (key === 'V' && kind === 'visual-line') ||
      (key === 'v' && ctrlKey && kind === 'visual-block')
    ) {
      visualRef.current = null
      setMode('normal')
      moveCaret(field, range.head)
      return
    }
    if (key === 'v' && ctrlKey) {
      setMode('visual-block')
      applyVisualSelection(field, 'visual-block')
      return
    }
    if (key === 'v') {
      setMode('visual')
      applyVisualSelection(field, 'visual')
      return
    }
    if (key === 'V') {
      setMode('visual-line')
      applyVisualSelection(field, 'visual-line')
      return
    }
    if (key === 'd' || key === 'x') {
      applyVisualOperator(field, kind, 'd')
      return
    }
    if (key === 'y') {
      applyVisualOperator(field, kind, 'y')
      return
    }
    if (key === 'c') {
      applyVisualOperator(field, kind, 'c')
      return
    }
    const motion = resolveMotion(field.value, range.head, key, 1)
    if (motion) {
      visualRef.current = { anchor: range.anchor, head: motion.target }
      applyVisualSelection(field, kind)
    }
  }

  function handleKeyDown(
    event: React.KeyboardEvent<HTMLTextAreaElement>,
  ): void {
    if (!enabled) return
    const field = event.currentTarget
    const key = event.key

    // The ':'/'/'/'?' prompt: every key edits its buffer directly.
    if (mode === 'command' || mode === 'search') {
      event.preventDefault()
      if (key === 'Escape') {
        setCommandLine(null)
        setMode('normal')
      } else if (key === 'Enter') {
        runCommandLine(field)
      } else if (key === 'Backspace') {
        setCommandLine((cl) =>
          cl ? { ...cl, buffer: cl.buffer.slice(0, -1) } : cl,
        )
      } else if (
        key.length === 1 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        setCommandLine((cl) => (cl ? { ...cl, buffer: cl.buffer + key } : cl))
      }
      return
    }

    if (mode === 'insert') {
      if (key === 'Escape') {
        event.preventDefault()
        const pos = Math.max(
          field.selectionStart - 1,
          lineBounds(field.value, field.selectionStart).start,
        )
        setMode('normal')
        moveCaret(field, pos)
      }
      return
    }

    if (
      mode === 'visual' ||
      mode === 'visual-line' ||
      mode === 'visual-block'
    ) {
      if (event.altKey || event.metaKey) return
      if (event.ctrlKey && key !== 'v') return
      event.preventDefault()
      handleVisualKey(field, mode, key, event.ctrlKey)
      return
    }

    // Normal mode from here down.
    if (event.altKey || event.metaKey) return
    if (event.ctrlKey) {
      if (
        key === 'd' ||
        key === 'u' ||
        key === 'f' ||
        key === 'b' ||
        key === 'r' ||
        key === 'v'
      ) {
        event.preventDefault()
        handleCtrlKey(field, key)
      }
      return
    }

    event.preventDefault()
    handleNormalKey(field, key)
  }

  const statusText = `-- ${MODE_LABEL[mode]} --${pendingKeysLabel(pending)}`

  return {
    enabled,
    mode,
    statusText,
    commandLine: commandLine ? commandLine.trigger + commandLine.buffer : null,
    toggleEnabled,
    handleKeyDown,
  }
}

function pendingKeysLabel(pending: Pending): string {
  const keys =
    pending.count +
    (pending.operator ?? '') +
    pending.operatorCount +
    (pending.textObject ?? '') +
    (pending.awaitingG ? 'g' : '') +
    (pending.awaitingFind ?? '')
  return keys ? ` ${keys}` : ''
}
