import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'

import { Alert } from '#/shared/components/ui/alert'
import { Badge } from '#/shared/components/ui/badge'
import { Button } from '#/shared/components/ui/button'
import { Card, CardContent, CardHeader } from '#/shared/components/ui/card'
import { Input } from '#/shared/components/ui/input'
import { Label } from '#/shared/components/ui/label'
import {
  CONCEPT_DIFFICULTY_MAX,
  CONCEPT_DIFFICULTY_MIN,
  isValidConceptSlug,
} from '#/lib/concept-graph'

import {
  addConceptEdgeFn,
  removeConceptEdgeFn,
  setConceptStatusFn,
  updateConceptFn,
} from '../concepts.functions'
import type {
  ConceptEdgeView,
  ConceptReviewItem,
  ConceptStatus,
} from '../concepts.schema'

/** Extracts a safe message from a server-function rejection. */
function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }
  return fallback
}

/** Human-readable direction label for one edge from this concept's view. */
function edgeDirection(
  concept: ConceptReviewItem,
  edge: ConceptEdgeView,
): string {
  if (edge.kind === 'prerequisite') {
    return edge.fromConceptId === concept.id
      ? `requires ${edge.toSlug}`
      : `prerequisite of ${edge.fromSlug}`
  }
  const other = edge.fromConceptId === concept.id ? edge.toSlug : edge.fromSlug
  return `related to ${other}`
}

