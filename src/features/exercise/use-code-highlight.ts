import { useEffect, useState } from 'react'
import type { createHighlighterCore } from 'shiki/core'

import type { SandboxLanguage } from '#/lib/sandbox/types'
import type { Theme } from '#/shared/hooks/use-theme'

type Highlighter = Awaited<ReturnType<typeof createHighlighterCore>>

let highlighterPromise: Promise<Highlighter> | undefined

/**
 * Lazily creates a single shiki highlighter shared by every code field,
 * code-split out of the main bundle. Shiki's default `createHighlighter`
 * bundles every grammar and theme it ships behind one dynamically-keyed
 * import, which a bundler can't tree-shake — it pulled ~10 MB of unused
 * languages into the build. The fine-grained core API instead takes
 * statically-imported grammar/theme modules, so only the three languages
 * the sandbox runs and the two themes this app uses are ever bundled.
 */
function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= Promise.all([
    import('shiki/core'),
    import('shiki/engine/oniguruma'),
  ]).then(([{ createHighlighterCore }, { createOnigurumaEngine }]) =>
    createHighlighterCore({
      langs: [
        import('shiki/langs/rust.mjs'),
        import('shiki/langs/go.mjs'),
        import('shiki/langs/python.mjs'),
      ],
      themes: [
        import('shiki/themes/github-light.mjs'),
        import('shiki/themes/github-dark.mjs'),
      ],
      engine: createOnigurumaEngine(import('shiki/wasm')),
    }),
  )
  return highlighterPromise
}

const SHIKI_THEME_FOR: Record<Theme, 'github-light' | 'github-dark'> = {
  light: 'github-light',
  dark: 'github-dark',
}

/**
 * Highlights `code` as `language` with shiki, re-highlighting when `code`,
 * `language`, or `theme` changes. Highlighting is mount-and-effect only —
 * shiki's grammars load on demand — so callers get `undefined` until the
 * first render completes, and should show plain text in the meantime.
 * Returns `undefined` again if highlighting fails, so callers can fall back
 * without surfacing a broken code block.
 */
export function useCodeHighlight(
  code: string,
  language: SandboxLanguage,
  theme: Theme,
): string | undefined {
  const [html, setHtml] = useState<string>()

  useEffect(() => {
    let cancelled = false

    getHighlighter()
      .then((highlighter) =>
        highlighter.codeToHtml(code, {
          lang: language,
          theme: SHIKI_THEME_FOR[theme],
        }),
      )
      .then((rendered) => {
        if (cancelled) return
        // shiki marks the <pre> focusable (tabindex="0") for standalone
        // scrollable code blocks; this layer is a decorative, aria-hidden
        // overlay behind a real textarea, so drop it rather than leave a
        // second, silent tab stop.
        setHtml(rendered.replaceAll(/ tabindex="[^"]*"/g, ''))
      })
      .catch(() => {
        if (!cancelled) setHtml(undefined)
      })

    return () => {
      cancelled = true
    }
  }, [code, language, theme])

  return html
}
