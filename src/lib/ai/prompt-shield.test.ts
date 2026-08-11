import { describe, expect, it } from 'vitest'

import {
  PROMPT_SHIELD_LEVEL4_RATIO,
  PROMPT_SHIELD_TOKEN_FLOOR,
  checkPromptShield,
  collapseWhitespace,
  longestInOrderRun,
  normalizeAndTokenize,
  shieldThresholdTokens,
  stripComments,
  tokenize,
} from './prompt-shield'

/** The seeded rust-is-even reference solution, verbatim. */
const RUST_REFERENCE = `pub fn is_even(n: u32) -> bool {
    n % 2 == 0
}
`

/** A short solution used for the renamed-variable non-catch fixture. */
const SHORT_REFERENCE = 'return n % 2 == 0'

/** The categorical non-code hint levels (ADR-0012's near-zero tier). */
const NON_CODE_LEVELS = [0, 1, 2, 3] as const

describe('stripComments', () => {
  it('strips line comments for Rust and Go', () => {
    expect(stripComments('let x = 1; // set x\nlet y = 2;', 'rust')).toBe(
      'let x = 1; \nlet y = 2;',
    )
    expect(stripComments('x := 1 // set x', 'go')).toBe('x := 1 ')
  })

  it('strips block comments for Rust and Go', () => {
    expect(stripComments('/* header */\nlet x = 1;', 'rust')).toBe(
      '\nlet x = 1;',
    )
    expect(stripComments('let x = 1; /* multi\nline */ let y = 2;', 'go')).toBe(
      'let x = 1;  let y = 2;',
    )
  })

  it('strips hash comments for Python', () => {
    expect(stripComments('x = 1  # set x', 'python')).toBe('x = 1  ')
    expect(stripComments('# header\nx = 1', 'python')).toBe('\nx = 1')
  })
})

describe('collapseWhitespace', () => {
  it('collapses all whitespace runs to one space', () => {
    expect(collapseWhitespace('a\n\t  b \n c')).toBe('a b c')
  })
})

describe('tokenize', () => {
  it('splits runs of letters/digits as one token and other chars individually', () => {
    expect(tokenize('n % 2 == 0')).toEqual(['n', '%', '2', '=', '=', '0'])
    expect(tokenize('is_even(n: u32)')).toEqual([
      'is',
      '_',
      'even',
      '(',
      'n',
      ':',
      'u32',
      ')',
    ])
  })

  it('drops whitespace entirely', () => {
    expect(tokenize(' a\t b')).toEqual(['a', 'b'])
  })
})

describe('normalizeAndTokenize', () => {
  it('normalizes and tokenizes a comment-laden source', () => {
    expect(
      normalizeAndTokenize(
        'pub fn is_even(n: u32) -> bool { // check\n    n % 2 == 0 }',
        'rust',
      ),
    ).toEqual([
      'pub',
      'fn',
      'is',
      '_',
      'even',
      '(',
      'n',
      ':',
      'u32',
      ')',
      '-',
      '>',
      'bool',
      '{',
      'n',
      '%',
      '2',
      '=',
      '=',
      '0',
      '}',
    ])
  })

  it('strips Python comments before tokenizing', () => {
    expect(normalizeAndTokenize('return n % 2 == 0  # done', 'python')).toEqual(
      ['return', 'n', '%', '2', '=', '=', '0'],
    )
  })
})

describe('longestInOrderRun', () => {
  it('counts a verbatim solution copy', () => {
    const solution = normalizeAndTokenize(SHORT_REFERENCE, 'python')
    const response = normalizeAndTokenize(SHORT_REFERENCE, 'python')
    expect(longestInOrderRun(response, solution)).toBe(7)
  })

  it('counts the same after whitespace-only differences', () => {
    const solution = normalizeAndTokenize(SHORT_REFERENCE, 'python')
    const response = normalizeAndTokenize('return\t n  %   2 == 0', 'python')
    expect(longestInOrderRun(response, solution)).toBe(7)
  })

  it('counts the same after comment differences', () => {
    const solution = normalizeAndTokenize(SHORT_REFERENCE, 'python')
    const response = normalizeAndTokenize(
      '# even check\nreturn n % 2 == 0',
      'python',
    )
    expect(longestInOrderRun(response, solution)).toBe(7)
  })

  it('counts only the fragment left by a renamed variable', () => {
    const solution = normalizeAndTokenize(SHORT_REFERENCE, 'python')
    const response = normalizeAndTokenize('return x % 2 == 0', 'python')
    expect(longestInOrderRun(response, solution)).toBe(5)
  })

  it('does not accumulate scattered tokens that are not contiguous in the response', () => {
    const solution = normalizeAndTokenize('a b c d', 'python')
    const response = normalizeAndTokenize('a c', 'python')
    expect(longestInOrderRun(response, solution)).toBe(1)
  })
})

