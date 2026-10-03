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
import { InboxIcon, BuildingIcon, CarIcon, GridIcon, PhoneIcon, SlidersIcon } from '@/components/icons'
import { EventPill } from '@/components/nav/EventPill'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { NowCard } from '@/components/ui/NowCard'
import { useState } from 'react'
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
  { name: 'Bone', token: 'bg-paper', hex: '#F4F1EA', note: 'the ground' },
  { name: 'Surface', token: 'bg-surface', hex: '#FFFFFF', note: 'cards and sheets' },
  { name: 'Ink', token: 'bg-ink', hex: '#141311', note: 'reading text · 16.5:1' },
  { name: 'Muted', token: 'bg-muted', hex: '#5C574E', note: 'secondary · 6.4:1' },
  { name: 'Neel', token: 'bg-brand', hex: '#2F2BD8', note: 'ACTION · 7.6:1' },
  { name: 'Haldi', token: 'bg-highlight', hex: '#F5B301', note: 'NOW · fill only' },
  { name: 'Green', token: 'bg-ledger-green', hex: '#16794A', note: 'COMPLETED · 4.8:1' },
  { name: 'Amber', token: 'bg-ledger-amber', hex: '#8A5A00', note: 'WAITING · 5.3:1' },
  { name: 'Red', token: 'bg-ledger-red', hex: '#C62A1E', note: 'ATTENTION · 5.0:1' },
]

export default function EvidencePage() {
  return (
    <main className="mx-auto w-full max-w-[480px] px-4 pt-6 pb-16">
      <PageTitle note="Field software for a wedding, on a cheap Android phone at 11pm.">
        EventFlow
      </PageTitle>

      <Ui4Shell />

      {/* Palette */}
      <section className="mt-8 flex flex-col gap-3">
        <SectionHead eyebrow="Ground" title="Nine colours, four meanings" />
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
          Emerald means COMPLETED and signal means ATTENTION. Neither is ever used
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
            <p className="font-display text-2xl tracking-[0.05em] text-ink uppercase">
              Call queue
            </p>
            <p className="mt-1 text-xs text-muted">
              Screen titles and section headings, uppercase and lightly tracked. Figures
              still go to the mono face below, so a column of them lines up.
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
          <FieldRow label="Guests confirmed" mono value="6" />
          <FieldRow label="Guests expected" mono value="6" />
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

/**
 * UI4 "Haldi & Ink" — the shell pieces, arranged as a phone screen would show
 * them: the header with its event pill, the section switcher, the Now card,
 * the buttons, a draggable sheet and the tab bar. Real components where they
 * exist; the switcher and bar are drawn statically because theirs read the
 * router and the section model.
 */
function Ui4Shell() {
  const [sheet, setSheet] = useState(false)
  return (
    <section className="mt-6 flex flex-col gap-5">
      <div className="flex flex-col items-start gap-1">
        <EventPill
          event={{ code: 'SHARMA26', name: 'Sharma–Patel Wedding' }}
          memberships={[
            { eventId: 'a', eventCode: 'SHARMA26', eventName: 'Sharma–Patel Wedding', role: 'event_team' },
            { eventId: 'b', eventCode: 'PATEL27', eventName: 'Patel–Desai Wedding', role: 'event_team' },
          ]}
          isAdmin
        />
        <h2 className="font-display text-[2rem] leading-[1.1] text-ink">Hospitality</h2>
      </div>

      <nav aria-label="Hospitality screens" className="-mx-4 flex gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none]">
        {['Rooms', 'Check in / out', 'Rooming list', 'Hampers'].map((label, i) => (
          <span
            key={label}
            className={
              'flex min-h-10 shrink-0 items-center whitespace-nowrap rounded-full border px-4 text-sm font-medium ' +
              (i === 0 ? 'border-brand bg-brand text-brand-fg' : 'border-rule-strong bg-surface text-ink')
            }
          >
            {label}
          </span>
        ))}
      </nav>

      <div className="rounded-2xl bg-now p-5 text-now-fg shadow-e2">
        <p className="eyebrow text-highlight">Today</p>
        <p className="mt-2 font-display text-[4.5rem] leading-none">
          412 <span className="text-3xl italic text-now-muted">guests</span>
        </p>
        <p className="mt-2 text-base text-now-muted">from 238 families · 62 still to call</p>
      </div>

      <NowCard
        eyebrow="Call next"
        headline="Shah Parivar — રમેશભાઈ શાહ"
        context="Surat · 6 invited · No answer yesterday 7:40pm"
        actionLabel="Call Rameshbhai"
        onPress={() => {}}
      />

      <div className="grid grid-cols-2 gap-3">
        <Button>Save</Button>
        <Button variant="secondary">Not now</Button>
        <Button variant="now">Call</Button>
        <Button variant="danger">Remove</Button>
      </div>

      <Button variant="secondary" onClick={() => setSheet(true)}>
        Open a sheet — drag its handle down
      </Button>
      <BottomSheet open={sheet} onClose={() => setSheet(false)} label="Example sheet">
        <h3 className="font-display text-2xl text-ink">Place the Shah family</h3>
        <p className="mt-2 text-base text-muted">Drag the handle down past a third of the sheet, or flick it, to close.</p>
        <div className="mt-4">
          <Button fullWidth onClick={() => setSheet(false)}>
            Put in room 304
          </Button>
        </div>
      </BottomSheet>

      <nav aria-label="Tab bar example" className="-mx-4 grid grid-cols-5 border-t border-rule bg-nav">
        {[
          { label: 'Today', icon: <GridIcon className="h-6 w-6" /> },
          { label: 'Calls', icon: <PhoneIcon className="h-6 w-6" /> },
          { label: 'Hospitality', icon: <BuildingIcon className="h-6 w-6" />, active: true },
          { label: 'Logistics', icon: <CarIcon className="h-6 w-6" /> },
          { label: 'Control', icon: <SlidersIcon className="h-6 w-6" /> },
        ].map((tab) => (
          <span
            key={tab.label}
            className={'flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium ' + (tab.active ? 'text-brand' : 'text-muted')}
          >
            <span className={'flex h-7 w-9 items-center justify-center rounded-full ' + (tab.active ? 'bg-brand-tint' : '')}>
              {tab.icon}
            </span>
            <span className="max-w-full truncate">{tab.label}</span>
          </span>
        ))}
      </nav>
    </section>
  )
}
