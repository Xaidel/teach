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

function isENOENT(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}

async function collectFeatureSourceFiles(feature: string): Promise<string[]> {
  const paths = await Promise.all(
    ['components', 'pages'].map(async (subdirectory) => {
      const absoluteDirectory = new URL(
        `src/features/${feature}/${subdirectory}/`,
        workspaceRoot,
      )
      try {
        await stat(absoluteDirectory)
      } catch (error) {
        if (isENOENT(error)) return []
        throw error
      }
      return collectSourceFiles(`src/features/${feature}/${subdirectory}/`)
    }),
  )
  return paths.flat()
}

describe('client and server source boundaries', () => {
  it('keeps server-only modules out of routes and rendered feature UI', async () => {
    const features = await readdir(new URL('src/features/', workspaceRoot))
    const sourcePaths = [
      ...(await collectSourceFiles('src/routes/')),
      ...(await Promise.all(features.map(collectFeatureSourceFiles))).flat(),
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
