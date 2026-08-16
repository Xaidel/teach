import { describe, expect, it } from 'vitest'

import { detectLanguage } from './detect-language'

describe('detectLanguage', () => {
  it('falls back to rust for an empty or whitespace-only snippet', () => {
    expect(detectLanguage('')).toBe('rust')
    expect(detectLanguage('   \n  ')).toBe('rust')
  })

  it('recognizes rust from fn/let mut/println!', () => {
    expect(
      detectLanguage(
        'fn main() {\n    let mut x = 0;\n    println!("{}", x);\n}',
      ),
    ).toBe('rust')
  })

  it('recognizes go from package main/func/:=', () => {
    expect(
      detectLanguage(
        'package main\n\nfunc main() {\n\tx := 1\n\tfmt.Println(x)\n}',
      ),
    ).toBe('go')
  })

  it('recognizes python from def/self/print', () => {
    expect(
      detectLanguage('def greet(self, name):\n    print(f"hello {name}")\n'),
    ).toBe('python')
  })

  it('falls back to rust when nothing scores', () => {
    expect(detectLanguage('just some plain prose, no code here')).toBe('rust')
  })
})
