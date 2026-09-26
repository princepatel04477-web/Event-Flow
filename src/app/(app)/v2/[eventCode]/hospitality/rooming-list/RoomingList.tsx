'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as XLSX from 'xlsx'

import { DownloadIcon, SearchIcon } from '@/components/icons'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { LoadingRows } from '@/components/ui/LoadingRows'
import { Progress } from '@/components/ui/Progress'
import { readRoomingList } from '@/lib/actions/rooming-list'
import { roomingListFileName, roomingListSheet } from '@/lib/export/rooming-list'
import { buildWorkbook } from '@/lib/export/workbook'
import { queryKeys } from '@/lib/query/keys'
import {
  DEFAULT_ROOMING_SORT,
  checkInLabel,
  familyLabel,
  filterRoomingRows,
  guestNamesLabel,
  hamperLabel,
  nextSort,
  roomingCountLine,
  roomingTiles,
  searchRoomingRows,
  sortRoomingRows,
  type RoomingColumn,
  type RoomingListRow,
  type RoomingSort,
  type RoomingTile,
} from '@/lib/rooms/rooming-list'
import { cn } from '@/lib/utils'

import { RoomingRoomSheet } from './_components/RoomingRoomSheet'

export interface RoomingListProps {
  eventId: string
  eventCode: string
  eventName: string
}

/**
 * The rooming list — the sheet the front desk works from.
 *
 * WHY IT IS A TABLE AND NOT A STACK OF CARDS. Every other list in v3 is a
 * register of `Row`s, and that is right when the row's subject is one person.
 * This screen's subject is a PLACE, and its reader is holding a printed sheet:
 * eight fields across a line, sorted hotel-then-room, is the shape the job
 * already has on paper. The table is `min-w` and scrolls INSIDE its own box on
 * a phone — the page itself never widens, and `overscroll-x-contain` stops the
 * swipe chaining to the shell behind it.
 *
 * THE TILES ARE FILTERS, NOT DECORATION. Each of the four numbers is a button
 * that shows the rows behind it, and `roomingTiles` computes every one of them
 * from the same predicate its filter uses, so a tile can never report 12 and
 * then show 9.
 *
 * ROWS OPEN THE ROOM, THE HAMPER CELL OPENS THE PROOF, THE FAMILY CELL OPENS THE
 * FAMILY. Three separate targets because they are three separate jobs, and none
 * of them is nested inside another: a `<button>` inside an `<a>` is invalid
 * HTML and announces as the wrong thing. The room number is the row's primary
 * target — it is the column a person scans first.
 */
