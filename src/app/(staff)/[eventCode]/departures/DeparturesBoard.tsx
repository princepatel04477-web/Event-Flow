'use client'

import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { SearchIcon, CheckCircleIcon, AlertTriangleIcon } from '@/components/icons'
import { LinkButton } from '@/components/ui/LinkButton'
import { createClient } from '@/lib/supabase/client'
import { markDeparted } from '@/lib/actions/event-day'
import { traceFetch } from '@/lib/perf'
import { useStableData } from '@/lib/use-stable-data'
import { cn, formatDate } from '@/lib/utils'
import type { Database } from '@/lib/supabase/database.types'

type TravelLegRow = Database['public']['Tables']['travel_legs']['Row']
type GuestGroupRow = Database['public']['Tables']['guest_groups']['Row']

interface DepartureRow {
  leg: TravelLegRow
  group: GuestGroupRow
  roomLabel: string
  returnGiftUndelivered: boolean
}

const MODE_LABELS: Record<string, string> = {
  air: 'Air',
  train: 'Train',
  bus: 'Bus',
  cab: 'Cab',
  self_drive: 'Self-drive',
}

export interface DeparturesBoardProps {
  eventId: string
  eventCode: string
}

export function DeparturesBoard({ eventId, eventCode }: DeparturesBoardProps) {
  const supabase = useMemo(() => createClient(), [])

  const [search, setSearch] = useState('')
  const [todayOnly, setTodayOnly] = useState(false)
  const [notDepartedOnly, setNotDepartedOnly] = useState(false)
  const [modeFilter, setModeFilter] = useState('')
  const [pendingGroup, setPendingGroup] = useState<string | null>(null)

  const { data: rows, loading, error, reload } = useStableData<DepartureRow[] | null>(
    `departures:${eventId}`,
    async () => {
      const result = await traceFetch('departures :: load', () =>
        Promise.all([
          supabase
            .from('travel_legs')
            .select('*')
            .eq('event_id', eventId)
            .eq('direction', 'departure')
            .order('travel_date', { ascending: true })
            .order('travel_time', { ascending: true }),
          supabase.from('guest_groups').select('*').eq('event_id', eventId),
          supabase.from('room_assignments').select('*').eq('event_id', eventId),
          supabase.from('rooms').select('*').eq('event_id', eventId),
          supabase.from('hotels').select('*').eq('event_id', eventId),
          supabase.from('deliverables').select('*').eq('event_id', eventId),
        ]),
      )

      const [{ data: legs, error: legErr }, { data: groups }, { data: assignments }, { data: rooms }, { data: hotels }, { data: deliverables }] =
        result

      if (legErr) {
        throw new Error('Could not load departures. Check your connection and try again.')
      }

      const roomByGroup = new Map<string, string>()
      for (const a of assignments ?? []) {
        if (a.released_at !== null) continue
        const room = (rooms ?? []).find((r) => r.id === a.room_id)
        const hotel = room ? (hotels ?? []).find((h) => h.id === room.hotel_id) : undefined
        if (room) roomByGroup.set(a.group_id, [hotel?.name, room.room_number].filter(Boolean).join(' '))
      }

      const returnGiftDelivered = new Map<string, boolean>()
      for (const d of deliverables ?? []) {
        if (d.kind === 'return_gift' && d.status === 'delivered') returnGiftDelivered.set(d.group_id, true)
      }

      const groupById = new Map((groups ?? []).map((g) => [g.id, g]))
      return (legs ?? [])
        .filter((leg) => groupById.has(leg.group_id))
        .map((leg) => {
          const group = groupById.get(leg.group_id)!
          return {
            leg,
            group,
            roomLabel: roomByGroup.get(leg.group_id) ?? '',
            returnGiftUndelivered: group.needs_return_gift && !returnGiftDelivered.get(leg.group_id),
          }
        })
    },
  )

  const loadError = error instanceof Error ? error.message : error ? String(error) : null

  const today = new Date()
  const todayKey = toDateKey(today)

  const filtered = useMemo(() => {
    if (!rows) return []
    let list = rows
    if (todayOnly) list = list.filter((r) => r.leg.travel_date === todayKey)
    if (notDepartedOnly) list = list.filter((r) => r.leg.departed_at === null)
    if (modeFilter) list = list.filter((r) => r.leg.mode === modeFilter)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((r) => r.group.head_name.toLowerCase().includes(q))
    }
    return list
  }, [rows, todayOnly, notDepartedOnly, modeFilter, search, todayKey])

  const todayRows = filtered.filter((r) => r.leg.travel_date === todayKey)
  const laterRows = filtered.filter((r) => r.leg.travel_date !== todayKey)

  const expectedToday = rows?.filter((r) => r.leg.travel_date === todayKey).length ?? 0
  const departedToday = rows?.filter((r) => r.leg.travel_date === todayKey && r.leg.departed_at !== null).length ?? 0
  const flaggedToday = rows?.filter((r) => r.leg.travel_date === todayKey && r.returnGiftUndelivered).length ?? 0

  async function handleDepart(row: DepartureRow) {
    if (pendingGroup) return
    setPendingGroup(row.group.id)
    const result = await markDeparted(eventId, eventCode, row.group.id)
    setPendingGroup(null)
    if (!result.ok) {
       
      console.error(result.message)
      return
    }
    await reload()
  }

  if (loadError && !rows) {
    return (
      <EmptyState
        title="Could not load departures"
        description={loadError}
        action={<Button onClick={() => void reload()}>Try again</Button>}
      />
    )
  }

  if (loading || !rows) {
    // Loading: skeleton rows shaped like the departure cards, so the screen
    // does not flash a false "Nothing matches" empty state while the fetch
    // is in flight.
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="h-6 w-36 rounded bg-rule-strong" />
            <div className="mt-1.5 h-4 w-48 rounded bg-rule" />
          </div>
          <div className="h-11 w-32 rounded-xl bg-rule" />
        </div>
        <div className="rounded-xl border border-border bg-surface-2 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="h-8 w-16 rounded bg-rule" />
            <div className="h-8 w-16 rounded bg-rule" />
            <div className="h-8 w-16 rounded bg-rule" />
          </div>
        </div>
        <div className="h-12 rounded-xl border border-border bg-surface px-3" />
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="h-5 w-2/5 rounded bg-rule-strong" />
                <div className="mt-2 h-4 w-3/4 rounded bg-rule" />
                <div className="mt-1.5 h-4 w-1/2 rounded bg-rule" />
              </div>
              <div className="h-6 w-16 rounded-full bg-rule" />
            </div>
            <div className="mt-3 h-11 w-full rounded-xl bg-rule" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-fg">Departures board</h2>
          <p className="mt-0.5 text-sm text-muted">Mark families as departed on the day.</p>
        </div>
        <LinkButton variant="secondary" size="md" href={`/${eventCode}/logistics/departures/new`}>
          Record walk-up
        </LinkButton>
      </div>

      {/* Counts */}
      <Card className="border-border-strong bg-surface-2">
        <CardBody className="flex items-center justify-between py-2 text-center">
          <Count label="Departing today" value={expectedToday} />
          <Count label="Departed" value={departedToday} tone="success" />
          <Count label="Gift flags" value={flaggedToday} tone={flaggedToday > 0 ? 'warning' : 'neutral'} />
        </CardBody>
      </Card>

      {/* Search + filters */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 rounded-xl border border-border-strong bg-surface px-3">
          <SearchIcon className="h-5 w-5 shrink-0 text-muted" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by family name"
            className="min-h-12 w-full bg-transparent text-base text-fg placeholder:text-subtle focus:outline-none"
            aria-label="Search departures"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setTodayOnly(!todayOnly)}
            className={cn(
              'tap min-h-12 rounded-full border px-4 text-sm font-semibold active:opacity-80',
              todayOnly ? 'border-transparent bg-brand text-brand-fg' : 'border-rule-strong bg-surface text-ink active:bg-surface-2',
            )}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setNotDepartedOnly(!notDepartedOnly)}
            className={cn(
              'tap min-h-12 rounded-full border px-4 text-sm font-semibold active:opacity-80',
              notDepartedOnly ? 'border-transparent bg-brand text-brand-fg' : 'border-rule-strong bg-surface text-ink active:bg-surface-2',
            )}
          >
            Not departed
          </button>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {['', 'air', 'train', 'bus', 'cab', 'self_drive'].map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setModeFilter(m)}
              className={cn(
                'tap min-h-12 shrink-0 rounded-full border px-4 text-sm font-semibold active:opacity-80',
                modeFilter === m ? 'border-transparent bg-brand text-brand-fg' : 'border-rule-strong bg-surface text-ink active:bg-surface-2',
              )}
            >
              {m === '' ? 'All modes' : MODE_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      {rows && rows.length === 0 ? (
        <EmptyState title="No departures on file" description="No departure travel legs are recorded for this event yet." />
      ) : filtered.length === 0 ? (
        <EmptyState title="Nothing matches" description="No departures match — try clearing the search." />
      ) : (
        <div className="flex flex-col gap-4">
          {todayRows.length > 0 ? (
            <DayBlock
              title="Today"
              rows={todayRows}
              pendingGroup={pendingGroup}
              onDepart={handleDepart}
            />
          ) : null}
          {laterRows.length > 0 ? (
            <DayBlock
              title="Later"
              rows={laterRows}
              pendingGroup={pendingGroup}
              onDepart={handleDepart}
            />
          ) : null}
        </div>
      )}
    </div>
  )
}

