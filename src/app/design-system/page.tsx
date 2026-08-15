'use client'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { FieldRow } from '@/components/ui/FieldRow'
import { Input } from '@/components/ui/Input'
import { ListRow } from '@/components/ui/ListRow'
import { LoadingRows } from '@/components/ui/LoadingRows'
import { PageTitle } from '@/components/ui/PageTitle'
import { SectionHead } from '@/components/ui/SectionHead'
import { StampPill, StatusPill } from '@/components/ui/StatusPill'
import { SyncChip } from '@/components/ui/SyncChip'
import { StatCard } from '@/components/dashboard/StatCard'
import { InboxIcon } from '@/components/icons'
import { statusLabel, statusTone } from '@/lib/status'

/**
 * NOT part of the app. A standalone evidence page that renders every design
 * primitive in isolation with fixture data, so the system can be inspected
 * and screenshotted without a database, auth, or a live event.
 *
 * Every primitive here is the real component from src/components/ui — this
 * page only arranges them. Screenshot at 390px with Playwright.
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

const PALETTE = [
  { name: 'Ground', token: 'bg-paper', hex: '#071A1D', note: 'the page' },
  { name: 'Surface', token: 'bg-surface', hex: '#0E272B', note: 'every card' },
  { name: 'Chalk', token: 'bg-ink', hex: '#EDF3F2', note: 'reading text · 15.3:1' },
  { name: 'Slate', token: 'bg-muted', hex: '#8FA9AE', note: 'secondary · 7.2:1' },
  { name: 'Brass', token: 'bg-brand', hex: '#C9A96B', note: 'the accent · 8.0:1' },
  { name: 'Verdigris', token: 'bg-ledger-green', hex: '#4FC1A0', note: 'COMPLETED · 8.1:1' },
  { name: 'Signal', token: 'bg-ledger-red', hex: '#F2705F', note: 'ATTENTION · 6.2:1' },
]

export default function EvidencePage() {
  return (
    <main className="mx-auto w-full max-w-[480px] px-4 pt-6 pb-16">
      <PageTitle note="Field software for a wedding, on a cheap Android phone at 11pm.">
        EventFlow
      </PageTitle>

      {/* Palette */}
      <section className="mt-8 flex flex-col gap-3">
        <SectionHead eyebrow="Ground" title="Seven colours, and only seven" />
        <ul className="flex flex-col gap-2">
          {PALETTE.map((c) => (
            <li key={c.name} className="flex items-center gap-3">
              <span
                aria-hidden
                className={`h-9 w-9 shrink-0 rounded-lg border border-rule-strong ${c.token}`}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-base text-ink">{c.name}</span>
                <span className="block text-xs text-muted">{c.note}</span>
              </span>
              <span className="figure shrink-0 text-xs text-muted">{c.hex}</span>
            </li>
          ))}
        </ul>
        <p className="text-xs leading-relaxed text-muted">
          Verdigris means COMPLETED and signal means ATTENTION. Neither is ever used
          decoratively — the moment signal appears on a heading it stops meaning &ldquo;look
          here&rdquo;.
        </p>
      </section>

      {/* Type */}
      <section className="mt-8 flex flex-col gap-3">
        <SectionHead eyebrow="Type" title="Three roles" />
        <div className="flex flex-col gap-3 rounded-2xl border border-rule bg-surface p-4">
          <div>
            <p className="eyebrow mb-1.5">Display · Be Vietnam Pro</p>
            <p className="font-display text-2xl tracking-[0.14em] text-ink uppercase">
              Call queue
            </p>
            <p className="mt-1 text-xs text-muted">
              Screen titles, the couple&rsquo;s names, the seal. Nothing else — and never a
              figure, it has no tabular set.
            </p>
          </div>
          <div className="border-t border-rule pt-3">
            <p className="eyebrow mb-1.5">Body · Be Vietnam Pro + Plex Devanagari</p>
            <p className="text-lg text-ink">शर्मा परिवार · Rajesh Sharma</p>
            <p className="mt-1 text-xs text-muted">
              Both scripts, one family, one weight. Family names come off the Excel sheet in
              Devanagari and sit inline with Latin.
            </p>
          </div>
          <div className="border-t border-rule pt-3">
            <p className="eyebrow mb-1.5">Figures · IBM Plex Mono</p>
            <p className="figure text-2xl text-ink">
              465 · 238 · 21:47:52
            </p>
            <p className="mt-1 text-xs text-muted">
              Every number in the app, tabular, so a column of room numbers lines up and a
              counting animation does not jitter.
            </p>
          </div>
        </div>
      </section>

      {/* Controls */}
      <section className="mt-8 flex flex-col gap-3">
        <SectionHead eyebrow="Controls" title="A button commits. A chip filters." />
        <div className="flex flex-col gap-2.5">
          <Button size="lg" fullWidth>
            Save RSVP · Confirmed
          </Button>
          <Button variant="secondary" size="lg" fullWidth>
            Retake
          </Button>
          <Button variant="danger" size="lg" fullWidth>
            Release from room
          </Button>
          <Button variant="ghost" size="lg" fullWidth>
            Cancel
          </Button>
          <Button size="lg" fullWidth loading>
            Signing in
          </Button>
        </div>

        <div className="mt-1 flex flex-wrap gap-2">
          <Chip selected>Today</Chip>
          <Chip selected={false}>Needs pickup</Chip>
          <Chip selected tone="done">
            Confirmed
          </Chip>
          <Chip selected tone="attention">
            Unreachable
          </Chip>
        </div>

        <Input label="Event code" defaultValue="KRAD26" className="font-mono tracking-[0.3em]" />

        <p className="text-xs leading-relaxed text-muted">
          Rounded rectangles commit; full pills filter. Keeping the two shapes apart means a
          caller can tell what a control does before reading it.
        </p>
      </section>

      {/* Status vocabulary — every status, one definition */}
      <section className="mt-8 flex flex-col gap-2">
        <SectionHead eyebrow="Vocabulary" title="Every status, its word and its tone" />
        {[...RSVP_SAMPLES, ...DELIVERY_SAMPLES, ...LEDGER_SAMPLES, ...ROOM_SAMPLES].map(
          (s, i) => (
            <div
              key={s}
              className={`flex items-center justify-between rounded-lg px-3 py-2 ${
                i % 2 === 1 ? 'bg-surface' : ''
              }`}
            >
              <span className="font-mono text-sm text-muted">{s}</span>
              <StatusPill tone={statusTone(s)}>{statusLabel(s)}</StatusPill>
            </div>
          ),
        )}
        <div className="mt-1 flex items-center justify-between rounded-lg px-3 py-2">
          <span className="font-mono text-sm text-muted">sealed proof</span>
          <StampPill>Delivered</StampPill>
        </div>
        <div className="flex items-center justify-between rounded-lg bg-surface px-3 py-2">
          <span className="font-mono text-sm text-muted">non-status label</span>
          <Badge>Bride</Badge>
        </div>
      </section>

      {/* Counters */}
      <section className="mt-8 flex flex-col gap-3">
        <SectionHead eyebrow="Counters" title="A figure, and where to go about it" />
        <div className="grid grid-cols-2 gap-2.5">
          <StatCard
            label="RSVP confirmed"
            value={186}
            tone="success"
            note="of 238 families"
          />
          <StatCard
            label="RSVP pending"
            value={52}
            tone="warning"
            note="not started, attempted, callback, tentative"
          />
        </div>
      </section>

      {/* Sealed vs queued — the asymmetry the delivery run is built on */}
      <section className="mt-8 flex flex-col gap-2.5">
        <SectionHead eyebrow="Proof" title="Sealed is still. Queued breathes." />
        <div className="rounded-xl border border-ledger-green/35 border-l-4 border-l-ledger-green bg-green-tint p-3.5">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-full border-[1.5px] border-brand bg-brand-tint"
            >
              <span className="font-display text-[0.5rem] leading-none tracking-[0.14em] text-brand">
                SEALED
              </span>
              <span className="mt-0.5 h-1 w-1 rounded-full bg-ledger-green" />
            </span>
            <div>
              <p className="figure text-lg leading-none text-ink">301 · शर्मा परिवार</p>
              <div className="mt-2 flex items-center gap-2">
                <StampPill>Delivered</StampPill>
                <span className="text-xs text-muted">photo proof on file</span>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border-2 border-dashed border-muted/45 p-3.5">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="breathe flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-dotted border-muted/50"
            >
              <span className="h-2 w-2 rounded-full border-[1.5px] border-muted" />
            </span>
            <div>
              <p className="figure text-lg leading-none text-ink">306 · गहलोत परिवार</p>
              <div className="mt-2 flex items-center gap-2">
                <span className="inline-flex items-center rounded-md border-[1.5px] border-dashed border-muted/60 px-2.5 py-1 font-mono text-[0.625rem] font-semibold tracking-eyebrow text-muted uppercase">
                  Queued
                </span>
                <span className="text-xs text-muted">no proof on file</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ListRow */}
      <section className="mt-8 flex flex-col gap-2">
        <SectionHead eyebrow="ListRow" title="The register's row" />
        <ol className="flex flex-col gap-2">
          {[
            { id: 'शर्मा परिवार', pax: '6', attempts: '2', tone: 'callback' },
            { id: 'देशपांडे परिवार', pax: '8', attempts: '3', tone: 'confirmed' },
            { id: 'गहलोत परिवार', pax: '5', attempts: '4', tone: 'unreachable' },
            { id: 'कुलकर्णी परिवार', pax: '3', attempts: '1', tone: 'tentative' },
          ].map((r) => (
            <li key={r.id} className="rounded-xl border border-rule bg-surface">
              <ListRow
                identifier={r.id}
                meta={
                  <>
                    <span className="figure">{r.pax}</span> pax ·{' '}
                    <span className="figure">{r.attempts}</span>{' '}
                    {r.attempts === '1' ? 'attempt' : 'attempts'}
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

      {/* FieldRow */}
      <section className="mt-8 flex flex-col gap-2">
        <SectionHead eyebrow="FieldRow" title="Figures that line up" />
        <div className="flex flex-col gap-2 rounded-2xl border border-rule bg-surface px-3.5 py-3.5">
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

      {/* States */}
      <section className="mt-8 flex flex-col gap-2">
        <SectionHead eyebrow="States" title="Loading, empty, error, offline" />
        <LoadingRows count={4} />
        <div className="flex justify-start py-2">
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
      </section>

      {/* The client ground */}
      <section className="mt-8 flex flex-col gap-3">
        <SectionHead eyebrow="Client" title="The same tokens, on paper" />
        <div data-theme="client" className="rounded-2xl bg-paper p-4">
          <p className="eyebrow text-brand">12 – 15 November 2026</p>
          <p className="mt-2.5 font-display text-3xl leading-tight text-ink">
            Kanika <span className="text-brand">✕</span> Aryan
          </p>
          <p className="mt-2 text-sm text-muted">
            Everything we know about your family&rsquo;s stay, kept current by the team on
            the ground.
          </p>
          <div className="mt-3.5 grid grid-cols-3 gap-2">
            {[
              { v: '465', k: 'guests in all' },
              { v: '238', k: 'families' },
              { v: '74', k: 'arriving today' },
            ].map((s) => (
              <div key={s.k} className="rounded-lg border border-rule-strong bg-surface p-3">
                <div className="figure text-xl leading-none text-ink">{s.v}</div>
                <div className="mt-1.5 text-xs leading-tight text-muted">{s.k}</div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            Read in a hotel lobby in daylight, by the oldest user of the app. Not one control
            on it.
          </p>
        </div>
      </section>
    </main>
  )
}
