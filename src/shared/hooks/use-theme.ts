import { useCallback, useEffect, useState } from 'react'

/** Explicit light/dark choice, persisted independently of the OS preference. */
export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'teach-theme'

function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark'
}

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

/**
 * Cross-cutting light/dark theme state — no single feature owns dark mode,
 * so this lives in `shared/hooks` rather than a feature. Reads the stored
 * choice (falling back to the OS preference) after mount, and applies it as
 * `data-theme` on `<html>`, mirroring the inline bootstrap script in
 * `__root.tsx` that sets the same attribute before first paint so there is
 * no flash of the wrong theme.
 */
export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const [theme, setTheme] = useState<Theme>('light')

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    setTheme(isTheme(stored) ? stored : systemTheme())
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next: Theme = current === 'dark' ? 'light' : 'dark'
      window.localStorage.setItem(STORAGE_KEY, next)
      return next
    })
  }, [])

  return { theme, toggleTheme }
}
