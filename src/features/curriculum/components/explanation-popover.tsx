import { Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

// Deliberate, documented cross-feature dependency (arch_docs/dependency-rules.md
// "Feature Dependencies"), the same pattern `explanation-preferences-panel.tsx`
// already applies on `/practice`: the explanation depth and reference frame
// (issue #12) are a learner-owned preference, not a curriculum concern, so
// this component depends one-way on the narrow, client-safe public module
// `learners/learners.functions.ts` exposes for changing it.
import { updateExplanationPreferencesFn } from '#/features/learners/learners.functions'
import type { ExplanationPreferences } from '#/features/learners/learners.schema'
import {
  EXPLANATION_DEPTH_MAX,
  EXPLANATION_DEPTH_MIN,
} from '#/lib/explanation-depth'
import { Button } from '#/shared/components/ui/button'
import { Input } from '#/shared/components/ui/input'

/** Same scale as `explanation-preferences-panel.tsx`'s `DEPTH_LABELS` — kept
 * local rather than shared since the two surfaces render it completely
 * differently (a full button group there, a compact slider here) and the
 * five labels are the entire overlap. */
const DEPTH_LABELS: Record<number, string> = {
  1: 'Intuitive',
  2: 'Beginner technical',
  3: 'Developer',
  4: 'Advanced',
  5: 'Runtime/Compiler internals',
}

/** A drag can fire the range input's change event once per tick — wait for
 * the slider to sit still this long before actually saving and
 * re-generating, rather than doing that once per tick. */
const DEPTH_SAVE_DEBOUNCE_MS = 500

type ExplanationPopoverProps = {
  initial: ExplanationPreferences
  /** Called after depth or reference frame is saved, so the caller can
   * re-generate content at the new preference. */
  onSaved: () => void
}

/**
 * "Explain it for me" (NodeDetail.dc.html): a depth slider and a free-text
 * reference frame, both persisted learner preferences (issue #12) — not the
 * design's ephemeral per-view control. Unlike the design, depth and
 * reference frame are independent axes here (the real preference model),
 * not mutually exclusive — setting one doesn't hide the other.
 */
export function ExplanationPopover({
  initial,
  onSaved,
}: ExplanationPopoverProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const [depth, setDepth] = useState(initial.depth)
  const [referenceFrameInput, setReferenceFrameInput] = useState(
    initial.referenceFrame ?? '',
  )
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string>()
  const saveDepthTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (saveDepthTimeoutRef.current) clearTimeout(saveDepthTimeoutRef.current)
    },
    [],
  )

  async function saveDepth(nextDepth: number): Promise<void> {
    setError(undefined)
    setIsSaving(true)
    try {
      await updateExplanationPreferencesFn({ data: { depth: nextDepth } })
      onSaved()
    } catch {
      setError('Could not save the explanation depth. Try again.')
    } finally {
      setIsSaving(false)
    }
  }

  function handleDepthInput(nextDepth: number): void {
    // Update the slider and its label immediately — only the actual save
    // (and the re-generation it triggers) waits out the debounce.
    setDepth(nextDepth)
    if (saveDepthTimeoutRef.current) clearTimeout(saveDepthTimeoutRef.current)
    saveDepthTimeoutRef.current = setTimeout(() => {
      void saveDepth(nextDepth)
    }, DEPTH_SAVE_DEBOUNCE_MS)
  }

  async function handlePersonaSubmit(
    event: React.SyntheticEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault()
    const trimmed = referenceFrameInput.trim()
    setError(undefined)
    setIsSaving(true)
    try {
      await updateExplanationPreferencesFn({
        data: { referenceFrame: trimmed.length > 0 ? trimmed : null },
      })
      onSaved()
    } catch {
      setError('Could not save the reference frame. Try again.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="relative">
      <button
        aria-expanded={isOpen}
        aria-label="Adjust explanation level"
        className="inline-flex size-7 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => {
          setIsOpen((open) => !open)
        }}
        title="Explain it for me"
        type="button"
      >
        <Sparkles aria-hidden="true" className="size-3.5" />
      </button>

      {isOpen ? (
        <div
          aria-label="Explain it for me"
          className="absolute right-0 top-9 z-10 grid w-72 gap-3 rounded-xl border border-border bg-card p-4 shadow-lg"
          role="dialog"
        >
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
              Explain it for me
            </p>
            <button
              aria-label="Close"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => {
                setIsOpen(false)
              }}
              type="button"
            >
              <X aria-hidden="true" className="size-3.5" />
            </button>
          </div>

          <div className="grid gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-foreground">
                {DEPTH_LABELS[depth]}
              </span>
              {isSaving ? (
                <span className="text-muted-foreground">Saving…</span>
              ) : null}
            </div>
            <input
              aria-label="Explanation depth"
              className="w-full accent-primary"
              disabled={isSaving}
              max={EXPLANATION_DEPTH_MAX}
              min={EXPLANATION_DEPTH_MIN}
              onChange={(event) => {
                handleDepthInput(Number(event.target.value))
              }}
              step={1}
              type="range"
              value={depth}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>Intuitive</span>
              <span>Developer</span>
              <span>Internals</span>
            </div>
          </div>

          <form
            className="flex items-center gap-2"
            onSubmit={handlePersonaSubmit}
          >
            <Input
              aria-label="Explain like..."
              className="h-9 text-xs"
              disabled={isSaving}
              onChange={(event) => {
                setReferenceFrameInput(event.target.value)
              }}
              placeholder="Or: senior Java developer…"
              value={referenceFrameInput}
            />
            <Button disabled={isSaving} size="sm" type="submit">
              Go
            </Button>
          </form>

          {error ? (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
