// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
}))

vi.mock('../concepts.functions', () => ({
  addConceptEdgeFn: vi.fn(),
  removeConceptEdgeFn: vi.fn(),
  setConceptStatusFn: vi.fn(),
  updateConceptFn: vi.fn(),
}))

import type { ConceptReviewItem } from '../concepts.schema'
import { ConceptCard } from './concept-card'

const BASE_CONCEPT: ConceptReviewItem = {
  id: 'c1',
  language: 'rust',
  slug: 'rust.async.send',
  difficulty: 3,
  status: 'draft',
  edges: [],
}

describe('ConceptCard', () => {
  it('shows no excluded badge when every edge is ok', () => {
    render(
      <ConceptCard
        concept={{
          ...BASE_CONCEPT,
          edges: [
            {
              fromConceptId: 'c1',
              toConceptId: 'c2',
              fromSlug: 'rust.async.send',
              toSlug: 'rust.lifetimes',
              kind: 'prerequisite',
              validation: 'ok',
            },
          ],
        }}
      />,
    )

    expect(screen.queryByText(/^Excluded —/)).not.toBeInTheDocument()
  })

  it('shows a single verdict in the card-level badge for one failing edge', () => {
    render(
      <ConceptCard
        concept={{
          ...BASE_CONCEPT,
          edges: [
            {
              fromConceptId: 'c1',
              toConceptId: 'c2',
              fromSlug: 'rust.async.send',
              toSlug: 'rust.lifetimes',
              kind: 'prerequisite',
              validation: 'cycle',
            },
          ],
        }}
      />,
    )

    expect(screen.getByText('Excluded — cycle')).toBeInTheDocument()
  })

  it('lists every distinct failing verdict when several edges are excluded', () => {
    render(
      <ConceptCard
        concept={{
          ...BASE_CONCEPT,
          edges: [
            {
              fromConceptId: 'c1',
              toConceptId: 'c2',
              fromSlug: 'rust.async.send',
              toSlug: 'rust.lifetimes',
              kind: 'prerequisite',
              validation: 'cycle',
            },
            {
              fromConceptId: 'c1',
              toConceptId: 'c3',
              fromSlug: 'rust.async.send',
              toSlug: 'rust.missing',
              kind: 'related',
              validation: 'dangling',
            },
          ],
        }}
      />,
    )

    expect(screen.getByText('Excluded — cycle, dangling')).toBeInTheDocument()
  })

  it('does not repeat the same verdict when several edges share it', () => {
    render(
      <ConceptCard
        concept={{
          ...BASE_CONCEPT,
          edges: [
            {
              fromConceptId: 'c1',
              toConceptId: 'c2',
              fromSlug: 'rust.async.send',
              toSlug: 'rust.lifetimes',
              kind: 'prerequisite',
              validation: 'cycle',
            },
            {
              fromConceptId: 'c1',
              toConceptId: 'c3',
              fromSlug: 'rust.async.send',
              toSlug: 'rust.borrow',
              kind: 'prerequisite',
              validation: 'cycle',
            },
          ],
        }}
      />,
    )

    expect(screen.getByText('Excluded — cycle')).toBeInTheDocument()
  })
})
