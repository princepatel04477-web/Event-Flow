'use client'

import { CheckCircleIcon } from '@/components/icons'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { LinkButton } from '@/components/ui/LinkButton'
import {
  batchReference,
  commitCountsSentence,
  type CommitCounts,
} from '@/lib/import/commit-summary'

export interface CommitSummaryProps {
  counts: CommitCounts & { batchId: string | null }
  /**
   * The guest list, when the import screen could work the URL out. Null is a
   * real state (an unexpected pathname) and only removes the link — the Done
   * button below always works.
   */
  guestListHref: string | null
  onDone: () => void
}

/**
 * What the operator reads the moment a commit lands.
 *
 * It lives in `ImportPreview`, NOT in `PreviewStep`, and that placement is the
 * fix rather than a preference. `PreviewStep` is unmounted the instant an
 * import succeeds — the preview holds 238 parsed families and the screen
 * deliberately drops them once they are written — so a summary rendered inside
 * it was set and destroyed in the same commit and never appeared. Hoisting it
 * one level up is what lets the counts survive the reset that follows them.
 *
 * The next step is a link to the guest list, which is the screen that answers
 * "did my 238 families land?" without a second upload.
 */
export function CommitSummary({ counts, guestListHref, onDone }: CommitSummaryProps) {
  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <p className="flex items-center gap-2 font-semibold text-ink">
          <CheckCircleIcon className="h-5 w-5 shrink-0 text-ledger-green" aria-hidden />
          Import complete
        </p>

        <p className="text-sm text-muted">{commitCountsSentence(counts)}</p>

        <p className="text-xs text-subtle">{batchReference(counts.batchId)}.</p>

        <div className="flex flex-col gap-2 sm:flex-row">
          {guestListHref ? (
            <LinkButton href={guestListHref} fullWidth>
              Go to the guest list
            </LinkButton>
          ) : null}
          <Button variant="secondary" fullWidth onClick={onDone}>
            Done
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}

export default CommitSummary
