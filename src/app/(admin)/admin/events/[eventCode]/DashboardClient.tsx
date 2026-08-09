'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Spinner } from '@/components/ui/Spinner'
import { StatCard } from '@/components/dashboard/StatCard'
import { ShieldAlertIcon } from '@/components/icons'
import { readDashboard, readTodayLegs, readAttention, type DashboardRow, type TodayLeg, type AttentionRow } from '@/lib/actions/dashboard'

import { TodayPanel } from './TodayPanel'
import { AttentionPanel } from '@/components/dashboard/AttentionPanel'

interface Props {
  eventId: string
  eventCode: string
}

export function DashboardClient({ eventId, eventCode }: Props) {
  const [dash, setDash] = useState<DashboardRow | null>(null)
  const [today, setToday] = useState<{ arrivals: TodayLeg[]; departures: TodayLeg[] }>({ arrivals: [], departures: [] })
  const [attn, setAttn] = useState<AttentionRow | null>(null)
  const [todayDate, setTodayDate] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const todayStr = new Date().toISOString().slice(0, 10)
      setTodayDate(todayStr)

      const [d, t, a] = await Promise.all([
        readDashboard(eventId),
        readTodayLegs(eventId, todayStr),
        readAttention(eventId),
      ])
      setDash(d)
      setToday(t)
      setAttn(a)
      setError(null)
    } catch {
      setError('Could not load the dashboard.')
    } finally {
      setLoading(false)
    }
  }, [eventId])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  // Refresh on focus + poll every 60s
  useEffect(() => {
    const onFocus = () => { void load() }
    window.addEventListener('focus', onFocus)
    const interval = setInterval(() => { void load() }, 60_000)
    return () => {
      window.removeEventListener('focus', onFocus)
      clearInterval(interval)
    }
  }, [load])

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner size="md" />
      </div>
    )
  }

  if (error || !dash) {
    return (
      <EmptyState
        icon={<ShieldAlertIcon className="h-7 w-7" />}
        title="Could not load the dashboard"
        description={error ?? 'No data returned.'}
        action={<Button onClick={load}>Retry</Button>}
      />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ---- Numbers ---- */}
      <section>
        <h2 className="eyebrow mb-3">RSVP</h2>
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Total groups" value={dash.totalGroups} note="families on the list" />
          <StatCard label="Total pax" value={dash.totalPax} note="confirmed, else expected" />
          <StatCard label="Confirmed" value={dash.rsvpConfirmed} tone="success" />
          <StatCard label="Pending" value={dash.rsvpPending} tone="warning" />
        </div>
      </section>

      <section>
        <h2 className="eyebrow mb-3">Today</h2>
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Arrivals today" value={dash.arrivalsToday} tone="info" />
          <StatCard label="Departures today" value={dash.departuresToday} tone="info" />
        </div>
      </section>

      <section>
        <h2 className="eyebrow mb-3">Rooms</h2>
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Guests roomed" value={dash.guestsRoomed} tone="info" />
          <StatCard label="Rooms available" value={null} tone="neutral" note="see Rooms screen" />
        </div>
      </section>

      <section>
        <h2 className="eyebrow mb-3">Deliveries</h2>
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Hampers done" value={dash.hampersDelivered} tone="success" />
          <StatCard label="Hampers pending" value={dash.hampersPending} tone="warning" />
        </div>
      </section>

      <section>
        <h2 className="eyebrow mb-3">Money</h2>
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Logistics spend" value={dash.logisticsExpense} tone="neutral" note="from trip expenses" />
        </div>
      </section>

      {/* ---- Messages ---- */}
      <section>
        <h2 className="eyebrow mb-3">WhatsApp</h2>
        <div className="grid grid-cols-2 gap-3">
          <Link
            href={`/admin/events/${eventCode}/messages`}
            className="tap flex flex-col gap-1 rounded-2xl border border-border bg-surface p-4"
          >
            <span className="text-sm font-semibold text-fg">Prepare messages</span>
            <span className="text-xs text-muted">Generate + copy / download per family</span>
          </Link>
          <Link
            href={`/admin/events/${eventCode}/messages/send`}
            className="tap flex flex-col gap-1 rounded-2xl border border-border bg-surface p-4"
          >
            <span className="text-sm font-semibold text-fg">Send messages</span>
            <span className="text-xs text-muted">Bulk send via WhatsApp provider</span>
          </Link>
          <Link
            href={`/admin/events/${eventCode}/messages/templates`}
            className="tap flex flex-col gap-1 rounded-2xl border border-border bg-surface p-4"
          >
            <span className="text-sm font-semibold text-fg">Templates</span>
            <span className="text-xs text-muted">Edit message templates</span>
          </Link>
          <Link
            href={`/admin/events/${eventCode}/messages/log`}
            className="tap flex flex-col gap-1 rounded-2xl border border-border bg-surface p-4"
          >
            <span className="text-sm font-semibold text-fg">Message log</span>
            <span className="text-xs text-muted">Status of every send</span>
          </Link>
        </div>
      </section>

      {/* ---- Today detail ---- */}
      <TodayPanel arrivals={today.arrivals} departures={today.departures} date={todayDate} eventCode={eventCode} />

      {/* ---- Attention ---- */}
      {attn && <AttentionPanel attn={attn} eventCode={eventCode} />}

      <p className="text-xs leading-relaxed text-subtle">
        Refreshed on every visit and every 60 seconds. A zero means nothing has been recorded yet — if a read fails you get a message, never a silent zero.
      </p>
    </div>
  )
}
