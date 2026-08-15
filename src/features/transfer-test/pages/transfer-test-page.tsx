import { Link } from '@tanstack/react-router'

import { TransferTestCard } from '../components/transfer-test-card'
import type { TransferTestOverview } from '../transfer-test.schema'

/**
 * The Transfer Test route (SPEC story 46, ADR-0015, ADR-0010, issue #17):
 * the learner generates a structurally different exercise for a Practiced
 * concept and solves it in the practice list, recording a Transfer Test
 * signal toward the Practiced → Demonstrated gate.
 */
export function TransferTestPage({
  overview,
}: {
  overview: TransferTestOverview
}): React.JSX.Element {
  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
      <header className="mb-10 grid gap-4 border-b border-border pb-8">
        <p className="text-xs font-bold uppercase tracking-[0.24em] text-primary">
          Transfer Test
        </p>
        <div>
          <h1 className="max-w-3xl font-display text-5xl font-semibold leading-[0.95] tracking-tight sm:text-6xl">
            One exercise pattern isn&apos;t mastery.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Generate a structurally different exercise for a concept you&apos;ve
            practiced — a debug-mode challenge, verified by the same Pre-Flight
            pipeline as any other exercise — and solve it to prove your mastery
            generalizes beyond the original pattern.
          </p>
        </div>
      </header>

      <TransferTestCard concepts={overview.concepts} />

      <footer className="mt-12 flex flex-col gap-2 border-t border-border pt-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>
          A passed Transfer Test is one of two required signals for promoting a
          concept to Demonstrated — the other is a passed Explanation
          Assessment.
        </span>
        <Link
          className="font-semibold text-foreground underline"
          to="/practice"
        >
          Go to the practice list
        </Link>
      </footer>
    </main>
  )
}
