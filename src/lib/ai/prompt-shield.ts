import {
  HINT_LADDER_MANUAL_MAX_LEVEL,
  HINT_LADDER_MAX_LEVEL,
} from '#/lib/hint-levels'
import type { SandboxLanguage } from '#/lib/sandbox/types'

/**
 * Prompt Shield leakage check (ADR-0008, ADR-0012): a deterministic,
 * language-agnostic comparison of AI Teacher output against the
 * Pre-Flight-verified reference solution, gated by hint level. No LLM call,
 * no edit distance, no AST comparison.
 *
 * The algorithm, per ADR-0012:
 * - Both texts are normalized (whitespace collapsed, comments stripped) by
 *   one shared lexer before comparing.
 * - The lexer is minimal and language-agnostic: runs of letters/digits are
 *   one token, every other character is its own token. No per-language
 *   keyword or grammar classification.
 * - The check scans for any contiguous fragment of the response that
 *   reproduces, in order, a contiguous fragment of the reference solution.
 *   Closeness is token overlap: how many of the solution fragment's tokens
 *   appear, in order, in the response's token stream.
 * - The block threshold is a percentage of that exercise's own
 *   reference-solution length, with a small absolute floor, applied
 *   two-tier: near-zero tolerance at Levels 0-3, a much higher tolerance
 *   (~45% starting point) at Level 4. Level 5 is unchecked — the learner
 *   has explicitly opted into the full solution.
 * - The check is per-hint only; nothing is tracked across hints in an
 *   attempt (accepted v1 gap, ADR-0012).
 *
 * Known accepted v1 gaps (ADR-0012): renamed-identifier evasion (no
 * identifier normalization), cumulative leakage across repeated same-level
 * requests, and general paraphrase/restructuring.
 */

/** Small absolute floor in tokens (ADR-0012: "a handful of tokens"). */
export const PROMPT_SHIELD_TOKEN_FLOOR = 6

/** Level 4 tolerance starting point, as a fraction of the solution length. */
export const PROMPT_SHIELD_LEVEL4_RATIO = 0.45

/** The Level 5 hint level, which the shield never blocks. */
export const PROMPT_SHIELD_UNCHECKED_LEVEL = HINT_LADDER_MAX_LEVEL

/** Verdict of one prompt-shield check. */
export type PromptShieldVerdict = 'pass' | 'block'

/**
 * Strips comments from source text per the language's delimiters: line
 * comments and block comments for Rust and Go, `#` line comments for
 * Python. Deliberately not string-aware — the ADR's normalization is
 * whitespace/comments only, with no per-language parsing tooling.
 */
export function stripComments(
  source: string,
  language: SandboxLanguage,
): string {
  const lineComment = language === 'python' ? '#' : '//'
  let stripped = source
  if (language !== 'python') {
    stripped = stripped.replace(/\/\*[\s\S]*?\*\//g, '')
  }
  return stripped
    .split('\n')
    .map((line) => {
      const index = line.indexOf(lineComment)
      return index === -1 ? line : line.slice(0, index)
    })
    .join('\n')
}

/** Collapses all whitespace runs to a single space (ADR-0012). */
export function collapseWhitespace(source: string): string {
  return source.replace(/\s+/g, ' ')
}

/**
 * The shared, language-agnostic lexer (ADR-0012, ADR-0003): runs of
 * letters/digits form one token; every other character is its own token;
 * whitespace is not a token. Both the response and the solution are split
 * with this same lexer, so comparisons never depend on a language's
 * keyword set or grammar.
 */
export function tokenize(source: string): string[] {
  const tokens: string[] = []
  let i = 0
  while (i < source.length) {
    const char = source[i]
    if (char === undefined) break
    if (/\s/.test(char)) {
      i += 1
      continue
    }
    if (/[A-Za-z0-9]/.test(char)) {
      let end = i
      while (end < source.length && /[A-Za-z0-9]/.test(source[end] ?? '')) {
        end += 1
      }
      tokens.push(source.slice(i, end))
      i = end
    } else {
      tokens.push(char)
      i += 1
    }
  }
  return tokens
}

/** Normalizes and tokenizes a text with the shared pipeline (ADR-0012). */
export function normalizeAndTokenize(
  source: string,
  language: SandboxLanguage,
): string[] {
  return tokenize(collapseWhitespace(stripComments(source, language)))
}

/**
 * The best token-overlap run: the largest number of contiguous solution
 * tokens that appear, in order, in the response's token stream (ADR-0012's
 * fragment-level closeness). Runs of the response may interleave unrelated
 * tokens; a rename only breaks the token groups immediately around it.
 */
export function longestInOrderRun(
  responseTokens: readonly string[],
  solutionTokens: readonly string[],
): number {
  let best = 0
  for (let start = 0; start < solutionTokens.length; start += 1) {
    let responseIndex = 0
    let run = 0
    for (let s = start; s < solutionTokens.length; s += 1) {
      const token = solutionTokens[s]
      let found = -1
      for (let r = responseIndex; r < responseTokens.length; r += 1) {
        if (responseTokens[r] === token) {
          found = r
          break
        }
      }
      if (found === -1) break
      responseIndex = found + 1
      run += 1
    }
    best = Math.max(best, run)
  }
  return best
}

/**
 * The block threshold for one hint level, in solution tokens: a percentage
 * of the solution's own length with the absolute floor as a minimum
 * (ADR-0012). Levels 0-3 use near-zero tolerance (the floor alone); Level 4
 * adds the ratio on top; Level 5 is unchecked.
 */
export function shieldThresholdTokens(
  hintLevel: number,
  solutionTokenCount: number,
): number {
  if (hintLevel >= PROMPT_SHIELD_UNCHECKED_LEVEL) {
    return Number.POSITIVE_INFINITY
  }
  const ratioTokens = Math.round(
    (hintLevel === HINT_LADDER_MANUAL_MAX_LEVEL
      ? PROMPT_SHIELD_LEVEL4_RATIO
      : 0) * solutionTokenCount,
  )
  return Math.max(PROMPT_SHIELD_TOKEN_FLOOR, ratioTokens)
}

/** One prompt-shield comparison over a hint's content. */
export type PromptShieldCheckInput = {
  content: string
  referenceSolution: string
  language: SandboxLanguage
  hintLevel: number
}

/**
 * Runs the deterministic leakage check on one hint response (ADR-0008,
 * ADR-0012). Returns 'block' when the response contains a fragment of the
 * reference solution at or above the level's threshold, 'pass' otherwise.
 * Level 5 is never blocked.
 */
export function checkPromptShield(
  input: PromptShieldCheckInput,
): PromptShieldVerdict {
  const responseTokens = normalizeAndTokenize(input.content, input.language)
  const solutionTokens = normalizeAndTokenize(
    input.referenceSolution,
    input.language,
  )
  const threshold = shieldThresholdTokens(
    input.hintLevel,
    solutionTokens.length,
  )
  const run = longestInOrderRun(responseTokens, solutionTokens)
  return run >= threshold ? 'block' : 'pass'
}