export function RoomingList({ eventId, eventCode, eventName }: RoomingListProps) {
  const [sort, setSort] = useState<RoomingSort>(DEFAULT_ROOMING_SORT)
  const [term, setTerm] = useState('')
  const [tile, setTile] = useState<RoomingTile | null>(null)
  const [openRoomId, setOpenRoomId] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportNote, setExportNote] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  const { data, isPending, isFetching, error, refetch } = useQuery({
    queryKey: queryKeys.hospitality.roomingList(eventId),
    queryFn: () => readRoomingList(eventId),
  })

  const rows = useMemo(() => data?.rows ?? [], [data])

  // Filter, then search, then sort. The sort runs LAST so the tiebreak
  // (hotel, then room, then key) is applied to exactly the rows on screen —
  // sorting first and filtering after would leave the visible order decided by
  // rows that are no longer there.
  const shown = useMemo(
    () => sortRoomingRows(filterRoomingRows(searchRoomingRows(rows, term), tile), sort),
    [rows, term, tile, sort],
  )

  const tiles = useMemo(() => roomingTiles(rows), [rows])

  const openRoomRows = useMemo(
    () => (openRoomId === null ? [] : rows.filter((row) => row.roomId === openRoomId)),
    [rows, openRoomId],
  )

  const loadError = error instanceof Error ? error.message : error ? String(error) : null

  /**
   * Export the rows ON SCREEN, in the order they are on screen.
   *
   * Not the whole list: a person who filtered to "still to arrive" and sorted by
   * room has already decided what the hotel needs, and a workbook that quietly
   * re-reads the event would hand them a different sheet from the one they were
   * reading. See `roomingListSheet`.
   */
  function handleExport() {
    if (exporting || shown.length === 0) return
    setExportError(null)
    setExportNote(null)
    setExporting(true)
    try {
      const wb = buildWorkbook([roomingListSheet(shown)])
      XLSX.writeFile(wb, roomingListFileName(eventName))
      setExportNote(
        `${shown.length} ${shown.length === 1 ? 'row' : 'rows'} exported to Excel.`,
      )
    } catch {
      setExportError('Could not build the workbook. Try again in a moment.')
    } finally {
      setExporting(false)
    }
  }

  if (loadError && data === undefined) {
    return <ErrorState title={loadError} onRetry={() => void refetch()} />
  }

  if (data !== undefined && !data.ok) {
    return (
      <ErrorState
        title={data.error ?? 'The rooming list could not be read.'}
        onRetry={() => void refetch()}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4 pb-4">
      {/* Four numbers, four doors. A tile is on only while its list is showing,
          and tapping the lit one clears the filter — otherwise the only way out
          of a filter would be a control that is not on the screen. */}
      <div className="grid grid-cols-2 gap-2.5">
        {tiles.map((t) => {
          const active = tile === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTile(active ? null : t.id)}
              aria-pressed={active}
              className={cn(
                'tap flex min-h-11 flex-col justify-center rounded-2xl border bg-surface p-3 text-left',
                'transition-colors duration-press ease-ledger active:bg-surface-2',
                active ? 'border-brand' : 'border-rule-strong',
              )}
            >
              <Progress
                label={t.label}
                done={t.done}
                total={t.total}
                tone={t.id === 'hampers' ? 'amber' : 'brand'}
              />
            </button>
          )
        })}
      </div>

      {/* Searching a 168-room sheet by scrolling is not a plan. One field for
          both a name and a room number, because those are the two things a
          person has in front of them when they come to this screen. */}
      <label className="flex min-h-12 items-center gap-2 rounded-xl border border-rule-strong bg-surface px-3.5">
        <SearchIcon className="h-5 w-5 shrink-0 text-muted" />
        <span className="sr-only">Search a name or a room number</span>
        <input
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search a name or a room"
          className="min-w-0 flex-1 bg-transparent py-2.5 text-base text-ink outline-none placeholder:text-subtle"
        />
      </label>

      <div className="flex items-center justify-between gap-3">
        <p role="status" className="min-w-0 text-sm text-muted">
          {roomingCountLine(shown.length, rows.length, tile, term)}
        </p>
        {isFetching && data !== undefined ? (
          <p role="status" className="shrink-0 text-xs text-muted">
            Updating…
          </p>
        ) : null}
      </div>

      {isPending ? (
        <LoadingRows count={6} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No rooms yet"
          description="Add the rooms first — every room on the event appears on this sheet, occupied or not."
          action={
            <Link
              href={`/${eventCode}/hospitality/rooms`}
              className="tap flex min-h-12 items-center justify-center rounded-xl border-[1.5px] border-rule-strong bg-surface px-4 text-base font-semibold text-ink"
            >
              Go to the rooms board
            </Link>
          }
        />
      ) : shown.length === 0 ? (
        <p className="rounded-xl border border-rule-strong bg-surface px-3.5 py-3 text-sm text-muted">
          Nothing matches that search. Clear it, or tap the lit tile to show every room again.
        </p>
      ) : (
        // `overflow-x-auto` + `overscroll-x-contain`: the eight columns scroll
        // inside this box on a phone and the swipe does not chain to the shell,
        // so the page itself stays 390px wide (rule 7).
        <div className="overflow-x-auto overscroll-x-contain rounded-2xl border border-rule-strong bg-surface [scrollbar-width:thin]">
          <table className="w-full min-w-[42rem] border-collapse text-sm">
            <caption className="sr-only">
              Rooming list — one line per room and family, sorted hotel then room by default
            </caption>
            <thead>
              <tr className="border-b border-rule bg-surface-2 text-left">
                <th scope="col" className="px-3 py-2 text-xs font-semibold text-muted">
                  Hotel
                </th>
                <SortHeader column="room" label="Room no." sort={sort} onSort={setSort} />
                <SortHeader column="type" label="Type" sort={sort} onSort={setSort} />
                <SortHeader column="family" label="Family head" sort={sort} onSort={setSort} />
                <SortHeader column="pax" label="Pax" sort={sort} onSort={setSort} />
                <th scope="col" className="px-3 py-2 text-xs font-semibold text-muted">
                  Guest names
                </th>
                <SortHeader column="checkIn" label="Check-in" sort={sort} onSort={setSort} />
                <SortHeader column="hamper" label="Hamper" sort={sort} onSort={setSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {shown.map((row) => (
                <RoomingTr
                  key={row.key}
                  row={row}
                  eventCode={eventCode}
                  onOpenRoom={setOpenRoomId}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Button
          variant="secondary"
          size="lg"
          fullWidth
          loading={exporting}
          leadingIcon={<DownloadIcon className="h-5 w-5" />}
          onClick={handleExport}
          disabled={shown.length === 0}
        >
          {exporting ? 'Building the sheet…' : 'Export to Excel'}
        </Button>
        {exportNote ? (
          <p role="status" className="text-sm text-muted">
            {exportNote}
          </p>
        ) : null}
        {exportError ? (
          <p role="alert" className="text-sm font-medium text-ledger-red">
            {exportError}
          </p>
        ) : null}
      </div>

      <RoomingRoomSheet
        rows={openRoomRows}
        eventCode={eventCode}
        onClose={() => setOpenRoomId(null)}
      />
    </div>
  )
}

/** One sortable column heading. A new column starts ascending; the active one flips. */
function SortHeader({
  column,
  label,
  sort,
  onSort,
}: {
  column: RoomingColumn
  label: string
  sort: RoomingSort
  onSort: (next: RoomingSort) => void
}) {
  const active = sort.column === column
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className="p-0"
    >
      <button
        type="button"
        onClick={() => onSort(nextSort(sort, column))}
        className={cn(
          'tap flex min-h-11 w-full items-center gap-1 px-3 py-2 text-left text-xs font-semibold',
          active ? 'text-brand' : 'text-muted',
        )}
      >
        {label}
        <span aria-hidden className="text-[0.625rem] leading-none">
          {active ? (sort.direction === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  )
}

/**
 * One line on the sheet.
 *
 * Three targets per row, none nested in another: the room number opens the room
 * panel, a family head opens the family's RSVP record, and a hamper opens its
 * proof photo. Where there is nothing to open the cell is plain text — a cell
 * that looks tappable and is not is the dead end this rebuild is written
 * against.
 */
function RoomingTr({
  row,
  eventCode,
  onOpenRoom,
}: {
  row: RoomingListRow
  eventCode: string
  onOpenRoom: (roomId: string) => void
}) {
  return (
    <tr className="align-top">
      <td className="px-3 py-2 text-sm text-ink">{row.hotelName}</td>

      <td className="p-0">
        <button
          type="button"
          onClick={() => onOpenRoom(row.roomId)}
          aria-label={`Open room ${row.roomNumber} of ${row.hotelName}`}
          className="tap flex min-h-11 w-full items-center gap-1.5 px-3 py-2 text-left"
        >
          <span className="figure text-base font-semibold text-ink">{row.roomNumber}</span>
          {row.isBlocked ? <span className="text-xs text-muted">Out</span> : null}
        </button>
      </td>

      <td className="px-3 py-2 text-sm text-muted">{row.roomType ?? '—'}</td>

      <td className="p-0">
        {row.groupId === null ? (
          <span className="block px-3 py-2 text-sm text-subtle">—</span>
        ) : (
          <Link
            href={`/${eventCode}/rsvp/status/${row.groupId}`}
            className="tap flex min-h-11 items-center px-3 py-2 text-sm text-ink underline decoration-rule-strong underline-offset-4"
          >
            {familyLabel(row)}
          </Link>
        )}
      </td>

      <td className="figure px-3 py-2 text-sm text-ink">{row.pax}</td>

      <td className="min-w-[12rem] px-3 py-2 text-sm text-muted">{guestNamesLabel(row)}</td>

      <td className="px-3 py-2 text-sm text-muted">{checkInLabel(row)}</td>

      <td className="p-0">
        {row.hamperDeliverableId === null ? (
          <span className="block px-3 py-2 text-sm text-subtle">{hamperLabel(row)}</span>
        ) : (
          <Link
            href={`/${eventCode}/hospitality/deliveries/${row.hamperDeliverableId}`}
            className="tap flex min-h-11 items-center px-3 py-2 text-sm text-ink underline decoration-rule-strong underline-offset-4"
          >
            {hamperLabel(row)}
          </Link>
        )}
      </td>
    </tr>
  )
}

export default RoomingList
