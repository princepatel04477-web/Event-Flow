'use client'

import { useState } from 'react'

import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import type { RsvpBucket } from '@/lib/actions/dashboard'
import type { RsvpBucketId } from '@/lib/rsvp-buckets'

/**
 * The five confirmation tabs (A7).
 *
 * The dashboard's headline is PAX; these tabs are the breakdown behind it —
 * pick an answer and see its PAX, its family count, and the families
 * themselves. PAX and family count are ALWAYS shown together, because "0
 * families, 0 guests" and "0 families" are different sentences and only one of
 * them is true of a bucket that is empty.
 *
 * The chips scroll horizontally rather than wrapping to three rows: five
 * labels with two counts each do not fit a 390px screen, and a wrapped chip
 * block pushes the list below the fold exactly when it is being read.
 */
export function ConfirmationTabs({ buckets }: { buckets: RsvpBucket[] }) {
  const [active, setActive] = useState<RsvpBucketId>('confirmed')
  const current = buckets.find((bucket) => bucket.id === active) ?? buckets[0]

  return (
    <section className="flex flex-col gap-3">
      <h2 className="eyebrow">Confirmations</h2>

      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {buckets.map((bucket) => (
          <Chip
            key={bucket.id}
            selected={bucket.id === active}
            onClick={() => setActive(bucket.id)}
            className="flex-col items-start gap-0.5 py-1.5"
          >
            <span className="font-semibold">{bucket.label}</span>
            <span className="figure text-xs font-normal">
              {bucket.pax} pax · {bucket.families} {bucket.families === 1 ? 'family' : 'families'}
            </span>
          </Chip>
        ))}
      </div>

      {!current ? null : current.people.length === 0 ? (
        <EmptyState
          title={`No families ${current.label.toLowerCase()}`}
          description="This fills in as the calling team records answers."
        />
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-rule-strong bg-surface">
          {current.people.map((family) => (
            <li
              key={family.groupId}
              className="flex items-center justify-between gap-3 border-b border-rule px-4 py-3 last:border-b-0"
            >
              <span className="min-w-0 truncate text-base text-ink">{family.headName}</span>
              <span className="figure shrink-0 text-sm text-muted">
                {family.pax} {family.pax === 1 ? 'guest' : 'guests'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default ConfirmationTabs
