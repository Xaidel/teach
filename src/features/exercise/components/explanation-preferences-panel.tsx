import { useState } from 'react'

// Deliberate, documented cross-feature dependency (arch_docs/dependency-rules.md
// "Feature Dependencies": "expose a narrow client-safe public module from
// the owning feature", the same pattern exercise.server.ts already applies
// server-side): the explanation depth and reference frame (issue #12) are a
// learner-owned preference, not an exercise concern, so this component
// depends one-way on the narrow, client-safe public module
// `learners/learners.functions.ts` exposes for changing it. `learners`
// never imports back from `exercise`, so the graph stays acyclic.
import { updateExplanationPreferencesFn } from '#/features/learners/learners.functions'
import type { ExplanationPreferences } from '#/features/learners/learners.schema'
import {
  EXPLANATION_DEPTH_MAX,
  EXPLANATION_DEPTH_MIN,
} from '#/lib/explanation-depth'
import { Button } from '#/shared/components/ui/button'
import { Input } from '#/shared/components/ui/input'
import { Label } from '#/shared/components/ui/label'

const DEPTH_LABELS: Record<number, string> = {
  1: 'Intuitive',
  2: 'Beginner technical',
  3: 'Developer',
  4: 'Advanced',
  5: 'Runtime/Compiler internals',
}

const DEPTH_LEVELS = Array.from(
  { length: EXPLANATION_DEPTH_MAX - EXPLANATION_DEPTH_MIN + 1 },
  (_, index) => EXPLANATION_DEPTH_MIN + index,
)

/**
 * Lets the learner set/change their explanation depth (1-5) and optional
 * reference frame (issue #12, PRD §12) — presentation preferences threaded
 * into every later hint and explanation, never the underlying hint level or
 * concept targeted.
 */
export function ExplanationPreferencesPanel({
  initial,
}: {
  initial: ExplanationPreferences
}): React.JSX.Element {
  const [depth, setDepth] = useState(initial.depth)
  const [referenceFrameInput, setReferenceFrameInput] = useState(
    initial.referenceFrame ?? '',
  )
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string>()

  async function handleDepthChange(nextDepth: number): Promise<void> {
    if (nextDepth === depth) return
    setError(undefined)
    setIsSaving(true)
    try {
      const preferences = await updateExplanationPreferencesFn({
        data: { depth: nextDepth },
      })
      setDepth(preferences.depth)
    } catch {
      setError('Could not save the explanation depth. Try again.')
    } finally {
      setIsSaving(false)
    }
  }

  async function handleReferenceFrameSubmit(
    event: React.SyntheticEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault()
    setError(undefined)
    setIsSaving(true)
    const trimmed = referenceFrameInput.trim()
    try {
      const preferences = await updateExplanationPreferencesFn({
        data: { referenceFrame: trimmed.length > 0 ? trimmed : null },
      })
      setReferenceFrameInput(preferences.referenceFrame ?? '')
    } catch {
      setError('Could not save the reference frame. Try again.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section
      aria-label="Explanation preferences"
      className="grid gap-4 rounded-2xl border border-border bg-card px-5 py-4"
      data-slot="explanation-preferences-panel"
    >
      <div className="grid gap-2">
        <Label>Explanation depth</Label>
        <div className="flex flex-wrap gap-2" role="group">
          {DEPTH_LEVELS.map((level) => (
            <Button
              aria-pressed={level === depth}
              disabled={isSaving}
              key={level}
              onClick={() => handleDepthChange(level)}
              size="sm"
              type="button"
              variant={level === depth ? 'default' : 'outline'}
            >
              {String(level)} · {DEPTH_LABELS[level]}
            </Button>
          ))}
        </div>
      </div>

      <form
        className="grid gap-2 sm:flex sm:items-end sm:gap-3"
        onSubmit={handleReferenceFrameSubmit}
      >
        <div className="grid flex-1 gap-2">
          <Label htmlFor="explanation-reference-frame">
            Reference frame (optional)
          </Label>
          <Input
            disabled={isSaving}
            id="explanation-reference-frame"
            onChange={(event) => setReferenceFrameInput(event.target.value)}
            placeholder="e.g. as a senior JavaScript developer"
            value={referenceFrameInput}
          />
        </div>
        <Button disabled={isSaving} type="submit" variant="outline">
          Save
        </Button>
      </form>

      {error ? (
        <p className="text-xs font-medium text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}
