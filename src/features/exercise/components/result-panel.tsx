import { CheckCircle2, XCircle } from 'lucide-react'

import { Alert } from '#/shared/components/ui/alert'
import { Badge } from '#/shared/components/ui/badge'

import type { SandboxResult } from '../exercise.schema'

/** Renders the pass/fail verdict and per-test detail of a Sandbox Result. */
export function ResultPanel({
  result,
}: {
  result: SandboxResult
}): React.JSX.Element {
  const failedTests = result.tests.filter(
    (test) => test.status === 'failed' || test.status === 'errored',
  )

  return (
    <section
      aria-label="Evaluation result"
      aria-live="polite"
      className="grid gap-4"
      data-slot="result-panel"
    >
      {result.passed ? (
        <div className="flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3 text-primary">
          <CheckCircle2 aria-hidden="true" className="size-5" />
          <p className="text-sm font-semibold">
            Passed — all {result.tests.length} test
            {result.tests.length === 1 ? '' : 's'} ran successfully.
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/8 px-4 py-3 text-destructive">
          <XCircle aria-hidden="true" className="size-5" />
          <p className="text-sm font-semibold">
            Failed — {failedTests.length} of {result.tests.length} test
            {result.tests.length === 1 ? '' : 's'} did not pass.
          </p>
        </div>
      )}

      {result.message ? (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-background p-4 font-mono text-xs leading-relaxed text-foreground">
          {result.message}
        </pre>
      ) : null}

      {result.tests.length > 0 ? (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
          {result.tests.map((test) => (
            <li
              className="flex items-start justify-between gap-4 px-4 py-3"
              key={test.name}
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-sm text-foreground">
                  {test.name}
                </p>
                {test.message ? (
                  <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                    {test.message}
                  </p>
                ) : null}
              </div>
              <Badge
                className={
                  test.status === 'passed'
                    ? 'border-primary/30 bg-primary/10 text-primary'
                    : test.status === 'skipped'
                      ? undefined
                      : 'border-destructive/30 bg-destructive/10 text-destructive'
                }
              >
                {test.status}
              </Badge>
            </li>
          ))}
        </ul>
      ) : (
        <Alert className="border-border bg-background text-muted-foreground">
          No test output was produced for this submission.
        </Alert>
      )}
    </section>
  )
}
