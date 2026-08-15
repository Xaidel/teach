import { useCallback, useEffect, useRef, useState } from 'react'

/** Narrowest the resizable column can be dragged or nudged to — small
 * enough to give real room to the sibling panel, but wide enough that the
 * explanation's badge row and headings still have space to breathe. */
export const MIN_RESIZABLE_COLUMN_WIDTH = 280

/** Widest the resizable column can be dragged or nudged to. */
export const MAX_RESIZABLE_COLUMN_WIDTH = 640

const KEYBOARD_STEP = 16

function clampWidth(width: number): number {
  return Math.min(
    MAX_RESIZABLE_COLUMN_WIDTH,
    Math.max(MIN_RESIZABLE_COLUMN_WIDTH, width),
  )
}

/**
 * Drag-to-resize state for a sideways-adjustable column, e.g. the step
 * page's concept panel vs. its exercise panel (`curriculum-step-page.tsx`,
 * previously a fixed 320px split). Pointer dragging and arrow-key nudging
 * both go through the same `clampWidth`, so the two interaction paths
 * can't disagree on bounds. The pointer listeners attach to `window`
 * (rather than the separator element) so the drag keeps tracking even
 * when the cursor moves off the thin handle mid-drag.
 *
 * When `storageKey` is given, the width a learner last dragged to persists
 * across visits (mirroring `useTheme`'s stored-choice pattern): initial
 * render uses `initialWidth` so server and client markup match, then a
 * mount effect swaps in the stored value before the write effect can echo
 * `initialWidth` back over it.
 */
export function useResizableColumn(
  initialWidth: number,
  storageKey?: string,
): {
  width: number
  isDragging: boolean
  separatorProps: {
    onKeyDown: (event: React.KeyboardEvent) => void
    onPointerDown: (event: React.PointerEvent) => void
  }
} {
  const [width, setWidth] = useState(() => clampWidth(initialWidth))
  const [isDragging, setIsDragging] = useState(false)
  const [hasReadStorage, setHasReadStorage] = useState(false)
  const dragStartRef = useRef<{ pointerX: number; startWidth: number } | null>(
    null,
  )

  useEffect(() => {
    if (storageKey) {
      const stored = Number(window.localStorage.getItem(storageKey))
      if (Number.isFinite(stored) && stored > 0) {
        setWidth(clampWidth(stored))
      }
    }
    setHasReadStorage(true)
  }, [storageKey])

  useEffect(() => {
    // Skipped until the read above has had its turn, so a fresh mount
    // can't briefly persist `initialWidth` over an already-stored width.
    if (!storageKey || !hasReadStorage) return
    window.localStorage.setItem(storageKey, String(width))
  }, [storageKey, hasReadStorage, width])

  useEffect(() => {
    if (!isDragging) return

    function handlePointerMove(event: PointerEvent): void {
      const drag = dragStartRef.current
      if (!drag) return
      setWidth(clampWidth(drag.startWidth + (event.clientX - drag.pointerX)))
    }
    function handlePointerUp(): void {
      dragStartRef.current = null
      setIsDragging(false)
    }

    // Dragging past the handle would otherwise select the surrounding text.
    const previousUserSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      document.body.style.userSelect = previousUserSelect
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [isDragging])

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      dragStartRef.current = { pointerX: event.clientX, startWidth: width }
      setIsDragging(true)
    },
    [width],
  )

  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setWidth((current) => clampWidth(current - KEYBOARD_STEP))
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      setWidth((current) => clampWidth(current + KEYBOARD_STEP))
    }
  }, [])

  return { width, isDragging, separatorProps: { onKeyDown, onPointerDown } }
}
