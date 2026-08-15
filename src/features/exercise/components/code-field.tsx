import { useRef } from 'react'

import { cn } from '#/lib/cn'
import type { SandboxLanguage } from '#/lib/sandbox/types'
import { Label } from '#/shared/components/ui/label'
import { Switch } from '#/shared/components/ui/switch'
import { useTheme } from '#/shared/hooks/use-theme'

import { useCodeHighlight } from '../use-code-highlight'
import { useVimMode } from '../use-vim-mode'

type CodeFieldProps = {
  id: string
  language: SandboxLanguage
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  describedBy?: string | undefined
}

/**
 * A code textarea with shiki syntax highlighting layered behind it. The real
 * `<textarea>` stays on top and keeps handling input, selection, and the
 * caret; once highlighting is ready its text turns transparent so the
 * highlighted layer shows through instead. Until then — or if highlighting
 * fails — the textarea renders its own plain text, so the field is always
 * usable.
 *
 * A header row above the field toggles `useVimMode`'s modal keybinding
 * layer on and off. Once it's on, a status line along the *bottom* of the
 * field — traditional vim's own position for it — shows the current mode
 * (`-- NORMAL --`), any keys typed toward a multi-key command, or a
 * `:`/`/`/`?` prompt.
 */
export function CodeField({
  id,
  language,
  value,
  onChange,
  disabled = false,
  describedBy,
}: CodeFieldProps): React.JSX.Element {
  const { theme } = useTheme()
  const html = useCodeHighlight(value, language, theme)
  const overlayRef = useRef<HTMLDivElement>(null)
  const vim = useVimMode(onChange)
  const vimSwitchId = `${id}-vim-mode`

  function syncOverlayScroll(event: React.UIEvent<HTMLTextAreaElement>): void {
    const overlay = overlayRef.current
    if (!overlay) return
    overlay.scrollTop = event.currentTarget.scrollTop
    overlay.scrollLeft = event.currentTarget.scrollLeft
  }

  return (
    <div
      className="relative overflow-hidden rounded-xl border border-input shadow-xs has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
      data-slot="code-field"
    >
      <div className="flex items-center justify-end gap-2 border-b border-input bg-muted/40 px-3 py-1.5">
        <Label
          className="text-xs font-semibold text-muted-foreground"
          htmlFor={vimSwitchId}
        >
          Vim mode
        </Label>
        <Switch
          checked={vim.enabled}
          disabled={disabled}
          id={vimSwitchId}
          onCheckedChange={vim.toggleEnabled}
        />
      </div>
      <div className="relative">
        <div
          aria-hidden="true"
          className={cn(
            // The browser's UA stylesheet sets `white-space: pre` directly
            // on `<pre>`, which wins over an ancestor's
            // `whitespace-pre-wrap` — set wrapping on the `pre` itself so
            // long lines break exactly where the real textarea (which
            // always soft-wraps) breaks them.
            'pointer-events-none absolute inset-0 overflow-auto [&_pre]:m-0 [&_pre]:min-h-full [&_pre]:w-full [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-xs [&_pre]:leading-relaxed',
            !html && 'invisible',
          )}
          dangerouslySetInnerHTML={{ __html: html ?? '' }}
          ref={overlayRef}
        />
        <textarea
          aria-describedby={describedBy}
          className={cn(
            'relative min-h-64 w-full resize-y p-3 font-mono text-xs leading-relaxed caret-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
            // The textarea sits after the overlay in DOM order, so its own
            // background paints over (and hides) the highlighted layer once
            // one exists — it has to go transparent right alongside the
            // text, not just the text on its own.
            html
              ? 'bg-transparent text-transparent'
              : 'bg-background text-foreground',
          )}
          disabled={disabled}
          id={id}
          name="code"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={vim.handleKeyDown}
          onScroll={syncOverlayScroll}
          spellCheck={false}
          value={value}
        />
      </div>
      {vim.enabled ? (
        <div className="border-t border-input bg-background px-3 py-1 font-mono text-xs text-muted-foreground">
          {vim.commandLine ?? vim.statusText}
        </div>
      ) : null}
    </div>
  )
}
