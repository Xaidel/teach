import { HeadContent, Scripts, createRootRoute } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        name: 'description',
        content:
          'Teach — an interactive learning platform pairing an AI teacher with a real sandboxed Rust toolchain.',
      },
      { title: 'Teach — Rust practice' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  shellComponent: RootDocument,
})

function RootDocument({
  children,
}: Readonly<{ children: ReactNode }>): React.JSX.Element {
  return (
    // The bootstrap script below sets `data-theme` on this element before
    // React hydrates, outside React's own render output — expected to
    // differ from the server-rendered markup, so hydration must not warn
    // about it.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Sets `data-theme` before first paint so the Dashboard's theme
            toggle (`useTheme`, src/shared/hooks/use-theme.ts) never flashes
            the wrong theme on load — the hook re-derives and owns the same
            state once React mounts. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var s=localStorage.getItem('teach-theme');var t=(s==='light'||s==='dark')?s:(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`,
          }}
        />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
