import { getRouteApi, Link } from '@tanstack/react-router'
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Book, Moon, Sun } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useTheme } from '#/shared/hooks/use-theme'

import {
  CONCEPT_NODE_TYPES,
  CONCEPT_STATUS_STYLE,
} from '../components/concept-flow-node'
import type { ConceptNodeData } from '../concept-graph-layout'
import type { Curriculum, CurriculumStepStatus } from '../curriculum.schema'
import { useConceptGraph } from '../use-concept-graph'

const curriculumRoute = getRouteApi('/curriculum/')

/** Loader data for the Class A graph route. */
export type CurriculumPageData = Curriculum

function capitalize(value: string): string {
  return value.length === 0
    ? value
    : value.charAt(0).toUpperCase() + value.slice(1)
}

/**
 * The Class A Concept Graph (SPEC story 1, issue #14): the usable Rust
 * Concept Graph rendered as a React Flow graph, laid out by ELK
 * (use-concept-graph.ts) so depth, ordering, and edge crossings are
 * computed rather than hand-positioned. A concept unlocks once every
 * prerequisite is Practiced; locked nodes explain the gate on click
 * instead of navigating. Unlocked nodes link into the step page (lesson →
 * guided → independent).
 */
export function CurriculumPage(): React.JSX.Element {
  const data: CurriculumPageData = curriculumRoute.useLoaderData()
  const { c: currentConceptId }: { c?: string } = curriculumRoute.useSearch()
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'

  const [lockedMessage, setLockedMessage] = useState<string | null>(null)
  const lockedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showLockedMessage = useCallback((node: ConceptNodeData) => {
    const prerequisiteList = node.prerequisiteSlugs.join(', ')
    setLockedMessage(`Locked — complete ${prerequisiteList} first.`)
    if (lockedTimeoutRef.current) clearTimeout(lockedTimeoutRef.current)
    lockedTimeoutRef.current = setTimeout(() => {
      setLockedMessage(null)
    }, 2600)
  }, [])

  useEffect(
    () => () => {
      if (lockedTimeoutRef.current) clearTimeout(lockedTimeoutRef.current)
    },
    [],
  )

  const { nodes, edges, isLayingOut } = useConceptGraph(data.steps)

  // The concept currently hovered or keyboard-focused, so its direct
  // prerequisites and dependents can be highlighted and everything else
  // faded. Mouse and focus both write here through the same guarded
  // setter, so a mouse-leave over an unrelated node can't clobber a
  // keyboard focus still active elsewhere.
  const [relatedToId, setRelatedToId] = useState<string | null>(null)

  const handleNodeHoverChange = useCallback(
    (conceptId: string, active: boolean) => {
      setRelatedToId((current) => {
        if (active) return conceptId
        return current === conceptId ? null : current
      })
    },
    [],
  )

  const relatedConceptIds = useMemo(() => {
    if (!relatedToId) return null
    const related = new Set<string>([relatedToId])
    for (const edge of edges) {
      if (edge.source === relatedToId) related.add(edge.target)
      if (edge.target === relatedToId) related.add(edge.source)
    }
    return related
  }, [edges, relatedToId])

  // React Flow nodes carry only ELK's geometry + the concept's own data;
  // the current-concept highlight, the hover/focus dimming, and the
  // locked-node click handler are request-scoped (the `c` search param,
  // this page's hover and toast state), so they're layered on right
  // before render rather than baked into the ELK layout itself.
  const displayNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          isCurrent: node.id === currentConceptId,
          isDimmed:
            relatedConceptIds !== null && !relatedConceptIds.has(node.id),
          isHovered: node.id === relatedToId,
          isRelated:
            relatedToId !== null &&
            node.id !== relatedToId &&
            (relatedConceptIds?.has(node.id) ?? false),
          onLockedSelect: () => {
            showLockedMessage(node.data)
          },
          onFocusChange: handleNodeHoverChange,
        },
      })),
    [
      nodes,
      currentConceptId,
      relatedToId,
      relatedConceptIds,
      showLockedMessage,
      handleNodeHoverChange,
    ],
  )

  const displayEdges = useMemo(
    () =>
      edges.map((edge) => {
        const isRelated =
          relatedToId !== null &&
          (edge.source === relatedToId || edge.target === relatedToId)
        const isFaded = relatedToId !== null && !isRelated
        return {
          ...edge,
          style: {
            stroke: isRelated ? 'var(--primary)' : 'var(--border)',
            strokeWidth: isRelated ? 2.5 : 2,
            opacity: isFaded ? 0.25 : 1,
            transition: 'stroke 150ms, opacity 150ms',
          },
          zIndex: isRelated ? 1 : 0,
        }
      }),
    [edges, relatedToId],
  )

  return (
    <div className="min-h-screen bg-background text-foreground">
      <nav className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-border px-5 py-3 sm:px-8">
        <Link
          className="justify-self-start text-sm text-muted-foreground hover:text-foreground"
          to="/"
        >
          ← Dashboard
        </Link>
        <span className="inline-flex size-9 items-center justify-center justify-self-center rounded-full bg-primary">
          <Book aria-hidden="true" className="size-4 text-primary-foreground" />
        </span>
        <button
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          className="inline-flex size-9 items-center justify-center justify-self-end rounded-full border border-border text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={toggleTheme}
          type="button"
        >
          {isDark ? (
            <Sun aria-hidden="true" className="size-4" />
          ) : (
            <Moon aria-hidden="true" className="size-4" />
          )}
        </button>
      </nav>

      <main className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-12">
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.24em] text-primary">
          Class A
        </p>
        <h1 className="mb-1.5 font-display text-4xl font-semibold tracking-tight sm:text-5xl">
          Concept Graph — {capitalize(data.language)}
        </h1>
        <p className="mb-6 max-w-2xl leading-relaxed text-muted-foreground">
          Every node is a concept. Complete a concept&apos;s prerequisites to
          unlock it, then select it to read the lesson and try the exercise.
        </p>

        {data.steps.length === 0 ? (
          <p className="mx-auto max-w-4xl rounded-2xl border border-border bg-card px-5 py-6 text-sm leading-relaxed text-muted-foreground">
            No usable concepts for {data.language} yet. Draft the Concept Graph
            on the concepts page first — validation-passing concepts appear here
            in prerequisite order.
          </p>
        ) : (
          <>
            <div className="mb-6 flex flex-wrap gap-5 text-xs">
              {(
                Object.keys(CONCEPT_STATUS_STYLE) as CurriculumStepStatus[]
              ).map((status) => (
                <span className="flex items-center gap-1.5" key={status}>
                  <span
                    className={`size-2.5 rounded-sm border-2 ${CONCEPT_STATUS_STYLE[status].swatch}`}
                  />
                  {CONCEPT_STATUS_STYLE[status].label}
                </span>
              ))}
            </div>

            <div
              aria-busy={isLayingOut}
              className="h-[640px] w-full overflow-hidden rounded-2xl border-2 border-border bg-card"
            >
              {isLayingOut ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Laying out the graph…
                </div>
              ) : (
                <ReactFlow
                  colorMode={isDark ? 'dark' : 'light'}
                  edges={displayEdges}
                  fitView
                  fitViewOptions={{ padding: 0.1 }}
                  minZoom={0.1}
                  nodes={displayNodes}
                  nodesConnectable={false}
                  nodesDraggable={false}
                  nodesFocusable={false}
                  nodeTypes={CONCEPT_NODE_TYPES}
                  onNodeMouseEnter={(_, node) => {
                    handleNodeHoverChange(node.id, true)
                  }}
                  onNodeMouseLeave={(_, node) => {
                    handleNodeHoverChange(node.id, false)
                  }}
                  proOptions={{ hideAttribution: true }}
                >
                  <Background
                    gap={20}
                    size={1}
                    variant={BackgroundVariant.Dots}
                  />
                  <Controls showInteractive={false} />
                </ReactFlow>
              )}
            </div>
          </>
        )}

        {lockedMessage ? (
          <div
            aria-live="polite"
            className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-xl border border-border bg-foreground px-5 py-3 text-sm text-background shadow-lg"
            role="status"
          >
            {lockedMessage}
          </div>
        ) : null}

        <footer className="mt-12 flex flex-col gap-2 border-t border-border pt-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <Link className="hover:text-foreground" to="/practice">
            Back to practice home
          </Link>
          <span>
            Class A · progress anchored to concepts, not lesson checkboxes
          </span>
        </footer>
      </main>
    </div>
  )
}
