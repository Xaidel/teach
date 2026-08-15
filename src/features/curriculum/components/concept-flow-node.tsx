import { Link } from '@tanstack/react-router'
import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { Lock } from 'lucide-react'

import type { ConceptFlowNode, ConceptNodeData } from '../concept-graph-layout'
import {
  CONCEPT_NODE_HEIGHT,
  CONCEPT_NODE_WIDTH,
} from '../concept-graph-layout'
import type { CurriculumStepStatus } from '../curriculum.schema'

/** Extra display-only fields ConceptGraphCanvas attaches to each node's
 * data before handing it to React Flow — never part of the ELK layout. */
export type ConceptFlowNodeData = ConceptNodeData & {
  isCurrent: boolean
  /** True while a different node is hovered/focused and this one isn't
   * among its direct prerequisites or dependents — faded rather than
   * hidden, so the rest of the graph stays legible as context. */
  isDimmed: boolean
  /** True for the exact node being hovered/focused — gets the strongest glow. */
  isHovered: boolean
  /** True for a direct prerequisite or dependent of the hovered/focused
   * node (but not that node itself) — gets a softer glow. */
  isRelated: boolean
  onLockedSelect: () => void
  /** Keyboard-focus equivalent of hover, so Tab-ing through the graph
   * highlights related concepts the same way pointing at one does. */
  onFocusChange: (conceptId: string, focused: boolean) => void
}

/** Legend swatch + node visual treatment per step status. */
export const CONCEPT_STATUS_STYLE: Record<
  CurriculumStepStatus,
  {
    label: string
    swatch: string
    border: string
    bg: string
    title: string
    accentText: string
    accentDot: string
  }
> = {
  complete: {
    label: 'Complete',
    swatch: 'border-primary/60 bg-primary/15',
    border: 'border-primary/50',
    bg: 'bg-primary/10',
    title: 'text-foreground',
    accentText: 'text-primary',
    accentDot: 'bg-primary',
  },
  started: {
    label: 'In progress',
    swatch: 'border-primary bg-background',
    border: 'border-primary',
    bg: 'bg-background',
    title: 'text-foreground',
    accentText: 'text-primary',
    accentDot: 'bg-primary',
  },
  available: {
    label: 'Available',
    swatch: 'border-border bg-card',
    border: 'border-border',
    bg: 'bg-card',
    title: 'text-foreground',
    accentText: 'text-muted-foreground',
    accentDot: 'bg-muted-foreground',
  },
  locked: {
    label: 'Locked',
    swatch: 'border-border bg-card opacity-50',
    border: 'border-border',
    bg: 'bg-card',
    title: 'text-muted-foreground',
    accentText: 'text-muted-foreground',
    accentDot: 'bg-muted-foreground',
  },
}

/** Difficulty rendered as filled/unfilled pips, 1 through 5. */
function DifficultyDots({
  difficulty,
  dotClassName,
}: {
  difficulty: number
  dotClassName: string
}): React.JSX.Element {
  return (
    <div className="mt-0.5 flex justify-center gap-1">
      {Array.from({ length: 5 }, (_, i) => (
        <span
          className={`size-1.5 rounded-full ${i < difficulty ? dotClassName : 'bg-muted'}`}
          key={i}
        />
      ))}
    </div>
  )
}

/** Hidden handles — ELK/React Flow need them to anchor edges, but the
 * layered top-down layout makes their position self-explanatory. */
function NodeHandles(): React.JSX.Element {
  return (
    <>
      <Handle className="opacity-0" position={Position.Top} type="target" />
      <Handle className="opacity-0" position={Position.Bottom} type="source" />
    </>
  )
}

/**
 * The Concept Graph's custom React Flow node (ConceptGraph.dc.html): a
 * locked concept renders as a button that explains the gate instead of
 * navigating; an unlocked one is a real link into the step page.
 */
