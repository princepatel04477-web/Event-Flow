'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import * as XLSX from 'xlsx'

import { importRooms, type RoomDraft } from '@/lib/actions/hotels'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { parseCapacity } from '@/lib/rooms/parse'

interface ParsedRoom extends RoomDraft {
  sheetRow: number
}

interface RoomProblem {
  sheetRow: number
  detail: string
}

/** Header spellings accepted for each column, matched case-insensitively. */
const HEADERS = {
  roomNumber: ['room_number', 'room number', 'room', 'room no', 'room no.', 'romm', 'number'],
  roomType: ['room_type', 'room type', 'type', 'category'],
  capacity: ['capacity', 'beds', 'bed', 'pax', 'max'],
  floor: ['floor', 'level'],
  hotel: ['hotel', 'hotel_name', 'hotel name'],
}

function pick(row: Record<string, unknown>, names: string[]): unknown {
  for (const key of Object.keys(row)) {
    if (names.includes(key.trim().toLowerCase().replace(/\s+/g, ' '))) return row[key]
  }
  return undefined
}

function text(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

/**
 * Excel import of a room list, idempotent on `(hotel, room_number)`.
 *
 * Re-running UPDATES rather than skipping: the sheet is the client's
 * corrected list, so a changed capacity or floor should land. That is the
 * deliberate difference from the "add rooms" paths above, which skip
 * anything that already exists.
 */
export function RoomImport({
  hotelId,
  eventId,
  eventCode,
}: {
  hotelId: string
  eventId: string
  eventCode: string
}) {
  const router = useRouter()
  const [rooms, setRooms] = useState<ParsedRoom[]>([])
  const [problems, setProblems] = useState<RoomProblem[]>([])
  const [filename, setFilename] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function onFile(file: File) {
    setError(null)
    setDone(null)
    setFilename(file.name)

    try {
      const book = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const sheet = book.Sheets[book.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null })

      const parsed: ParsedRoom[] = []
      const found: RoomProblem[] = []
      const seen = new Set<string>()

      rows.forEach((row, i) => {
        const sheetRow = i + 2 // header is row 1
        const roomNumber = text(pick(row, HEADERS.roomNumber))
        if (roomNumber === '') {
          // A wholly blank row is padding, not a problem worth reporting.
          if (Object.values(row).every((v) => v === null || text(v) === '')) return
          found.push({ sheetRow, detail: 'No room number on this row.' })
          return
        }
        if (seen.has(roomNumber)) {
          found.push({ sheetRow, detail: `Room ${roomNumber} appears more than once in the sheet.` })
          return
        }

        const capacity = parseCapacity(text(pick(row, HEADERS.capacity)))
        if (capacity.error || capacity.value === null) {
          found.push({ sheetRow, detail: `Room ${roomNumber}: ${capacity.error}` })
          return
        }

        seen.add(roomNumber)
        parsed.push({
          sheetRow,
          roomNumber,
          roomType: text(pick(row, HEADERS.roomType)) || null,
          capacity: capacity.value,
          floor: text(pick(row, HEADERS.floor)) || null,
        })
      })

      setRooms(parsed)
      setProblems(found)
    } catch {
      setError('That file could not be read as a spreadsheet.')
      setRooms([])
      setProblems([])
    }
  }

  async function commit() {
    if (rooms.length === 0) return
    setError(null)
    setBusy(true)
    const result = await importRooms(hotelId, eventId, eventCode, rooms)
    setBusy(false)

    if (!result.ok) {
      setError(result.error)
      return
    }
    setDone(`${result.data.inserted} added, ${result.data.updated} updated.`)
    setRooms([])
    setProblems([])
    setFilename(null)
    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <p className="font-semibold text-fg">Import a room sheet</p>
          <p className="text-xs text-muted">
            Columns: room_number, room_type, capacity, floor. Re-importing updates rather than
            duplicating.
          </p>
        </CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col gap-3">
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void onFile(file)
          }}
          className="tap block w-full rounded-xl border border-border-strong bg-surface px-3 py-2.5 text-base text-fg file:mr-3 file:rounded-lg file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-fg"
        />

        {filename ? <p className="text-xs text-subtle">{filename}</p> : null}

        {rooms.length > 0 ? (
          <div className="rounded-xl border border-border bg-surface-2 p-3">
            <p className="text-sm font-semibold text-fg">{rooms.length} rooms read</p>
            <p className="mt-0.5 text-xs break-words text-muted">
              {rooms.slice(0, 30).map((r) => r.roomNumber).join(', ')}
              {rooms.length > 30 ? ` … and ${rooms.length - 30} more` : ''}
            </p>
          </div>
        ) : null}

        {problems.length > 0 ? (
          <div className="rounded-xl border border-danger/40 bg-tint-danger p-3 text-xs text-danger">
            <p className="font-semibold">
              {problems.length} row{problems.length === 1 ? '' : 's'} need your attention — these
              will not be imported:
            </p>
            <ul className="mt-1 list-inside list-disc">
              {problems.slice(0, 12).map((p) => (
                <li key={p.sheetRow}>
                  Row {p.sheetRow}: {p.detail}
                </li>
              ))}
            </ul>
            {problems.length > 12 ? <p className="mt-1">…and {problems.length - 12} more.</p> : null}
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm font-medium text-danger">
            {error}
          </p>
        ) : null}
        {done ? <p className="text-sm font-medium text-success">{done}</p> : null}

        {rooms.length > 0 ? (
          <Button fullWidth onClick={commit} loading={busy} disabled={busy}>
            Import {rooms.length} room{rooms.length === 1 ? '' : 's'}
          </Button>
        ) : null}
      </CardBody>
    </Card>
  )
}

export default RoomImport
