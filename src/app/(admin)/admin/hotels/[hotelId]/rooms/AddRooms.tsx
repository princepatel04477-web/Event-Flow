'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import { createRooms, type RoomDraft } from '@/lib/actions/hotels'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { cn } from '@/lib/utils'
import {
  MAX_RANGE_SIZE,
  expandRoomRange,
  parseCapacity,
  parsePastedRooms,
} from '@/lib/rooms/parse'

type Mode = 'single' | 'range' | 'paste'

const MODE_LABELS: Record<Mode, string> = {
  single: 'One room',
  range: 'A range',
  paste: 'Paste a list',
}

/**
 * The three ways rooms actually arrive.
 *
 * All three converge on the same preview-then-confirm shape, and all three
 * require a capacity: the database checks `capacity > 0` and the allocator
 * divides by it, so a room whose capacity nobody knows is worse than no room.
 */
export function AddRooms({
  hotelId,
  eventId,
  eventCode,
  existingNumbers,
}: {
  hotelId: string
  eventId: string
  eventCode: string
  existingNumbers: string[]
}) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('range')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const [single, setSingle] = useState('')
  const [rangeFrom, setRangeFrom] = useState('')
  const [rangeTo, setRangeTo] = useState('')
  const [pasted, setPasted] = useState('')

  const [capacity, setCapacity] = useState('2')
  const [roomType, setRoomType] = useState('')
  const [floor, setFloor] = useState('')

  const existing = useMemo(() => new Set(existingNumbers), [existingNumbers])
  const capacityCheck = parseCapacity(capacity)

  const preview = useMemo(() => {
    if (mode === 'single') {
      const value = single.trim()
      return {
        numbers: value ? [value] : [],
        duplicates: [] as string[],
        rejected: [] as { value: string; reason: string }[],
        error: null as string | null,
      }
    }
    if (mode === 'range') {
      const r = expandRoomRange(rangeFrom, rangeTo)
      return { numbers: r.numbers, duplicates: [], rejected: [], error: r.error }
    }
    const r = parsePastedRooms(pasted)
    return { numbers: r.accepted, duplicates: r.duplicates, rejected: r.rejected, error: null }
  }, [mode, single, rangeFrom, rangeTo, pasted])

  // Split against what is already in the hotel, so the count shown is the
  // count that will actually be created.
  const willCreate = preview.numbers.filter((n) => !existing.has(n))
  const willSkip = preview.numbers.filter((n) => existing.has(n))

  const blocked = Boolean(capacityCheck.error) || Boolean(preview.error) || willCreate.length === 0

  async function submit() {
    if (blocked || capacityCheck.value === null) return
    setError(null)
    setDone(null)
    setBusy(true)

    const drafts: RoomDraft[] = willCreate.map((roomNumber) => ({
      roomNumber,
      roomType: roomType.trim() || null,
      capacity: capacityCheck.value!,
      floor: floor.trim() || null,
    }))

    const result = await createRooms(hotelId, eventId, eventCode, drafts)
    setBusy(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    setDone(
      `Created ${result.data.created} room${result.data.created === 1 ? '' : 's'}` +
        (result.data.skipped > 0 ? `, skipped ${result.data.skipped} that already existed` : '') +
        '.',
    )
    setSingle('')
    setRangeFrom('')
    setRangeTo('')
    setPasted('')
    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <p className="font-semibold text-fg">Add rooms</p>
        </CardTitle>
      </CardHeader>
      <CardBody className="flex flex-col gap-4">
        <div className="flex gap-2">
          {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m)
                setError(null)
                setDone(null)
              }}
              className={cn(
                'tap min-h-11 flex-1 rounded-xl border px-3 text-sm font-semibold transition-colors',
                mode === m
                  ? 'border-transparent bg-brand text-brand-fg'
                  : 'border-border bg-surface text-fg hover:bg-surface-2',
              )}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>

        {mode === 'single' ? (
          <Input
            label="Room number"
            value={single}
            onChange={(e) => setSingle(e.target.value)}
            placeholder="201"
          />
        ) : null}

        {mode === 'range' ? (
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="From"
              inputMode="numeric"
              value={rangeFrom}
              onChange={(e) => setRangeFrom(e.target.value)}
              placeholder="201"
            />
            <Input
              label="To"
              inputMode="numeric"
              value={rangeTo}
              onChange={(e) => setRangeTo(e.target.value)}
              placeholder="220"
            />
          </div>
        ) : null}

        {mode === 'paste' ? (
          <Textarea
            label="Paste the list"
            hint="Commas, spaces or new lines all work. 201/202 counts as two rooms."
            rows={4}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder={'201, 202, 203\n204 205'}
          />
        ) : null}

        <div className="grid grid-cols-3 gap-3">
          <Input
            label="Capacity"
            required
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            error={capacity !== '' ? capacityCheck.error : null}
          />
          <Input label="Type" value={roomType} onChange={(e) => setRoomType(e.target.value)} placeholder="Deluxe" />
          <Input label="Floor" value={floor} onChange={(e) => setFloor(e.target.value)} placeholder="2" />
        </div>

        {preview.error ? (
          <p className="text-sm font-medium text-danger">{preview.error}</p>
        ) : null}

        {preview.numbers.length > 0 || preview.rejected.length > 0 ? (
          <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2 p-3">
            <p className="text-sm font-semibold text-fg">
              {willCreate.length} room{willCreate.length === 1 ? '' : 's'} will be created
            </p>

            {willCreate.length > 0 ? (
              <p className="text-xs break-words text-muted">
                {willCreate.slice(0, 40).join(', ')}
                {willCreate.length > 40 ? ` … and ${willCreate.length - 40} more` : ''}
              </p>
            ) : null}

            {willSkip.length > 0 ? (
              <p className="text-xs text-warning">
                Already in this hotel, will be skipped: {willSkip.slice(0, 20).join(', ')}
                {willSkip.length > 20 ? ` … and ${willSkip.length - 20} more` : ''}
              </p>
            ) : null}

            {preview.duplicates.length > 0 ? (
              <p className="text-xs text-muted">
                Repeated in your paste, counted once: {[...new Set(preview.duplicates)].join(', ')}
              </p>
            ) : null}

            {preview.rejected.length > 0 ? (
              <div className="text-xs text-danger">
                <p className="font-medium">Not created — these need your attention:</p>
                <ul className="mt-0.5 list-inside list-disc">
                  {preview.rejected.slice(0, 10).map((r, i) => (
                    <li key={`${r.value}-${i}`}>
                      &ldquo;{r.value}&rdquo; — {r.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        {mode === 'range' ? (
          <p className="text-xs text-subtle">Up to {MAX_RANGE_SIZE} rooms at a time.</p>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm font-medium text-danger">
            {error}
          </p>
        ) : null}
        {done ? (
          <p className="flex items-center gap-2 text-sm font-medium text-success">
            <Badge tone="success">Done</Badge>
            {done}
          </p>
        ) : null}

        <Button size="lg" fullWidth onClick={submit} loading={busy} disabled={blocked || busy}>
          {willCreate.length > 0
            ? `Create ${willCreate.length} room${willCreate.length === 1 ? '' : 's'}`
            : 'Create rooms'}
        </Button>
      </CardBody>
    </Card>
  )
}

export default AddRooms