export function ConceptFlowNode({
  id,
  data,
}: NodeProps<
  ConceptFlowNode & { data: ConceptFlowNodeData }
>): React.JSX.Element {
  const style = CONCEPT_STATUS_STYLE[data.status]
  const boxClassName = `flex flex-col items-center justify-center gap-1 rounded-2xl border-2 px-4 py-3.5 text-center transition-[color,background-color,box-shadow] duration-150 motion-reduce:transition-none ${style.border} ${style.bg}`
  const wrapperClassName =
    'transition-opacity duration-150 motion-reduce:transition-none'
  const wrapperStyle: React.CSSProperties = {
    width: CONCEPT_NODE_WIDTH,
    height: CONCEPT_NODE_HEIGHT,
    opacity: data.isDimmed ? 0.3 : 1,
  }
  // Glow the hovered/focused node itself hardest; a direct prerequisite or
  // dependent gets a softer echo of the same glow so the relation reads at
  // a glance, not just through the (already faded) connecting edge.
  const glowStyle: React.CSSProperties = data.isHovered
    ? {
        boxShadow:
          '0 0 0 3px color-mix(in srgb, var(--primary) 55%, transparent), 0 0 28px 6px color-mix(in srgb, var(--primary) 40%, transparent)',
      }
    : data.isRelated
      ? {
          boxShadow:
            '0 0 18px 3px color-mix(in srgb, var(--primary) 25%, transparent)',
        }
      : {}

  if (data.status === 'locked') {
    const prerequisiteList = data.prerequisiteSlugs.join(', ')
    return (
      <div className={wrapperClassName} style={wrapperStyle}>
        <NodeHandles />
        <button
          aria-label={`${data.slug}, locked. Complete ${prerequisiteList} first.`}
          className={`${boxClassName} relative size-full cursor-pointer opacity-55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
          onBlur={() => {
            data.onFocusChange(id, false)
          }}
          onClick={data.onLockedSelect}
          onFocus={() => {
            data.onFocusChange(id, true)
          }}
          style={glowStyle}
          type="button"
        >
          <Lock
            aria-hidden="true"
            className="absolute right-2.5 top-2.5 size-3.5 text-muted-foreground"
          />
          <div
            className={`text-[10px] uppercase tracking-[0.06em] ${style.accentText}`}
          >
            D{data.difficulty}
          </div>
          <div
            className={`font-display text-sm font-semibold leading-tight ${style.title}`}
          >
            {data.slug}
          </div>
        </button>
      </div>
    )
  }

  return (
    <div className={wrapperClassName} style={wrapperStyle}>
      <NodeHandles />
      <Link
        aria-label={`${data.slug}, ${style.label.toLowerCase()}, difficulty ${String(data.difficulty)}. Open this concept.`}
        className={`${boxClassName} relative size-full hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          data.isCurrent ? 'ring-2 ring-primary/40' : ''
        }`}
        onBlur={() => {
          data.onFocusChange(id, false)
        }}
        onFocus={() => {
          data.onFocusChange(id, true)
        }}
        params={{ conceptSlug: data.slug }}
        style={glowStyle}
        to="/curriculum/$conceptSlug"
      >
        {data.isCurrent ? (
          <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-primary px-2 py-0.5 text-[9px] font-extrabold tracking-[0.05em] text-primary-foreground">
            YOU ARE HERE
          </span>
        ) : null}
        <div
          className={`text-[10px] uppercase tracking-[0.06em] ${style.accentText}`}
        >
          D{data.difficulty}
        </div>
        <div
          className={`font-display text-sm font-semibold leading-tight ${style.title}`}
        >
          {data.slug}
        </div>
        <DifficultyDots
          difficulty={data.difficulty}
          dotClassName={style.accentDot}
        />
      </Link>
    </div>
  )
}

/** Stable node-type map — React Flow warns (and re-renders excessively)
 * if this is recreated on every render. */
export const CONCEPT_NODE_TYPES = { concept: ConceptFlowNode }
