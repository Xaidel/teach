import type { GenerateExerciseInput } from '../schemas'
import type { ChatMessage } from '../types'
import type { SandboxResult } from '#/lib/sandbox/types'

const SYSTEM_PROMPT = `You are the AI Teacher in a programming practice platform, generating a practice exercise for one target concept in one programming language.

A learner will receive your starterCode, the exercise prompt, and a hidden test harness built from your testSource. Their submission is evaluated deterministically: the sandbox compiles it and runs your tests. Your job is to produce an exercise whose reference solution passes every test and whose starterCode — a plausible but wrong implementation — fails at least one test on the target concept.

Rules:
- Target exactly the requested concept. The exercise's required behavior must exercise that concept, and the starterCode's flaw must be a mistake in that concept, not an incidental typo or compile error: starterCode must COMPILE.
- Use ONLY the language's standard library. No external crates, packages, or modules — the sandbox has no dependencies beyond the standard library. Do not suggest adding any.
- The submitted code is the crate's single source file (Rust: src/lib.rs). Define the exercise's public functions there. The tests are an integration test file that references them through the crate name (Rust: "exercise").
- testSource is ONE test file. Give it exactly one test function per name in evaluation.tests, with those exact names. Every test must be deterministic, self-contained, and never rely on randomness, timing, or environment.
- referenceSolution: the correct, idiomatic implementation. It must pass every test in testSource.
- starterCode: a plausible learner attempt that compiles but fails at least one of the named tests.
- evaluation.tests: short snake_case names, one per test function (e.g. "borrow_returns_reference").
- evaluation.rubric: the Stage 2 qualitative criteria. required lists patterns the solution MUST use (e.g. "Returns the borrowed value rather than an owned copy"); prohibited lists patterns the learner must not use (e.g. "Uses clone()"); advisory lists informational quality notes. Only required and prohibited affect pass/fail.
- targetConcepts: include the requested concept slug and any other concepts the exercise genuinely exercises. prerequisites: dotted slugs of concepts a learner should know first. Both must be dotted lowercase slugs like "rust.borrowing".
- difficulty: a 1-5 integer, consistent with the requested concept difficulty.
- estimated_minutes: a plausible 1-15 integer for the exercise.
- constraints: short constraint tags, e.g. "std_only", "no_unsafe".
- Keep the exercise small and focused: one function or a tiny set of functions, a handful of tests, no cleverness.`

/**
 * Renders one failed Pre-Flight run as a compact, deterministic
 * diagnostics block the model can act on (SPEC story 32, issue #9):
 * every check verdict with its detail, plus both sandbox runs' verdicts
 * and failing tests. The whole diagnostics object from the persisted
 * `pre_flight_attempts` row is fed forward verbatim — nothing is
 * summarized or cherry-picked by the caller.
 */
function renderPreFlightDiagnostics(input: GenerateExerciseInput): string {
  const diagnostics = input.previousDiagnostics
  if (!diagnostics) {
    return ''
  }

  const checks = diagnostics.checks
    .map((check) => {
      const verdict = check.passed ? 'PASSED' : 'FAILED'
      return `- ${check.name}: ${verdict}${check.detail ? ` — ${check.detail}` : ''}`
    })
    .join('\n')

  const renderRun = (run: SandboxResult, label: string): string => {
    const failingTests = run.tests
      .filter((test) => test.status !== 'passed')
      .map((test) => {
        const parts = [`- ${test.name} (${test.status})`]
        if (test.message) {
          parts.push(`  ${test.message}`)
        }
        return parts.join('\n')
      })
    const lines = [`${label}: passed=${String(run.passed)}`]
    if (run.message) {
      lines.push(`  message: ${run.message}`)
    }
    if (failingTests.length > 0) {
      lines.push('  failing tests:', ...failingTests)
    }
    return lines.join('\n')
  }

  return `Previous generation attempt FAILED Pre-Flight Validation. Fix the failure; do not repeat the same mistakes. The previous failure's structured diagnostics:

${checks}

${renderRun(diagnostics.referenceResult, 'Reference-solution run')}
${renderRun(diagnostics.brokenResult, 'Intended-broken-state run')}
`
}

/**
 * Builds the chat messages for a generateExercise call. The prompt template
 * lives here, separate from its schema and function (issue #23 contract).
 */
export function buildGenerateExerciseMessages(
  input: GenerateExerciseInput,
): ChatMessage[] {
  const diagnosticsBlock = renderPreFlightDiagnostics(input)
  const simplifiedBlock = input.simplifiedConstraints
    ? `SIMPLIFIED CONSTRAINT SET (final fallback attempt): this is the last regeneration after repeated failures. Produce the simplest possible exercise for the target concept: ONE tiny function, 1-2 tests, difficulty at or below the requested difficulty, and the smallest constraint set (only "std_only"). Simplify the task rather than exercising edge cases.
`
    : ''

  const userPrompt = `Language: ${input.language}
Target concept: ${input.conceptSlug}
Concept difficulty: ${String(input.conceptDifficulty)} / 5

${simplifiedBlock}${diagnosticsBlock}Generate a practice exercise targeting this concept. Respond with a JSON object of the form {
  "title": "<short exercise title>",
  "prompt": "<learner instructions>",
  "starterCode": "<compiling but wrong implementation>",
  "referenceSolution": "<correct implementation>",
  "testSource": "<one test file, one #[test] per evaluation.tests name>",
  "targetConcepts": ["<dotted slugs>"],
  "prerequisites": ["<dotted slugs>"],
  "difficulty": <1-5>,
  "estimatedMinutes": <1-15>,
  "constraints": ["<tag>"],
  "evaluation": {
    "tests": ["<test names, matching testSource exactly>"],
    "rubric": {"required": ["<pattern>"], "prohibited": ["<pattern>"], "advisory": ["<pattern>"]}
  }
}.`

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ]
}
