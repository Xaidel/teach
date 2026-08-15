import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom (opted into per-file with `@vitest-environment jsdom`) doesn't
// implement matchMedia; stub it so hooks reading the OS theme preference
// (useTheme) don't crash when rendered in component tests. Node-environment
// test files never see `window`, so guard for it first.
if (typeof window !== 'undefined') {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })
}

// jsdom also doesn't implement ResizeObserver; Radix primitives that
// measure themselves (Switch's thumb, via `@radix-ui/react-use-size`) call
// it on mount and crash without this no-op stub.
if (
  typeof window !== 'undefined' &&
  typeof window.ResizeObserver === 'undefined'
) {
  window.ResizeObserver = class ResizeObserver {
    observe(): void {
      // no-op: jsdom never resizes anything to observe
    }
    unobserve(): void {
      // no-op
    }
    disconnect(): void {
      // no-op
    }
  }
}

afterEach(() => {
  cleanup()
})