function DayBlock({
  title,
  rows,
  pendingGroup,
  onDepart,
}: {
  title: string
  rows: DepartureRow[]
  pendingGroup: string | null
  onDepart: (row: DepartureRow) => void
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold tracking-wide text-muted uppercase">{title}</h3>
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <DepartureRowCard
            key={row.leg.id}
            row={row}
            pending={pendingGroup === row.group.id}
            onDepart={() => onDepart(row)}
          />
        ))}
      </ul>
    </section>
  )
}

function DepartureRowCard({
  row,
  pending,
  onDepart,
}: {
  row: DepartureRow
  pending: boolean
  onDepart: () => void
}) {
  const departed = row.leg.departed_at !== null

  return (
    <Card className={cn(departed && 'opacity-80')}>
      <CardBody className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold text-fg">{row.group.head_name}</p>
            <p className="mt-0.5 text-sm text-muted">
              {formatDate(row.leg.travel_date)} · {formatTime(row.leg.travel_time)}
              {row.leg.mode ? ` · ${MODE_LABELS[row.leg.mode] ?? row.leg.mode}` : ''}
              {row.leg.reference ? ` · ${row.leg.reference}` : ''}
            </p>
            <p className="mt-0.5 text-sm text-muted">
              {row.roomLabel ? `Room ${row.roomLabel}` : ''}
            </p>
          </div>
          {departed ? (
            <Badge tone="success">
              <CheckCircleIcon className="h-3.5 w-3.5" />
              Departed
            </Badge>
          ) : null}
        </div>

        {row.returnGiftUndelivered ? (
          <p className="flex items-center gap-1.5 rounded-lg bg-tint-warning px-2.5 py-1.5 text-xs font-medium text-warning">
            <AlertTriangleIcon className="h-4 w-4 shrink-0" />
            Return gift still undelivered — last chance before they leave.
          </p>
        ) : null}

        {!departed ? (
          <Button size="lg" fullWidth loading={pending} onClick={onDepart}>
            Mark departed
          </Button>
        ) : null}
      </CardBody>
    </Card>
  )
}

function Count({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'neutral' | 'success' | 'warning' }) {
  return (
    <div className="flex flex-col items-center">
      <span className={cn('text-2xl font-bold tabular-nums', tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : 'text-fg')}>
        {value}
      </span>
      <span className="text-xs text-muted">{label}</span>
    </div>
  )
}

function toDateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function formatTime(value: string | null): string {
  if (!value) return ''
  return value.length >= 5 ? value.slice(0, 5) : value
}
