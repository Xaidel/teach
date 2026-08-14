import { useState } from 'react'

import type {
  ConflatedConceptsFinding,
  IncorrectClaimFinding,
  MissingConceptFinding,
} from '#/lib/ai/schemas'
import { Alert } from '#/shared/components/ui/alert'
import { Badge } from '#/shared/components/ui/badge'
import { Button } from '#/shared/components/ui/button'
import { Card, CardContent, CardHeader } from '#/shared/components/ui/card'
import { Label } from '#/shared/components/ui/label'
import { Textarea } from '#/shared/components/ui/textarea'

import { errorMessage } from '../client-utils'
import { submitExplanationAssessmentFn } from '../explanation-assessment.functions'
import type {
  ExplanationAssessmentEligibleConcept,
  ExplanationAssessmentResult,
} from '../explanation-assessment.schema'

/** One findings group of an assessment result, rendered as a titled list. */
function FindingsList<T>({
  title,
  items,
  render,
}: {
  title: string
  items: T[]
  render: (item: T, index: number) => React.JSX.Element
}): React.JSX.Element | null {
  if (items.length === 0) return null
  return (
    <div className="grid gap-1.5">
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      <ul className="grid gap-1.5 text-sm text-muted-foreground">
        {items.map(render)}
      </ul>
    </div>
  )
}

/**
 * The Explanation Assessment surface (SPEC stories 44-45, issue #16): the
 * learner freely explains a Practiced concept in their own words; the AI
 * Teacher Engine compares the explanation against the Concept Graph and
 * the platform scores it deterministically, recording the signal in the
 * Learner Model. A passed assessment feeds the Practiced → Demonstrated
 * gate, which also requires a passed Transfer Test (ADR-0015, ticket #17).
 */
