'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Row } from '@/components/ui/Row'
import { Spinner } from '@/components/ui/Spinner'
import { StatCard } from '@/components/dashboard/StatCard'
import { ChevronRightIcon, ShieldAlertIcon } from '@/components/icons'
import { readDashboard, readTodayLegs, readAttention, type DashboardRow, type TodayLeg, type AttentionRow } from '@/lib/actions/dashboard'

import { TodayPanel } from './TodayPanel'
import { AttentionPanel } from '@/components/dashboard/AttentionPanel'

interface Props {
  eventId: string
  eventCode: string
}

/**
 * A row-shaped link inside a `Card` that holds several of them.
 *
 * See the note at the call site: `Row`'s own `last:border-b-0` cannot supply
 * the divider once the row is nested in an anchor, so the anchor carries it.
 */
const ROW_LINK = 'tap block border-b border-rule last:border-b-0'

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
          <StatCard label="Guests expected" value={dash.totalPax} note="confirmed where known" />
          <StatCard label="Confirmed" value={dash.rsvpConfirmed} tone="success" />
          <StatCard label="Pending" value={dash.rsvpPending} tone="warning" />
        </div>
      </section>


      <section>
        <h2 className="eyebrow mb-3">Hospitality</h2>
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Guests roomed" value={dash.guestsRoomed} tone="info" />
          <StatCard label="Rooms available" value={null} tone="neutral" note="see Hospitality screen" />
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

      {/* ---- Messages & access ----
          Five destinations, one register. They used to be five bordered tiles
          in a two-column grid, which read as a toolbar rather than a list of
          places to go — and there were only ever four of them plus one, so the
          grid never lined up. */}
      <section className="flex flex-col gap-3">
        <h2 className="eyebrow">Messages &amp; access</h2>
        <Card>
          {/* `border-b … last:border-b-0` on the WRAPPER, not the row: `Row`
              ends in `border-b last:border-b-0`, and inside a per-row <Link>
              every row is its parent's only child — so `last:` matches
              unconditionally and the dividers would all vanish. */}
          <Link href={`/admin/events/${eventCode}/messages`} className={ROW_LINK}>
            <Row
              heading="Prepare messages"
              meta="Generate and copy per family"
              trailing={<ChevronRightIcon className="h-5 w-5" aria-hidden />}
            />
          </Link>
          <Link href={`/admin/events/${eventCode}/messages/send`} className={ROW_LINK}>
            <Row
              heading="Send messages"
              meta="Bulk send via the WhatsApp provider"
              trailing={<ChevronRightIcon className="h-5 w-5" aria-hidden />}
            />
          </Link>
          <Link href={`/admin/events/${eventCode}/messages/templates`} className={ROW_LINK}>
            <Row
              heading="Templates"
              meta="Edit message templates"
              trailing={<ChevronRightIcon className="h-5 w-5" aria-hidden />}
            />
          </Link>
          <Link href={`/admin/events/${eventCode}/messages/log`} className={ROW_LINK}>
            <Row
              heading="Message log"
              meta="Status of every send"
              trailing={<ChevronRightIcon className="h-5 w-5" aria-hidden />}
            />
          </Link>
          <Link href={`/admin/events/${eventCode}/codes`} className={ROW_LINK}>
            <Row
              heading="Access codes"
              meta="Issue a team or client code"
              trailing={<ChevronRightIcon className="h-5 w-5" aria-hidden />}
            />
          </Link>
        </Card>
      </section>

      {/* ---- Today detail ---- */}
      <TodayPanel arrivals={today.arrivals} departures={today.departures} date={todayDate} eventCode={eventCode} />

      {/* ---- Attention ---- */}
      {attn && <AttentionPanel attn={attn} eventCode={eventCode} />}
    </div>
  )
}
