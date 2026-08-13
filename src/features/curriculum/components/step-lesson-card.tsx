import { useState } from 'react'

import { Alert } from '#/shared/components/ui/alert'
import { Button } from '#/shared/components/ui/button'
import { Card, CardContent, CardHeader } from '#/shared/components/ui/card'

import { generateLessonFn } from '../curriculum.functions'
import type { CurriculumLesson } from '../curriculum.schema'
import { errorMessage } from '../client-utils'

/**
 * The step's lesson slot (SPEC story 2, issue #14): the AI Teacher Engine
 * explains the concept on demand, phrased at the learner's explanation
 * depth (issue #12). Generation is an explicit action — the lesson is
 * presentation content, so it is never auto-generated and never persisted;
 * once generated it is shown for the session.
 */
export function StepLessonCard({
  language,
  conceptSlug,
}: {
  language: 'rust'
  conceptSlug: string
}): React.JSX.Element {
  const [lesson, setLesson] = useState<CurriculumLesson>()
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string>()

  async function handleGenerate(): Promise<void> {
    setError(undefined)
    setLesson(undefined)
    setIsPending(true)
    try {
      setLesson(
        await generateLessonFn({
          data: { language, conceptSlug },
        }),
      )
    } catch (generationError) {
      setError(
        errorMessage(
          generationError,
          'The lesson could not be generated. Try again.',
        ),
      )
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Card aria-label={`Lesson — ${conceptSlug}`}>
      <CardHeader>
        <h2 className="font-display text-2xl font-semibold tracking-tight">
          Lesson
        </h2>
        <p className="leading-relaxed text-muted-foreground">
          A generated explanation of {conceptSlug}, phrased at your current
          explanation depth. Read it first — the exercises below build on it.
        </p>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid justify-items-start gap-2">
          <Button disabled={isPending} onClick={() => void handleGenerate()}>
            {isPending ? 'Generating...' : 'Generate lesson'}
          </Button>
          {isPending ? (
            <p className="sr-only" role="status">
              Generating the lesson.
            </p>
          ) : null}
          {error ? <Alert>{error}</Alert> : null}
        </div>
        {lesson ? (
          <div className="grid gap-2">
            <p className="sr-only" role="status">
              Lesson generated.
            </p>
            <p className="leading-relaxed text-foreground">
              {lesson.explanation}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
