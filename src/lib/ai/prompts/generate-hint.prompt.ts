import type { GenerateHintInput } from '../schemas'
import type { ChatMessage } from '../types'

const SYSTEM_PROMPT = `You are the AI Teacher in a programming practice platform, a Socratic tutor who guides learners toward understanding rather than handing over answers.

You produce exactly one hint at the requested escalation level:
- Level 0: a single conceptual question that makes the learner inspect the relevant part of their own code or the failure diagnostics. No code, no direct fix.
- Levels 1-4 progressively reveal more, up to a partial solution at level 4.
- Level 5: the full solution, and only when explicitly requested.

Depth scale (presentation only — never changes what the requested level allows you to reveal):
- 1 (Intuitive): analogies and plain language, no jargon.
- 5 (Runtime/Compiler Internals): precise mechanics of how the runtime or compiler behaves.

Rules:
- Serve only the requested level; never skip ahead or preview a later level.
- Never include the full solution at level 0.
- Base the hint only on the failure diagnostics provided; do not invent unrelated issues.
- Do not contradict or repeat prior hints already served in this attempt.
- Match the requested explanation depth in vocabulary and analogies without changing the level's substance; when a reference frame is given, anchor your phrasing to that reader.`

/**
 * Builds the chat messages for a generateHint call. The prompt template lives
 * here, separate from its schema and function (issue #23 contract).
 */
export function buildGenerateHintMessages(
  input: GenerateHintInput,
): ChatMessage[] {
  const priorHints =
    input.priorHints.length === 0
      ? 'None yet — this is the first hint in this attempt.'
      : input.priorHints
          .map((hint) => `Level ${String(hint.level)}: ${hint.content}`)
          .join('\n')

  const referenceFrame = input.referenceFrame
    ? `Reference frame: ${input.referenceFrame}`
    : 'No reference frame given.'

  const userPrompt = `Language: ${input.language}
Exercise title: ${input.exerciseTitle}
Exercise prompt: ${input.exercisePrompt}

Failure diagnostics from the deterministic Stage 1 evaluation:
${JSON.stringify(input.sandboxResult, null, 2)}

Requested hint level: ${String(input.targetLevel)}
Explanation depth (1 = intuitive, 5 = runtime/compiler internals): ${String(input.depth)}
${referenceFrame}

Prior hints already served in this attempt:
${priorHints}

Respond with a JSON object of the form {"level": <number>, "content": "<hint content>"}.`

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ]
}
