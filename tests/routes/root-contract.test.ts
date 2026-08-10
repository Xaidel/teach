import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const workspaceRoot = new URL('../..', import.meta.url)

describe('TanStack Start application contract', () => {
  it('renders Start head and script helpers in the document shell', async () => {
    const source = await readFile(
      new URL('src/routes/__root.tsx', workspaceRoot),
      'utf8',
    )

    expect(source).toContain('<HeadContent />')
    expect(source).toContain('<Scripts />')
  })

  it('installs CSRF middleware for server functions', async () => {
    const source = await readFile(
      new URL('src/start.ts', workspaceRoot),
      'utf8',
    )

    expect(source).toContain('createCsrfMiddleware')
    expect(source).toContain("context.handlerType === 'serverFn'")
  })
})