export function ExplanationAssessmentCard({
  concepts,
}: {
  concepts: ExplanationAssessmentEligibleConcept[]
}): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string | undefined>(
    concepts[0]?.conceptId,
  )
  const [explanation, setExplanation] = useState('')
  const [isPending, setIsPending] = useState(false)
  const [result, setResult] = useState<ExplanationAssessmentResult>()
  const [error, setError] = useState<string>()

  const selected = concepts.find((concept) => concept.conceptId === selectedId)
  const textareaId = `explanation-assessment-explanation-${selectedId ?? 'none'}`

  async function handleSubmit(): Promise<void> {
    if (!selectedId) return
    setError(undefined)
    setResult(undefined)
    setIsPending(true)
    try {
      setResult(
        await submitExplanationAssessmentFn({
          data: { conceptId: selectedId, explanation },
        }),
      )
    } catch (assessmentError) {
      setError(
        errorMessage(
          assessmentError,
          'The explanation could not be assessed. Try again.',
        ),
      )
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Card aria-label="Explanation Assessment">
      <CardHeader>
        <h2 className="font-display text-2xl font-semibold tracking-tight">
          Explain a concept in your own words
        </h2>
        <p className="leading-relaxed text-muted-foreground">
          Passing code alone doesn&apos;t reveal misconceptions. Once a concept
          is Practiced, explain it freely — the AI Teacher Engine compares your
          explanation against the Concept Graph for missing sub-concepts,
          incorrect claims, and conflated ideas, and the platform scores it
          deterministically. A passed assessment is required, alongside a passed
          Transfer Test, before the concept can be promoted to Demonstrated.
        </p>
      </CardHeader>
      <CardContent>
        {concepts.length === 0 ? (
          <p className="rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
            No concepts are eligible yet. Reach Practiced on a concept (pass a
            generated exercise targeting it) and it will appear here for its
            gate assessment.
          </p>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label>Eligible concepts</Label>
              <ul className="flex flex-wrap gap-2">
                {concepts.map((concept) => (
                  <li key={concept.conceptId}>
                    <button
                      aria-pressed={concept.conceptId === selectedId}
                      className={
                        concept.conceptId === selectedId
                          ? 'inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-sm font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                          : 'inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                      }
                      onClick={() => setSelectedId(concept.conceptId)}
                      type="button"
                    >
                      <span className="font-mono">{concept.slug}</span>
                      {concept.hasPassedAssessment ? (
                        <Badge className="border-primary/40 bg-primary/10 text-primary">
                          Assessment passed
                        </Badge>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="grid gap-2">
              <Label htmlFor={textareaId}>
                Explain {selected ? `"${selected.slug}"` : 'the concept'} in
                your own words
              </Label>
              <Textarea
                className="min-h-40"
                disabled={isPending || !selected}
                id={textareaId}
                onChange={(event) => setExplanation(event.target.value)}
                placeholder="Write what the concept means, how it works, and when you would use it..."
                spellCheck={false}
                value={explanation}
              />
            </div>

            <div className="grid justify-items-start gap-2">
              <Button
                disabled={
                  isPending || !selected || explanation.trim().length === 0
                }
                onClick={() => void handleSubmit()}
              >
                {isPending ? 'Assessing...' : 'Assess my explanation'}
              </Button>
              {isPending ? (
                <p className="sr-only" role="status">
                  Comparing your explanation against the Concept Graph.
                </p>
              ) : null}
              {error ? <Alert>{error}</Alert> : null}
            </div>

            {result ? <AssessmentResult result={result} /> : null}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Renders one assessment's score, verdict, and raw findings, plus — on a
 * failed attempt with at least one resolved concept — a "Concepts to
 * review" section linking back to curriculum content (issue #132,
 * ADR-0015 addendum): optional, non-blocking remediation, never a gate;
 * links open in a new tab so an in-progress retry draft isn't lost.
 */
function AssessmentResult({
  result,
}: {
  result: ExplanationAssessmentResult
}): React.JSX.Element {
  const percent = Math.round(result.accuracyScore * 100)
  const findings = result.analysis

  return (
    <div className="grid gap-4 border-t border-border pt-4">
      <div className="flex flex-wrap items-center gap-3">
        <p className="font-display text-3xl font-semibold tracking-tight">
          {String(percent)}%
        </p>
        {result.passed ? (
          <Badge className="border-primary/40 bg-primary/10 text-primary">
            Passed
          </Badge>
        ) : (
          <Badge>Needs work — retry any time</Badge>
        )}
        <span className="text-sm text-muted-foreground">
          {result.masteryState === 'demonstrated' ? (
            <>Concept promoted to Demonstrated.</>
          ) : result.passed ? (
            <>
              Concept stays at Practiced — Demonstrated also requires a passed
              Transfer Test.
            </>
          ) : (
            <>
              Concept stays at Practiced. Each attempt is recorded as evidence;
              you can retry whenever you like.
            </>
          )}
        </span>
      </div>

      {findings.missing.length === 0 &&
      findings.incorrect.length === 0 &&
      findings.conflated.length === 0 ? (
        <p className="text-sm leading-relaxed text-muted-foreground">
          No missing sub-concepts, incorrect claims, or conflated ideas were
          found.
        </p>
      ) : (
        <div className="grid gap-3 rounded-2xl border border-border bg-muted/40 px-4 py-3">
          <FindingsList<MissingConceptFinding>
            items={findings.missing}
            render={(item, index) => (
              <li key={`missing-${String(index)}`}>
                <span className="font-semibold text-foreground">
                  {item.concept}
                </span>{' '}
                — {item.detail}
              </li>
            )}
            title="Missing sub-concepts"
          />
          <FindingsList<IncorrectClaimFinding>
            items={findings.incorrect}
            render={(item, index) => (
              <li key={`incorrect-${String(index)}`}>
                <span className="font-semibold text-foreground">
                  “{item.claim}”
                </span>{' '}
                — {item.correction}
              </li>
            )}
            title="Incorrect claims"
          />
          <FindingsList<ConflatedConceptsFinding>
            items={findings.conflated}
            render={(item, index) => (
              <li key={`conflated-${String(index)}`}>
                <span className="font-semibold text-foreground">
                  {item.concepts.join(' / ')}
                </span>{' '}
                — {item.detail}
              </li>
            )}
            title="Conflated concepts"
          />
        </div>
      )}

      {!result.passed && result.remediationConcepts.length > 0 ? (
        <div className="grid gap-1.5">
          <h4 className="text-sm font-semibold text-foreground">
            Concepts to review
          </h4>
          <ul className="flex flex-wrap gap-2">
            {result.remediationConcepts.map((conceptSlug) => (
              <li key={conceptSlug}>
                {/* Plain anchor, not the router's `Link`: this always opens
                    a fresh tab (no client-side navigation to hand off), and
                    it keeps this card renderable in unit tests without a
                    RouterProvider. */}
                <a
                  className="inline-flex items-center rounded-full border border-border bg-muted px-3 py-1.5 font-mono text-sm text-foreground hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  href={`/curriculum/${encodeURIComponent(conceptSlug)}`}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {conceptSlug}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
