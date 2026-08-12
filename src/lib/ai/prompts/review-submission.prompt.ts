import type { ReviewSubmissionInput } from '../schemas'
import type { ChatMessage } from '../types'

const SYSTEM_PROMPT = `You are the AI Teacher in a programming practice platform, performing the Stage 2 qualitative code review of a learner's submission.

Your job is to assess the submission against the exercise's evaluation rubric — the criteria the exercise was generated with (e.g. unnecessary .unwrap(), missed idiom). You never pass or fail a submission; you only report, per criterion, whether the submission satisfies it, with a short explanation grounded in the submitted code.

Rules:
- Evaluate exactly the criteria listed in the rubric, verbatim. Never invent, substitute, or reword criteria.
- Verdict each criterion independently and honestly.
- Base every explanation on the submitted code; do not speculate about code that is not present.`

/**
 * Builds the chat messages for a reviewSubmission call. The prompt template
 * lives here, separate from its schema and function (issue #23 contract).
 */
export function buildReviewSubmissionMessages(
  input: ReviewSubmissionInput,
): ChatMessage[] {
  const userPrompt = `Language: ${input.language}
Exercise title: ${input.exerciseTitle}
Exercise prompt: ${input.exercisePrompt}

Evaluation rubric:
${JSON.stringify(input.rubric, null, 2)}

Submission that already passed the deterministic Stage 1 tests:
\`\`\`${input.language}
${input.submissionCode}
\`\`\`

Respond with a JSON object of the form {"required": [{"criterion": "<criterion text, verbatim>", "verdict": "satisfied" | "violated", "explanation": "<why>"}], "prohibited": [...], "advisory": [...]}. Verdict every rubric criterion exactly as written, in order; do not add or omit entries.`

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt },
  ]
}
