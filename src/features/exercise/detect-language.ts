import { SANDBOX_LANGUAGES, type SandboxLanguage } from '#/lib/sandbox/types'

type Signal = { language: SandboxLanguage; pattern: RegExp; weight: number }

// Small set of high-signal, low-ambiguity tokens per language — enough to
// tell rust/go/python apart on a short pasted snippet without pulling in a
// real parser. Deliberately scoped to `SANDBOX_LANGUAGES`: those are the
// only grammars `useCodeHighlight` bundles and the only languages the
// sandbox can run, so a prediction outside that set would be a dead end
// either way.
const SIGNALS: Signal[] = [
  { language: 'rust', pattern: /\bfn\s+\w+\s*\(/, weight: 2 },
  { language: 'rust', pattern: /\blet\s+mut\b/, weight: 2 },
  {
    language: 'rust',
    pattern: /\b(?:impl|trait|struct|enum)\s+\w+/,
    weight: 2,
  },
  { language: 'rust', pattern: /\bprintln!\s*\(/, weight: 3 },
  { language: 'rust', pattern: /->\s*\w/, weight: 1 },
  { language: 'rust', pattern: /::</, weight: 1 },

  { language: 'go', pattern: /\bfunc\s+\w+\s*\(/, weight: 2 },
  { language: 'go', pattern: /\bpackage\s+main\b/, weight: 3 },
  { language: 'go', pattern: /:=/, weight: 2 },
  { language: 'go', pattern: /\bfmt\.(?:Print|Sprint|Errorf)/, weight: 2 },

  { language: 'python', pattern: /^\s*def\s+\w+\(.*\):/m, weight: 3 },
  { language: 'python', pattern: /^\s*(?:import|from)\s+\w+/m, weight: 1 },
  { language: 'python', pattern: /\bprint\(/, weight: 1 },
  { language: 'python', pattern: /\bself\b/, weight: 1 },
  { language: 'python', pattern: /\belif\b/, weight: 2 },
]

/**
 * Guesses which sandbox language a pasted snippet is written in (Tactical
 * Sprint's paste box — the caller doesn't know the language ahead of time
 * the way the exercise page always does). Scores a handful of high-signal
 * patterns per language and returns the best match; falls back to `rust`,
 * the only language wired end-to-end today (ADR-0011), when the snippet is
 * empty or nothing scores. A prediction, not a parse — callers show it as
 * one and let the learner override it.
 */
export function detectLanguage(code: string): SandboxLanguage {
  const trimmed = code.trim()
  if (!trimmed) return 'rust'

  const scores: Record<SandboxLanguage, number> = {
    rust: 0,
    go: 0,
    python: 0,
  }
  for (const { language, pattern, weight } of SIGNALS) {
    if (pattern.test(trimmed)) scores[language] += weight
  }

  let best: SandboxLanguage = 'rust'
  let bestScore = 0
  for (const language of SANDBOX_LANGUAGES) {
    if (scores[language] > bestScore) {
      best = language
      bestScore = scores[language]
    }
  }
  return best
}