/** One concept card: status, correction forms, and its edges (ADR-0016). */
export function ConceptCard({
  concept,
}: {
  concept: ConceptReviewItem
}): React.JSX.Element {
  const router = useRouter()
  const [isStatusPending, setIsStatusPending] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [slug, setSlug] = useState(concept.slug)
  const [difficulty, setDifficulty] = useState(String(concept.difficulty))
  const [saveError, setSaveError] = useState<string>()
  const [edgeTarget, setEdgeTarget] = useState('')
  const [edgeKind, setEdgeKind] = useState<'prerequisite' | 'related'>(
    'prerequisite',
  )
  const [edgeError, setEdgeError] = useState<string>()
  const [isBusy, setIsBusy] = useState(false)

  const hasCycleEdge = concept.edges.some((edge) => edge.validation === 'cycle')
  const nextStatus: ConceptStatus =
    concept.status === 'approved' ? 'draft' : 'approved'
  const slugInputId = `concept-slug-${concept.id}`
  const difficultyInputId = `concept-difficulty-${concept.id}`
  const edgeTargetInputId = `concept-edge-target-${concept.id}`

  async function handleStatusToggle(): Promise<void> {
    setIsStatusPending(true)
    try {
      await setConceptStatusFn({
        data: { conceptId: concept.id, status: nextStatus },
      })
      await router.invalidate()
    } catch (error) {
      setSaveError(errorMessage(error, 'The status could not be updated.'))
    } finally {
      setIsStatusPending(false)
    }
  }

  async function handleSave(
    event: React.SyntheticEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault()
    const parsedDifficulty = Number(difficulty)
    if (!isValidConceptSlug(slug)) {
      setSaveError('Slug must be dotted lowercase, e.g. rust.async.send.')
      return
    }
    if (
      !Number.isInteger(parsedDifficulty) ||
      parsedDifficulty < CONCEPT_DIFFICULTY_MIN ||
      parsedDifficulty > CONCEPT_DIFFICULTY_MAX
    ) {
      setSaveError(
        `Difficulty must be between ${String(CONCEPT_DIFFICULTY_MIN)} and ${String(CONCEPT_DIFFICULTY_MAX)}.`,
      )
      return
    }
    setSaveError(undefined)
    setIsBusy(true)
    try {
      await updateConceptFn({
        data: { conceptId: concept.id, slug, difficulty: parsedDifficulty },
      })
      setIsEditing(false)
      await router.invalidate()
    } catch (error) {
      setSaveError(errorMessage(error, 'The concept could not be saved.'))
    } finally {
      setIsBusy(false)
    }
  }

  async function handleAddEdge(
    event: React.SyntheticEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault()
    setEdgeError(undefined)
    setIsBusy(true)
    try {
      await addConceptEdgeFn({
        data: { fromConceptId: concept.id, toSlug: edgeTarget, kind: edgeKind },
      })
      setEdgeTarget('')
      await router.invalidate()
    } catch (error) {
      setEdgeError(errorMessage(error, 'The edge could not be added.'))
    } finally {
      setIsBusy(false)
    }
  }

  async function handleRemoveEdge(edge: ConceptEdgeView): Promise<void> {
    setEdgeError(undefined)
    setIsBusy(true)
    try {
      await removeConceptEdgeFn({
        data: {
          fromConceptId: edge.fromConceptId,
          toConceptId: edge.toConceptId,
          kind: edge.kind,
        },
      })
      await router.invalidate()
    } catch (error) {
      setEdgeError(errorMessage(error, 'The edge could not be removed.'))
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <Card aria-label={concept.slug} className="scroll-mt-4">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-2xl font-semibold tracking-tight">
              {concept.slug}
            </h2>
            <Badge>{concept.status}</Badge>
            <Badge>difficulty {String(concept.difficulty)}</Badge>
            {hasCycleEdge ? (
              <Badge className="border-destructive/30 bg-destructive/10 text-destructive">
                Excluded — cycle
              </Badge>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button
              disabled={isStatusPending || isBusy}
              onClick={() => void handleStatusToggle()}
              size="sm"
              variant="outline"
            >
              {concept.status === 'approved' ? 'Mark draft' : 'Mark approved'}
            </Button>
            <Button
              disabled={isBusy}
              onClick={() => {
                setSaveError(undefined)
                setIsEditing((current) => !current)
              }}
              size="sm"
              variant="ghost"
            >
              {isEditing ? 'Cancel edit' : 'Edit'}
            </Button>
          </div>
        </div>
        {saveError ? <Alert>{saveError}</Alert> : null}
      </CardHeader>
      <CardContent className="grid gap-5">
        {isEditing ? (
          <form aria-busy={isBusy} className="grid gap-4" onSubmit={handleSave}>
            <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
              <div className="grid gap-2">
                <Label htmlFor={slugInputId}>Slug</Label>
                <Input
                  id={slugInputId}
                  onChange={(event) => setSlug(event.target.value)}
                  spellCheck={false}
                  value={slug}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor={difficultyInputId}>Difficulty (1-5)</Label>
                <Input
                  id={difficultyInputId}
                  max={CONCEPT_DIFFICULTY_MAX}
                  min={CONCEPT_DIFFICULTY_MIN}
                  onChange={(event) => setDifficulty(event.target.value)}
                  type="number"
                  value={difficulty}
                />
              </div>
            </div>
            <div>
              <Button disabled={isBusy} size="sm" type="submit">
                Save changes
              </Button>
            </div>
          </form>
        ) : null}

        <div className="grid gap-2">
          <h3 className="text-sm font-semibold text-foreground">Edges</h3>
          {concept.edges.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No edges yet — add prerequisites or related concepts below.
            </p>
          ) : (
            <ul className="grid gap-1.5">
              {concept.edges.map((edge) => (
                <li
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2"
                  key={`${edge.fromConceptId}-${edge.toConceptId}-${edge.kind}`}
                >
                  <span className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-mono text-xs text-muted-foreground">
                      {edge.kind}
                    </span>
                    {edgeDirection(concept, edge)}
                    {edge.validation === 'cycle' ? (
                      <Badge className="border-destructive/30 bg-destructive/10 text-destructive">
                        excluded
                      </Badge>
                    ) : null}
                  </span>
                  <Button
                    disabled={isBusy}
                    onClick={() => void handleRemoveEdge(edge)}
                    size="sm"
                    variant="ghost"
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form
          aria-busy={isBusy}
          className="grid gap-3 rounded-2xl border border-border bg-card p-4"
          onSubmit={handleAddEdge}
        >
          <h3 className="text-sm font-semibold text-foreground">Add an edge</h3>
          <div className="grid gap-3 sm:grid-cols-[1fr_11rem_auto] sm:items-end">
            <div className="grid gap-2">
              <Label htmlFor={edgeTargetInputId}>Target slug</Label>
              <Input
                id={edgeTargetInputId}
                onChange={(event) => setEdgeTarget(event.target.value)}
                placeholder="rust.lifetimes"
                spellCheck={false}
                value={edgeTarget}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`concept-edge-kind-${concept.id}`}>Kind</Label>
              <select
                className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                id={`concept-edge-kind-${concept.id}`}
                onChange={(event) =>
                  setEdgeKind(event.target.value as 'prerequisite' | 'related')
                }
                value={edgeKind}
              >
                <option value="prerequisite">prerequisite</option>
                <option value="related">related</option>
              </select>
            </div>
            <Button disabled={isBusy} size="sm" type="submit">
              Add
            </Button>
          </div>
          {edgeError ? <Alert>{edgeError}</Alert> : null}
        </form>
      </CardContent>
    </Card>
  )
}
