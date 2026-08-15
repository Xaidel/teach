import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const workspaceRoot = new URL('../..', import.meta.url)

async function collectSourceFiles(directory: string): Promise<string[]> {
  const absoluteDirectory = new URL(directory, workspaceRoot)
  const entries = await readdir(absoluteDirectory)
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const relativePath = join(directory, entry)
      const fileStat = await stat(new URL(relativePath, workspaceRoot))
      return fileStat.isDirectory()
        ? collectSourceFiles(`${relativePath}/`)
        : [relativePath]
    }),
  )
  return paths.flat().filter((path) => ['.ts', '.tsx'].includes(extname(path)))
}

describe('client and server source boundaries', () => {
  it('keeps server-only modules out of routes and rendered feature UI', async () => {
    const sourcePaths = [
      ...(await collectSourceFiles('src/routes/')),
      ...(await collectSourceFiles('src/features/exercise/components/')),
      ...(await collectSourceFiles('src/features/exercise/pages/')),
      ...(await collectSourceFiles('src/features/concepts/components/')),
      ...(await collectSourceFiles('src/features/concepts/pages/')),
      ...(await collectSourceFiles('src/features/retrieval/components/')),
      ...(await collectSourceFiles('src/features/retrieval/pages/')),
    ].filter((path) => !path.endsWith('.test.tsx'))

    const sources = await Promise.all(
      sourcePaths.map((path) => readFile(new URL(path, workspaceRoot), 'utf8')),
    )

    for (const source of sources) {
      expect(source).not.toMatch(/from ['"][^'"]+\.server['"]/)
      expect(source).not.toContain('@tanstack/react-start/server')
    }
  })

  it('keeps route declarations thin and feature-owned', async () => {
    const exerciseRoute = await readFile(
      new URL('src/routes/index.tsx', workspaceRoot),
      'utf8',
    )

    expect(exerciseRoute).toContain('ExercisePage')
    expect(exerciseRoute).toContain('getAvailableExercisesFn')
    expect(exerciseRoute).not.toContain('<main')

    const conceptsRoute = await readFile(
      new URL('src/routes/concepts.tsx', workspaceRoot),
      'utf8',
    )

    expect(conceptsRoute).toContain('ConceptReviewPage')
    expect(conceptsRoute).toContain('getConceptReviewFn')
    expect(conceptsRoute).not.toContain('<main')

    const retrievalRoute = await readFile(
      new URL('src/routes/retrieval.tsx', workspaceRoot),
      'utf8',
    )

    expect(retrievalRoute).toContain('RetrievalPage')
    expect(retrievalRoute).toContain('getRetrievalQueueFn')
    expect(retrievalRoute).not.toContain('<main')
  })
})
