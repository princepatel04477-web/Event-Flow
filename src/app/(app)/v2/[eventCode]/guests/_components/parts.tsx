'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'

import { SearchIcon } from '@/components/icons'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { Button, buttonClassName } from '@/components/ui/Button'
import { Row, type RowTone } from '@/components/ui/Row'
import { initials } from '@/lib/ui/metrics'
import { statusLabel, statusTone, type StatusTone } from '@/lib/status'
import { formatDate } from '@/lib/utils'

/**
 * The pieces `/find` and `/guests` are both built from.
 *
 * ONE implementation, TWO routes. §3 makes Guests and Find the same thing seen
 * from two doors ("the search button in every header, not a tab"), so the
 * search field, the result row and the guest sheet live here and both routes
 * render them. Two copies of a search row is how the staff search and the
 * client search end up disagreeing about what "Confirmed" looks like.
 *
 * Nothing here reads data. It draws what it is handed, which is what makes it
 * safe to render for a client and for staff from the same component.
 */

/* ------------------------------------------------------------------ */
/* The field                                                           */
/* ------------------------------------------------------------------ */

export interface GuestSearchFieldProps {
  value: string
  onChange: (next: string) => void
  /** Shown as the placeholder and used as the field's accessible name. */
  placeholder: string
  /** The spinner is only for a search with NOTHING on screen yet (T4). */
  busy: boolean
}

/**
 * The one input, autofocused.
 *
 * `type="search"` so the handset keyboard says "Search" and carries a clear
 * affordance; `enterKeyHint="search"` for the same reason on Android;
 * `autoComplete="off"` because a WebView that offers to autofill an access code
 * here is offering the wrong thing.
 *
 * The clear button is a real 44px control rather than the browser's own ✕,
 * because the WebView's native clear is invisible on some Android builds and
 * this screen's users cannot be asked to find it.
 */
