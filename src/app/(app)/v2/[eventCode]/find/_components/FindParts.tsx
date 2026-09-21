'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'

import { SearchIcon } from '@/components/icons'
import { Badge } from '@/components/ui/Badge'
import { ListRow } from '@/components/ui/ListRow'
import { StatusPill } from '@/components/ui/StatusPill'
import { formatDate } from '@/lib/utils'
import { statusLabel, statusTone } from '@/lib/status'
import type { GuestProfileRow } from '@/lib/query/reads'

/**
 * The pieces both roles' search screens share.
 *
 * One row component and one input, so the client's screen and the staff's
 * screen cannot drift into two different-looking searches — which is the
 * failure mode this brief's "reuse ListRow and StatusPill, do not invent a row
 * style" is aimed at. Nothing here reads data; it only draws it.
 */

/* ------------------------------------------------------------------ */
/* The field                                                           */
/* ------------------------------------------------------------------ */

export interface FindSearchFieldProps {
  value: string
  onChange: (next: string) => void
  /** Shown as the placeholder and named in the hint line under the field. */
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
export function FindSearchField({ value, onChange, placeholder, busy }: FindSearchFieldProps) {
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

export interface FindResultRowProps {
  row: GuestProfileRow
  /** The term that produced this row, for the highlighting. */
  term: string
  /**
   * Where the row goes, or null. A client's row does NOT link: the family
   * record it would open is a staff screen, and a result that bounces the
   * person who tapped it is worse than a result that is simply read.
   */
  href: string | null
}

/**
 * One search result, in the brief's order: name, family, room number, RSVP
 * status, arrival day.
 *
 * `ListRow` gives the first three (identifier, meta, right) and the pill is
 * `StatusPill` with the app's own status vocabulary, so "Confirmed" here reads
 * exactly as it reads on the call queue. The arrival day is a `Badge`, not a
 * second `StatusPill`, because an arrival date is a fact and not a state —
 * giving it a status colour would say something the data does not.
 */
export function FindResultRow({ row, term, href }: FindResultRowProps) {
  const name = row.guest_name?.trim() || row.family_head?.trim() || 'Name not recorded'
  const head = row.family_head?.trim() || null
  const room = row.room_number?.trim() || null
  const arrival = formatDate(row.arrival_date)
  const status = statusLabel(row.rsvp_status)

  // Family, then room. "Family of X" is only said when the head is a DIFFERENT
  // person from the row's own name — otherwise the row reads "Rakesh Sharma /
  // Family of Rakesh Sharma", which is noise at a glance.
  const meta = [head && head !== name ? `Family of ${head}` : null, room ? `Room ${room}` : 'No room yet']
    .filter(Boolean)
    .join(' · ')

  const inner = (
    <ListRow
      identifier={<Highlight text={name} term={term} />}
      meta={meta}
      right={
        <>
          <StatusPill tone={statusTone(row.rsvp_status)}>{status}</StatusPill>
          {arrival ? <Badge>Arrives {arrival}</Badge> : null}
        </>
      }
    />
  )

  const className =
    'tap block rounded-xl border border-rule-strong bg-surface transition-colors duration-press ease-ledger active:bg-surface-2'

  if (!href) {
    // Not a link, and not a dead one either: a client reads the row and taps
    // nothing. `role="listitem"` because the list around it is a `role="list"`.
    return (
      <div className={className} role="listitem">
        {inner}
      </div>
    )
  }

  return (
    // `Link`, not a bare `<a>`: a plain anchor is a full document navigation
    // and in remote-shell mode there is no local bundle to land on.
    //
    // `prefetch={false}` IS LOAD-BEARING, and not for speed. The destination is
    // `rsvp/status/[groupId]`, whose server render calls `claimGroupForCall` and
    // TAKES THE 15-MINUTE CALLER LOCK. A prefetch is a real server render, so an
    // armed link under a thumb would lock families nobody opened — and a lock
    // has no manual release (CLAUDE.md §11b). Same warning as `GuestsClient`'s
    // row, same reason, copied rather than rediscovered.
    <Link href={href} prefetch={false} className={className} role="listitem">
      {inner}
    </Link>
  )
}

/* ------------------------------------------------------------------ */
/* Highlighting                                                        */
/* ------------------------------------------------------------------ */

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
