'use client'

import { useEffect, useState } from 'react'

import { CheckCircleIcon, RefreshIcon, ShieldAlertIcon } from '@/components/icons'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import {
  assignGroupToRoom,
  suggestRoomAssignments,
  type RoomSuggestionRow,
} from '@/lib/actions/rooms'

/**
 * R2 — room suggestions. SUGGESTS; a human CONFIRMS.
 *
 * Runs the suggest engine over every unallocated family and shows the top 3
 * candidate rooms, each with a plain-language reason. Tapping "Use this room"
 * assigns the whole family to that room (never split across rooms). The
 * database still enforces max_capacity and date-range overlap.
 *
 * A family with no valid single room is flagged, not split — the human does
 * multi-room assignment in the grid.
 */

export interface RoomSuggestPanelProps {
  eventId: string
}

export function RoomSuggestPanel({ eventId }: RoomSuggestPanelProps) {
  const [rows, setRows] = useState<RoomSuggestionRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [justAssigned, setJustAssigned] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const res = await suggestRoomAssignments(eventId)
      if (cancelled) return
      if (!res.ok) {
        setError(res.error)
        setRows([])
        return
      }
      setError(null)
      setRows(res.suggestions)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [eventId, reloadToken])

  async function handleUse(groupId: string, roomId: string) {
    setBusyId(groupId)
    setError(null)
    const res = await assignGroupToRoom(eventId, groupId, roomId)
    setBusyId(null)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setJustAssigned(groupId)
    // Refresh to drop the assigned family from the suggestion list.
    setReloadToken((n) => n + 1)
  }

  if (rows === null) {
    return (
      <Card>
        <CardBody className="py-8 text-center text-muted">Loading suggestions…</CardBody>
      </Card>
    )
  }

  if (rows.length === 0 && !error) {
    return (
      <Card>
        <CardBody className="flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-fg">No unallocated families</p>
            <p className="text-sm text-muted">Every confirmed family already has a room.</p>
          </div>
        </CardBody>
      </Card>
    )
  }

  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold text-fg">Suggested rooms</h3>
            <p className="text-sm text-muted">
              Top 3 per unallocated family. The engine suggests — you decide.
            </p>
          </div>
          <Button variant="ghost" onClick={() => setReloadToken((n) => n + 1)} aria-label="Refresh suggestions">
            <RefreshIcon className="h-5 w-5" aria-hidden />
          </Button>
        </div>

        {error ? (
          <p role="alert" className="rounded-xl border border-danger bg-tint-danger px-4 py-3 text-sm font-medium text-danger">
            <ShieldAlertIcon className="mr-1 inline h-4 w-4" aria-hidden />
            {error}
          </p>
        ) : null}

        {rows.map((row) => (
          <div key={row.groupId} className="rounded-xl border border-border bg-surface-2 px-4 py-3">
            <div className="mb-2 flex items-center gap-2">
              <p className="font-semibold text-fg">{row.headName}</p>
              <span className="rounded-full bg-tint-neutral px-2 py-0.5 text-xs font-semibold text-muted">
                {row.occupancy} {row.occupancy === 1 ? 'person' : 'people'}
              </span>
              {justAssigned === row.groupId ? (
                <CheckCircleIcon className="ml-auto h-5 w-5 text-ok" aria-hidden />
              ) : null}
            </div>

            {row.tooLarge ? (
              <p className="rounded-lg border border-warning bg-tint-warning px-3 py-2 text-sm text-warning">
                {row.tooLargeReason}
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {row.options.map((opt) => (
                  <li
                    key={opt.roomId}
                    className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-fg">
                        {opt.hotelName} · Room {opt.roomNumber}
                        {opt.floor ? ` (${opt.floor})` : ''}
                      </p>
                      <p className="text-xs text-muted">{opt.reason}</p>
                    </div>
                    <Button
                      size="md"
                      variant="secondary"
                      loading={busyId === row.groupId}
                      onClick={() => void handleUse(row.groupId, opt.roomId)}
                    >
                      Use
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </CardBody>
    </Card>
  )
}

export default RoomSuggestPanel
