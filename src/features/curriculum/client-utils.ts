/** Extracts a safe message from a server-function rejection. */
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }
  return fallback
}

/** A run of inline markdown within a heading, paragraph, or list item. */
export type LessonInlineSegment =
  | { type: 'text'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'code'; text: string }

/**
 * Splits a line of prose into plain text, `**bold**`, and `` `code` ``
 * spans, in reading order, so the UI can render each as its own element
 * instead of leaving the literal markdown markup in the sentence. Markers
 * don't nest — a bold span's contents aren't re-scanned for inline code —
 * which matches how generated explanations actually use them (identifiers
 * in code spans, emphasis in bold, never both on the same word).
 */
export function splitInlineSegments(text: string): LessonInlineSegment[] {
  const segments: LessonInlineSegment[] = []
  const pattern = /\*\*([^*\n]+)\*\*|`([^`\n]+)`/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', text: text.slice(lastIndex, match.index) })
    }
    if (match[1] !== undefined) {
      segments.push({ type: 'bold', text: match[1] })
    } else {
      segments.push({ type: 'code', text: match[2] ?? '' })
    }
    lastIndex = pattern.lastIndex
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', text: text.slice(lastIndex) })
  }
  return segments
}

/** A block-level piece of a generated lesson explanation, in reading order. */
export type LessonBlock =
  | { type: 'heading'; level: 2 | 3; segments: LessonInlineSegment[] }
  | { type: 'list'; items: LessonInlineSegment[][] }
  | { type: 'paragraph'; segments: LessonInlineSegment[] }
  | { type: 'code'; language: string | null; code: string }

const FENCE_PATTERN = /^```(\w+)?\s*$/
const HEADING_PATTERN = /^(#{1,6})\s+(.*)$/
const LIST_ITEM_PATTERN = /^[-*]\s+(.*)$/

/**
 * Parses a generated lesson explanation into ordered blocks — headings,
 * paragraphs, lists, and fenced code — so the UI can render the markdown
 * structure the AI Teacher was asked to produce (see
 * `explain-concept.prompt.ts`) with real text hierarchy instead of dumping
 * every line into one paragraph. This is a deliberately small, known
 * subset of markdown (headings, `-`/`*` lists, fenced code, `**bold**`,
 * `` `code` `` spans) rather than a general parser: it's the shape the
 * prompt asks the model for, not arbitrary markdown input.
 */
export function parseLessonBlocks(explanation: string): LessonBlock[] {
  const blocks: LessonBlock[] = []
  const lines = explanation.replace(/\r\n/g, '\n').split('\n')
  let paragraphLines: string[] = []

  function flushParagraph(): void {
    const text = paragraphLines.join('\n').trim()
    paragraphLines = []
    if (text.length > 0) {
      blocks.push({ type: 'paragraph', segments: splitInlineSegments(text) })
    }
  }

  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''

    const fenceMatch = FENCE_PATTERN.exec(line.trim())
    if (fenceMatch) {
      flushParagraph()
      const codeLines: string[] = []
      index++
      while (index < lines.length && lines[index]?.trim() !== '```') {
        codeLines.push(lines[index] ?? '')
        index++
      }
      index++ // skip the closing fence (or run past the end if unterminated)
      blocks.push({
        type: 'code',
        language: fenceMatch[1] ?? null,
        code: codeLines.join('\n'),
      })
      continue
    }

    const headingMatch = HEADING_PATTERN.exec(line)
    if (headingMatch) {
      flushParagraph()
      const hashes = headingMatch[1]?.length ?? 2
      blocks.push({
        type: 'heading',
        // Clamp to two visual levels — the panel's own h1 already carries
        // the concept title, so generated headings never need to go higher.
        level: hashes <= 2 ? 2 : 3,
        segments: splitInlineSegments((headingMatch[2] ?? '').trim()),
      })
      index++
      continue
    }

    const listMatch = LIST_ITEM_PATTERN.exec(line)
    if (listMatch) {
      flushParagraph()
      const items = [splitInlineSegments((listMatch[1] ?? '').trim())]
      index++
      let nextMatch = LIST_ITEM_PATTERN.exec(lines[index] ?? '')
      while (nextMatch) {
        items.push(splitInlineSegments((nextMatch[1] ?? '').trim()))
        index++
        nextMatch = LIST_ITEM_PATTERN.exec(lines[index] ?? '')
      }
      blocks.push({ type: 'list', items })
      continue
    }

    if (line.trim().length === 0) {
      flushParagraph()
      index++
      continue
    }

    paragraphLines.push(line)
    index++
  }
  flushParagraph()

  return blocks
}
