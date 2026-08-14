// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    search,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    to?: string
    search?: { exerciseId?: string }
  }): React.JSX.Element => {
    const exerciseParam = search?.exerciseId
      ? `?exerciseId=${search.exerciseId}`
      : ''
    return (
      <a href={`${to ?? ''}${exerciseParam}`} {...props}>
        {children}
      </a>
    )
  },
}))

vi.mock('../retrieval.functions', () => ({
  startRetrievalReviewFn: vi.fn(),
}))

import { startRetrievalReviewFn } from '../retrieval.functions'
import type { RetrievalQueueView } from '../retrieval.schema'
import { RetrievalQueueCard } from './retrieval-queue-card'

const VIEW: RetrievalQueueView = {
  highPriority: [
    {
      conceptId: 'c1',
      slug: 'rust.borrowing',
      difficulty: 3,
      masteryState: 'practiced',
      scheduleStage: 0,
      intervalLabel: '1 day',
      dueAt: new Date(Date.now() - 60_000).toISOString(),
      priorityScore: 1_000_050,
      status: 'high-priority',
      remediation: true,
    },
  ],
  due: [
    {
      conceptId: 'c2',
      slug: 'rust.ownership',
      difficulty: 2,
      masteryState: 'demonstrated',
      scheduleStage: 1,
      intervalLabel: '3 days',
      dueAt: new Date(Date.now() - 60_000).toISOString(),
      priorityScore: 40,
      status: 'due',
      remediation: false,
    },
  ],
  upcoming: [
    {
      conceptId: 'c3',
      slug: 'rust.async.send',
      difficulty: 4,
      masteryState: 'retained',
      scheduleStage: 2,
      intervalLabel: '7 days',
      dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      priorityScore: 25,
      status: 'upcoming',
      remediation: false,
    },
  ],
  dueCount: 2,
}

describe('RetrievalQueueCard', () => {
  const startMock = vi.mocked(startRetrievalReviewFn)

  beforeEach(() => {
    startMock.mockReset()
  })

  it('shows an empty-state message when nothing is due', () => {
    render(
      <RetrievalQueueCard
        view={{ highPriority: [], due: [], upcoming: [], dueCount: 0 }}
      />,
    )

    expect(screen.getByText(/nothing is due for review/i)).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /start refresher test/i }),
    ).not.toBeInTheDocument()
  })

  it('lists high-priority and due entries with mastery and remediation markers', () => {
    render(<RetrievalQueueCard view={VIEW} />)

    expect(screen.getByText('rust.borrowing')).toBeInTheDocument()
    expect(screen.getByText('rust.ownership')).toBeInTheDocument()
    expect(screen.getByText('Failed previous review')).toBeInTheDocument()
    expect(screen.getByText('Demonstrated')).toBeInTheDocument()
    expect(screen.getByText('2 due concepts')).toBeInTheDocument()
  })

  it('hides upcoming entries in compact mode and links to the Daily Review', () => {
    render(<RetrievalQueueCard compact view={VIEW} />)

    expect(screen.queryByText('rust.async.send')).not.toBeInTheDocument()
    expect(screen.getByText(/1 concept is upcoming/)).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /open the daily review/i }),
    ).toHaveAttribute('href', '/retrieval')
  })

  it('shows the upcoming bucket on the full view', () => {
    render(<RetrievalQueueCard view={VIEW} />)

    expect(screen.getByText('rust.async.send')).toBeInTheDocument()
    expect(screen.getByText('Upcoming')).toBeInTheDocument()
  })

  it('starts a Refresher Test on click and hands off to the practice list', async () => {
    const user = userEvent.setup()
    startMock.mockResolvedValue({
      exerciseId: 'ex1',
      slug: 'test-exercise',
      title: 'Review exercise',
      conceptSlug: 'rust.borrowing',
      reused: true,
    })

    render(<RetrievalQueueCard view={VIEW} />)

    const startButtons = screen.getAllByRole('button', {
      name: /start refresher test/i,
    })
    const firstButton = startButtons[0]
    if (!firstButton) throw new Error('expected a start button')
    await user.click(firstButton)

    expect(startMock).toHaveBeenCalledWith({
      data: { conceptId: 'c1' },
    })
    expect(screen.getByText(/your refresher test for/i)).toBeInTheDocument()
    const handOff = screen.getByRole('link', { name: /go solve it/i })
    expect(handOff).toHaveAttribute('href', '/?exerciseId=ex1')
  })

  it('surfaces a start error', async () => {
    const user = userEvent.setup()
    startMock.mockRejectedValue(
      new Error('That concept is not due for a Refresher Test yet.'),
    )

    render(<RetrievalQueueCard view={VIEW} />)

    const startButtons = screen.getAllByRole('button', {
      name: /start refresher test/i,
    })
    const firstButton = startButtons[0]
    if (!firstButton) throw new Error('expected a start button')
    await user.click(firstButton)

    expect(
      screen.getByText(/not due for a refresher test yet/i),
    ).toBeInTheDocument()
  })
})