describe('shieldThresholdTokens', () => {
  it('uses near-zero tolerance (floor alone) at levels 0-3', () => {
    for (const level of NON_CODE_LEVELS) {
      expect(shieldThresholdTokens(level, 19)).toBe(PROMPT_SHIELD_TOKEN_FLOOR)
    }
  })

  it('adds the level-4 ratio as a percentage of the solution length', () => {
    expect(shieldThresholdTokens(4, 19)).toBe(
      Math.max(
        PROMPT_SHIELD_TOKEN_FLOOR,
        Math.round(19 * PROMPT_SHIELD_LEVEL4_RATIO),
      ),
    )
  })

  it('never exceeds the solution length, so a verbatim copy always blocks (issue #64)', () => {
    for (const level of [...NON_CODE_LEVELS, 4]) {
      expect(shieldThresholdTokens(level, 5)).toBe(5)
      expect(shieldThresholdTokens(level, 3)).toBe(3)
      expect(shieldThresholdTokens(level, 6)).toBe(PROMPT_SHIELD_TOKEN_FLOOR)
    }
  })

  it('keeps the floor for an empty solution (degenerate input)', () => {
    expect(shieldThresholdTokens(0, 0)).toBe(PROMPT_SHIELD_TOKEN_FLOOR)
    expect(shieldThresholdTokens(4, 0)).toBe(PROMPT_SHIELD_TOKEN_FLOOR)
  })

  it('never blocks level 5', () => {
    expect(shieldThresholdTokens(5, 19)).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('checkPromptShield', () => {
  it('blocks a verbatim solution copy at levels 0-3', () => {
    for (const level of NON_CODE_LEVELS) {
      expect(
        checkPromptShield({
          content: RUST_REFERENCE,
          referenceSolution: RUST_REFERENCE,
          language: 'rust',
          hintLevel: level,
        }),
      ).toBe('block')
    }
  })

  it('blocks a whitespace-only variant of the solution', () => {
    expect(
      checkPromptShield({
        content: 'pub fn is_even(n:u32)->bool{n%2==0}',
        referenceSolution: RUST_REFERENCE,
        language: 'rust',
        hintLevel: 2,
      }),
    ).toBe('block')
  })

  it('blocks a comment-differing variant of the solution', () => {
    expect(
      checkPromptShield({
        content:
          'pub fn is_even(n: u32) -> bool { // is it even?\n    n % 2 == 0 /* the trick */\n}',
        referenceSolution: RUST_REFERENCE,
        language: 'rust',
        hintLevel: 2,
      }),
    ).toBe('block')
  })

  it('passes a renamed-variable variant (explicit non-catch case)', () => {
    expect(
      checkPromptShield({
        content: 'return x % 2 == 0',
        referenceSolution: SHORT_REFERENCE,
        language: 'python',
        hintLevel: 2,
      }),
    ).toBe('pass')
  })

  it('blocks a Level 5 answer embedded inside a Level 2 hint (PRD story 36)', () => {
    expect(
      checkPromptShield({
        content:
          'Think about whether the remainder is zero, like in `n % 2 == 0`.',
        referenceSolution: RUST_REFERENCE,
        language: 'rust',
        hintLevel: 2,
      }),
    ).toBe('block')
  })

  it('blocks a verbatim copy of a short (< floor) solution at levels 0-3 (issue #64)', () => {
    const shortSolution = 'return true'
    for (const level of NON_CODE_LEVELS) {
      expect(
        checkPromptShield({
          content: shortSolution,
          referenceSolution: shortSolution,
          language: 'python',
          hintLevel: level,
        }),
      ).toBe('block')
    }
  })

  it('passes a single shared keyword or short common phrase', () => {
    expect(
      checkPromptShield({
        content: 'Does is_even need to handle 0?',
        referenceSolution: RUST_REFERENCE,
        language: 'rust',
        hintLevel: 2,
      }),
    ).toBe('pass')
  })

  it('allows partial code at level 4 up to the tolerance', () => {
    const partial = 'Check whether `n % 2 == 0` is the condition you need.'
    expect(
      checkPromptShield({
        content: partial,
        referenceSolution: RUST_REFERENCE,
        language: 'rust',
        hintLevel: 4,
      }),
    ).toBe('pass')
  })

  it('blocks a near-complete match at level 4', () => {
    const nearComplete = 'pub fn is_even(n: u32) -> bool { n % 2 == 0 }'
    expect(
      checkPromptShield({
        content: nearComplete,
        referenceSolution: RUST_REFERENCE,
        language: 'rust',
        hintLevel: 4,
      }),
    ).toBe('block')
  })

  it('never blocks level 5, even for the verbatim solution', () => {
    expect(
      checkPromptShield({
        content: RUST_REFERENCE,
        referenceSolution: RUST_REFERENCE,
        language: 'rust',
        hintLevel: 5,
      }),
    ).toBe('pass')
  })

  it('works identically across all three v1 languages', () => {
    const goReference = `package exercise

func IsEven(n uint32) bool {
	return n%2 == 0
}
`
    const pythonReference = `def is_even(n: int) -> bool:
    return n % 2 == 0
`
    expect(
      checkPromptShield({
        content: goReference,
        referenceSolution: goReference,
        language: 'go',
        hintLevel: 2,
      }),
    ).toBe('block')
    expect(
      checkPromptShield({
        content: pythonReference,
        referenceSolution: pythonReference,
        language: 'python',
        hintLevel: 2,
      }),
    ).toBe('block')
  })

  it('passes when the response carries no solution tokens', () => {
    expect(
      checkPromptShield({
        content: 'What does the modulo operator do?',
        referenceSolution: RUST_REFERENCE,
        language: 'rust',
        hintLevel: 1,
      }),
    ).toBe('pass')
  })

  it('passes on an empty reference solution (degenerate input)', () => {
    expect(
      checkPromptShield({
        content: 'Any text at all.',
        referenceSolution: '',
        language: 'python',
        hintLevel: 0,
      }),
    ).toBe('pass')
  })
})
