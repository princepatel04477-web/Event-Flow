'use client'

import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { FieldRow } from '@/components/ui/FieldRow'
import { ListRow } from '@/components/ui/ListRow'
import { LoadingRows } from '@/components/ui/LoadingRows'
import { SectionHead } from '@/components/ui/SectionHead'
import { StatusPill } from '@/components/ui/StatusPill'
import { SyncChip } from '@/components/ui/SyncChip'
import { InboxIcon } from '@/components/icons'
import { statusLabel, statusTone } from '@/lib/status'

/**
 * NOT part of the app. A standalone evidence page that renders every design
 * primitive in isolation with fixture data, so the Q1 system can be
 * inspected and screenshotted without a database, auth, or a live event.
 *
 * Every primitive here is the real component from src/components/ui — this
 * page only arranges them. Screenshot at 360px with Playwright.
 */

const RSVP_SAMPLES = [
  'confirmed',
  'callback',
  'tentative',
  'unreachable',
  'not_started',
  'declined',
  'attempted',
] as const

const DELIVERY_SAMPLES = ['pending', 'assigned', 'delivered', 'not_required'] as const

const LEDGER_SAMPLES = ['balanced', 'departure_missing', 'no_arrival'] as const

const ROOM_SAMPLES = ['empty', 'partly_full', 'full', 'over_capacity'] as const

export default function EvidencePage() {
  return (
    <main className="mx-auto w-full max-w-[480px] px-4 pb-16">
      <SectionHead eyebrow="Ledger paper" title="EventFlow design system" />

      {/* Status vocabulary — every status, one definition */}
      <section className="mt-6 flex flex-col gap-2">
        <SectionHead eyebrow="Vocabulary" title="Every status, its word and its tone" />
        {RSVP_SAMPLES.map((s) => (
          <div key={s} className="flex items-center justify-between bg-paper px-3 py-2">
            <span className="font-mono text-sm text-muted">{s}</span>
            <StatusPill tone={statusTone(s)}>{statusLabel(s)}</StatusPill>
          </div>
        ))}
        {DELIVERY_SAMPLES.map((s) => (
          <div key={s} className="flex items-center justify-between bg-paper-band px-3 py-2">
            <span className="font-mono text-sm text-muted">{s}</span>
            <StatusPill tone={statusTone(s)}>{statusLabel(s)}</StatusPill>
          </div>
        ))}
        {LEDGER_SAMPLES.map((s) => (
          <div key={s} className="flex items-center justify-between bg-paper px-3 py-2">
            <span className="font-mono text-sm text-muted">{s}</span>
            <StatusPill tone={statusTone(s)}>{statusLabel(s)}</StatusPill>
          </div>
        ))}
        {ROOM_SAMPLES.map((s) => (
          <div key={s} className="flex items-center justify-between bg-paper-band px-3 py-2">
            <span className="font-mono text-sm text-muted">{s}</span>
            <StatusPill tone={statusTone(s)}>{statusLabel(s)}</StatusPill>
          </div>
        ))}
      </section>

      {/* ListRow — the ledger row with the margin rule */}
      <section className="mt-8 flex flex-col gap-2">
        <SectionHead eyebrow="ListRow" title="The ledger row, banded" />
        <ol className="relative ml-3 flex flex-col gap-px">
          <span
            aria-hidden
            className="absolute top-1 bottom-1 -left-3 w-0.5 rounded-full bg-ledger-red"
          />
          {[
            { id: 'Desai family', pax: '6', attempts: '2', tone: 'confirmed', lock: false },
            { id: 'Patel, Ramesh', pax: '4', attempts: '1', tone: 'callback', lock: true },
            { id: 'Shah family', pax: '9', attempts: '3', tone: 'unreachable', lock: false },
            { id: 'Mehta, Kiran', pax: '2', attempts: '1', tone: 'not_started', lock: false },
            { id: 'Joshi family', pax: '5', attempts: '0', tone: 'tentative', lock: false },
          ].map((r, i) => (
            <li
              key={r.id}
              className={i % 2 === 1 ? 'bg-paper-band' : 'bg-paper'}
            >
              <ListRow
                identifier={r.id}
                meta={
                  <>
                    <span>
                      <span className="font-mono tabular-nums">{r.pax}</span> pax
                    </span>
                    {' · '}
                    <span>
                      <span className="font-mono tabular-nums">{r.attempts}</span>{' '}
                      {r.attempts === '1' ? 'attempt' : 'attempts'}
                    </span>
                    {r.lock ? <span> · Locked</span> : null}
                  </>
                }
                right={
                  <StatusPill tone={statusTone(r.tone)}>{statusLabel(r.tone)}</StatusPill>
                }
              />
            </li>
          ))}
        </ol>
      </section>

      {/* FieldRow — label and mono value, nulls read "Not yet confirmed" */}
      <section className="mt-8 flex flex-col gap-2">
        <SectionHead eyebrow="FieldRow" title="Figures that line up" />
        <div className="flex flex-col gap-2 bg-paper px-3 py-3">
          <FieldRow label="Room" mono value="205" />
          <FieldRow label="Room" mono value="211" />
          <FieldRow label="PAX confirmed" mono value="6" />
          <FieldRow label="PAX expected" mono value="6" />
          <FieldRow label="Callback" mono value={null} />
          <FieldRow label="Arrival flight" mono value={null} />
          <FieldRow label="Balance" mono attention value="−2" />
          <FieldRow label="Departure" mono value="Not yet confirmed" />
        </div>
      </section>

      {/* SectionHead, SyncChip, LoadingRows, EmptyState, ErrorState */}
      <section className="mt-8 flex flex-col gap-2">
        <SectionHead eyebrow="States" title="Loading, empty, error, offline" />
        <LoadingRows count={4} />
        <div className="flex justify-start bg-paper py-2">
          <SyncChip count={3} what="call outcome" />
        </div>
        <EmptyState
          icon={<InboxIcon className="h-7 w-7" />}
          title="No families match these filters"
          description="Try clearing a filter — the queue isn't empty, this view just is."
        />
        <ErrorState
          title="Could not load the calling queue"
          description="Check your connection and try again. Your changes were saved."
          onRetry={() => {}}
        />
        <ErrorState
          title="Someone else is on this call right now"
          description="The family was claimed by another caller a moment ago. They will see it in their queue."
        />
      </section>
    </main>
  )
}
