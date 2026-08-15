// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  MAX_RESIZABLE_COLUMN_WIDTH,
  MIN_RESIZABLE_COLUMN_WIDTH,
  useResizableColumn,
} from './use-resizable-column'

/** Simulates a pointer drag by driving the hook's own handlers plus the
 * window-level listeners it attaches while dragging. */
function drag(
  result: { current: ReturnType<typeof useResizableColumn> },
  fromX: number,
  toX: number,
): void {
  act(() => {
    result.current.separatorProps.onPointerDown({
      clientX: fromX,
    } as React.PointerEvent)
  })
  act(() => {
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: toX }))
  })
  act(() => {
    window.dispatchEvent(new PointerEvent('pointerup'))
  })
}

describe('useResizableColumn', () => {
  afterEach(() => {
    window.localStorage.clear()
  })

  it('starts at the given width', () => {
    const { result } = renderHook(() => useResizableColumn(320))
    expect(result.current.width).toBe(320)
    expect(result.current.isDragging).toBe(false)
  })

  it('clamps an out-of-range initial width into bounds', () => {
    const { result } = renderHook(() => useResizableColumn(10))
    expect(result.current.width).toBe(MIN_RESIZABLE_COLUMN_WIDTH)
  })

  it('grows the width by the pointer drag distance moving right', () => {
    const { result } = renderHook(() => useResizableColumn(320))

    drag(result, 100, 180)

    expect(result.current.width).toBe(400)
    expect(result.current.isDragging).toBe(false)
  })

  it('shrinks the width when dragging left', () => {
    const { result } = renderHook(() => useResizableColumn(340))

    drag(result, 200, 150)

    expect(result.current.width).toBe(290)
  })

  it('reports isDragging true only between pointer down and pointer up', () => {
    const { result } = renderHook(() => useResizableColumn(320))

    act(() => {
      result.current.separatorProps.onPointerDown({
        clientX: 100,
      } as React.PointerEvent)
    })
    expect(result.current.isDragging).toBe(true)

    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup'))
    })
    expect(result.current.isDragging).toBe(false)
  })

  it('never drags past the minimum or maximum width', () => {
    const { result } = renderHook(() => useResizableColumn(320))

    drag(result, 0, -10_000)
    expect(result.current.width).toBe(MIN_RESIZABLE_COLUMN_WIDTH)

    drag(result, 0, 10_000)
    expect(result.current.width).toBe(MAX_RESIZABLE_COLUMN_WIDTH)
  })

  it('nudges the width with the arrow keys', () => {
    const { result } = renderHook(() => useResizableColumn(320))
    const preventDefault = () => undefined

    act(() => {
      result.current.separatorProps.onKeyDown({
        key: 'ArrowRight',
        preventDefault,
      } as unknown as React.KeyboardEvent)
    })
    expect(result.current.width).toBe(336)

    act(() => {
      result.current.separatorProps.onKeyDown({
        key: 'ArrowLeft',
        preventDefault,
      } as unknown as React.KeyboardEvent)
    })
    expect(result.current.width).toBe(320)
  })

  it('ignores other keys', () => {
    const { result } = renderHook(() => useResizableColumn(320))

    act(() => {
      result.current.separatorProps.onKeyDown({
        key: 'Enter',
        preventDefault: () => undefined,
      } as unknown as React.KeyboardEvent)
    })

    expect(result.current.width).toBe(320)
  })

  it('restores a previously stored width instead of the given default', async () => {
    window.localStorage.setItem('panel-width', '480')

    const { result } = renderHook(() => useResizableColumn(320, 'panel-width'))

    await waitFor(() => expect(result.current.width).toBe(480))
  })

  it('ignores a stored value outside the min/max bounds', async () => {
    window.localStorage.setItem('panel-width', '999999')

    const { result } = renderHook(() => useResizableColumn(320, 'panel-width'))

    await waitFor(() =>
      expect(result.current.width).toBe(MAX_RESIZABLE_COLUMN_WIDTH),
    )
  })

  it('persists the width to storage after a resize, keyed by storageKey', async () => {
    const { result } = renderHook(() => useResizableColumn(320, 'panel-width'))
    await waitFor(() =>
      expect(window.localStorage.getItem('panel-width')).toBe('320'),
    )

    drag(result, 100, 180)

    await waitFor(() =>
      expect(window.localStorage.getItem('panel-width')).toBe('400'),
    )
  })

  it('does not touch storage when no storageKey is given', () => {
    const { result } = renderHook(() => useResizableColumn(320))

    drag(result, 100, 180)

    expect(result.current.width).toBe(400)
    expect(window.localStorage.length).toBe(0)
  })
})