export function GuestSearchField({ value, onChange, placeholder, busy }: GuestSearchFieldProps) {
  return (
    <div className="flex min-h-12 items-center gap-2 rounded-xl border border-rule-strong bg-surface px-3 focus-within:border-brand">
      <SearchIcon className="h-5 w-5 shrink-0 text-muted" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        autoFocus
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        className="min-h-12 w-full min-w-0 bg-transparent text-base text-ink placeholder:text-subtle focus:outline-none"
      />
      {busy ? (
        <span
          aria-hidden
          className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-rule-strong border-t-brand"
        />
      ) : null}
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="tap -mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-lg leading-none text-muted active:bg-surface-2"
        >
          <span aria-hidden>✕</span>
        </button>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* The result row                                                      */
/* ------------------------------------------------------------------ */

/**
 * One row is one guest, not one family.
 *
 * A family head can answer for six people, but "who is this" is answered per
 * name, and the search already matches on a guest name. The family is the meta
 * line, which is where the reader needs it — beside the name, not instead of
 * it.
 */
export interface GuestListRow {
  guest_name: string | null
  family_head: string | null
  room_number: string | null
  rsvp_status: string | null
  arrival_date: string | null
}

/** The 4 tones `Row` knows, from the app's 4 status tones. */
export function rowTone(tone: StatusTone): RowTone {
  if (tone === 'done') return 'done'
  if (tone === 'attention') return 'problem'
  if (tone === 'active') return 'waiting'
  return 'neutral'
}

export interface GuestResultRowProps {
  guest: GuestListRow
  /** The term that produced this row, for the highlight. */
  term?: string
  onPress: () => void
}

export function GuestResultRow({ guest, term = '', onPress }: GuestResultRowProps) {
  const name = guest.guest_name?.trim() || guest.family_head?.trim() || 'Name not recorded'
  const head = guest.family_head?.trim() || null
  const room = guest.room_number?.trim() || null

  // Family, then room. "Family of X" is only said when the head is a DIFFERENT
  // person from the row's own name — otherwise the row reads "Rakesh Sharma /
  // Family of Rakesh Sharma", which is noise at a glance.
  const meta = [head && head !== name ? head : null, room ? `Room ${room}` : 'No room yet']
    .filter(Boolean)
    .join(' · ')

  return (
    <Row
      heading={name}
      headingNode={<Highlight text={name} term={term} />}
      meta={meta}
      initials={initials(name)}
      status={statusLabel(guest.rsvp_status)}
      tone={rowTone(statusTone(guest.rsvp_status))}
      onPress={onPress}
    />
  )
}

/**
 * Wrap the matched run of a name in a `<mark>`.
 *
 * WHY IT IS WORTH THE CODE. "Which Sharma is this?" is the whole question a
 * search result has to answer, and bolding the four letters the runner typed is
 * what answers it without reading the whole row. `mark` rather than a span so
 * the emphasis survives with stylesheets off and is announced as an insertion
 * by a screen reader instead of vanishing.
 *
 * Case-insensitive, first match only: a second highlight in one short name is
 * visual noise, and the token background is the brand tint — an existing token,
 * no new colour.
 */
export function Highlight({ text, term }: { text: string; term: string }): ReactNode {
  const needle = term.trim().toLocaleLowerCase()
  if (needle.length < 2) return text

  const at = text.toLocaleLowerCase().indexOf(needle)
  if (at < 0) return text

  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-xs bg-brand-tint text-ink">{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* The sheet                                                           */
/* ------------------------------------------------------------------ */

/**
 * Every field this sheet can show, structurally nullable.
 *
 * Deliberately structural rather than `GuestProfileRow`: the staff search
 * returns the RPC row, the client list returns the view row, and both have
 * these columns. Naming a union here would make the sheet's props a decision
 * about where the data came from, which the sheet does not care about.
 */
export interface GuestSheetData {
  guest_name: string | null
  family_head: string | null
  pax: number | null
  rsvp_status: string | null
  room_number: string | null
  hotel_name: string | null
  arrival_date: string | null
  arrival_time: string | null
  arrival_mode: string | null
  arrival_point: string | null
  departure_date: string | null
  departure_time: string | null
  departure_mode: string | null
  departure_point: string | null
  hamper_delivered: boolean | null
  needs_return_gift?: boolean | null
  return_gift_delivered: boolean | null
}

const MODE_LABELS: Record<string, string> = {
  air: 'Flight',
  train: 'Train',
  bus: 'Bus',
  cab: 'Cab',
  self_drive: 'Own car',
}

function describeLeg(leg: {
  date: string | null
  time: string | null
  mode: string | null
  point: string | null
}): { when: string; detail: string | null; known: boolean } {
  const date = formatDate(leg.date)
  // `travel_time` comes back as HH:MM:SS; the seconds are noise on a phone.
  const time = leg.time ? leg.time.slice(0, 5) : null
  const mode = leg.mode ? (MODE_LABELS[leg.mode] ?? leg.mode) : null
  const detail = [mode, leg.point].filter(Boolean).join(' · ') || null

  if (!date && !time) return { when: 'Not recorded', detail, known: false }
  return { when: [date, time].filter(Boolean).join(' · '), detail, known: true }
}

export interface GuestSheetProps {
  guest: GuestSheetData | null
  open: boolean
  onClose: () => void
  /**
   * Where the family's own record lives, or null.
   *
   * A client gets null: the record is a staff screen and a row that opens it
   * would bounce the person who tapped it. `GuestResultRow` follows the same
   * rule for its link.
   */
  familyHref: string | null
}

export function GuestSheet({ guest, open, onClose, familyHref }: GuestSheetProps) {
  if (!guest) return null

  const name = guest.guest_name?.trim() || guest.family_head?.trim() || 'Name not recorded'
  const arrival = describeLeg({
    date: guest.arrival_date,
    time: guest.arrival_time,
    mode: guest.arrival_mode,
    point: guest.arrival_point,
  })
  const departure = describeLeg({
    date: guest.departure_date,
    time: guest.departure_time,
    mode: guest.departure_mode,
    point: guest.departure_point,
  })

  const stay = guest.room_number
    ? [guest.hotel_name, `Room ${guest.room_number}`].filter(Boolean).join(' · ')
    : 'No room yet'

  return (
    <BottomSheet open={open} onClose={onClose} label={`${name} — guest details`}>
      <h2 className="font-display text-2xl leading-tight font-semibold text-ink text-pretty">
        {name}
      </h2>
      <p className="mt-1 text-sm text-muted">
        {[guest.family_head && guest.family_head !== name ? `Family of ${guest.family_head}` : null,
          typeof guest.pax === 'number' ? `${guest.pax} travelling` : null,
          statusLabel(guest.rsvp_status)]
          .filter(Boolean)
          .join(' · ')}
      </p>

      <dl className="mt-4 flex flex-col divide-y divide-rule border-t border-rule">
        <Fact label="Arrival">
          <Line when={arrival.when} detail={arrival.detail} known={arrival.known} />
        </Fact>
        <Fact label="Departure">
          <Line when={departure.when} detail={departure.detail} known={departure.known} />
        </Fact>
        <Fact label="Stay">
          <span className={guest.room_number ? 'text-ink' : 'text-muted'}>{stay}</span>
        </Fact>
        <Fact label="Hamper">
          <span className={guest.hamper_delivered ? 'text-ink' : 'text-muted'}>
            {guest.hamper_delivered ? 'Delivered' : 'Not delivered yet'}
          </span>
        </Fact>
        {/* Three states, not two: the view emits null for a family that is not
            owed a return gift, and "not delivered" against such a family is a
            problem that does not exist. */}
        {guest.needs_return_gift === null || guest.needs_return_gift === undefined ? null : (
          <Fact label="Return gift">
            <span className={guest.return_gift_delivered ? 'text-ink' : 'text-muted'}>
              {guest.needs_return_gift
                ? guest.return_gift_delivered
                  ? 'Delivered'
                  : 'Not delivered yet'
                : 'Not needed'}
            </span>
          </Fact>
        )}
      </dl>

      <div className="mt-5 flex flex-col gap-2">
        {familyHref ? (
          // `prefetch={false}` IS LOAD-BEARING. The destination is the family's
          // RSVP record, whose server render claims the 15-minute caller lock —
          // and a lock has no manual release (CLAUDE.md §11b). `LinkButton`
          // does not expose `prefetch`, so this is a `Link` wearing the
          // button's own class list — the same box, with prefetch off.
          <Link
            href={familyHref}
            prefetch={false}
            className={buttonClassName({ variant: 'primary', fullWidth: true })}
          >
            Open the family record
          </Link>
        ) : null}
        <Button variant="secondary" fullWidth onClick={onClose}>
          Close
        </Button>
      </div>
    </BottomSheet>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-3">
      <dt className="shrink-0 text-sm text-muted">{label}</dt>
      <dd className="min-w-0 text-right text-base leading-snug">{children}</dd>
    </div>
  )
}

function Line({ when, detail, known }: { when: string; detail: string | null; known: boolean }) {
  return (
    <span className="block">
      <span className={known ? 'block font-medium text-ink' : 'block text-muted'}>{when}</span>
      {detail ? <span className="mt-0.5 block text-sm text-muted">{detail}</span> : null}
    </span>
  )
}
