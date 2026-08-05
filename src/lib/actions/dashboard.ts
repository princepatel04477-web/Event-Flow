'use server'

import { createClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export interface DashboardRow {
  eventId: string
  name: string
  totalGroups: number
  totalPax: number
  rsvpConfirmed: number
  rsvpPending: number
  arrivalsToday: number
  departuresToday: number
  guestsRoomed: number
  hampersDelivered: number
  hampersPending: number
  returnGiftsDelivered: number
  logisticsExpense: number
}

export async function readDashboard(eventId: string): Promise<DashboardRow | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('v_event_dashboard')
    .select('*')
    .eq('event_id', eventId)
    .maybeSingle()

  if (!data) return null

  const d = data as Record<string, unknown>
  return {
    eventId: d.event_id as string,
    name: d.name as string,
    totalGroups: d.total_groups as number,
    totalPax: d.total_pax as number,
    rsvpConfirmed: d.rsvp_confirmed as number,
    rsvpPending: d.rsvp_pending as number,
    arrivalsToday: d.arrivals_today as number,
    departuresToday: d.departures_today as number,
    guestsRoomed: d.guests_roomed as number,
    hampersDelivered: d.hampers_delivered as number,
    hampersPending: d.hampers_pending as number,
    returnGiftsDelivered: d.return_gifts_delivered as number,
    logisticsExpense: d.logistics_expense as number,
  }
}

// ---------------------------------------------------------------------------
// Today panel — arrivals/departures detail
// ---------------------------------------------------------------------------

export interface TodayLeg {
  legId: string
  direction: 'arrival' | 'departure'
  travelTime: string | null
  mode: string | null
  reference: string | null
  point: string | null
  paxOnLeg: number | null
  headName: string
  totalPax: number
  hasVehicle: boolean
}

export async function readTodayLegs(
  eventId: string,
  date: string,
): Promise<{ arrivals: TodayLeg[]; departures: TodayLeg[] }> {
  const supabase = await createClient()

  const { data: legs } = await supabase
    .from('travel_legs')
    .select(`
      id, direction, travel_time, mode, reference, point, pax_on_leg,
      group_id,
      guest_groups!inner(head_name, coalesce(confirmed_pax, expected_pax))
    `)
    .eq('event_id', eventId)
    .eq('travel_date', date)
    .order('travel_time', { ascending: true })

  const rows = (legs ?? []) as unknown as Array<{
    id: string
    direction: string
    travel_time: string | null
    mode: string | null
    reference: string | null
    point: string | null
    pax_on_leg: number | null
    group_id: string
    guest_groups: { head_name: string; coalesce: number }
  }>

  // Check vehicle assignment: look up trip_passengers for these groups
  const groupIds = [...new Set(rows.map((r) => r.group_id))]
  let vehicleSet = new Set<string>()
  if (groupIds.length > 0) {
    const { data: assigned } = await supabase
      .from('trip_passengers')
      .select('group_id')
      .eq('event_id', eventId)
      .in('group_id', groupIds)

    vehicleSet = new Set((assigned ?? []).map((a) => a.group_id))
  }

  const arrivals: TodayLeg[] = []
  const departures: TodayLeg[] = []

  for (const r of rows) {
    const leg: TodayLeg = {
      legId: r.id,
      direction: r.direction as 'arrival' | 'departure',
      travelTime: r.travel_time,
      mode: r.mode,
      reference: r.reference,
      point: r.point,
      paxOnLeg: r.pax_on_leg,
      headName: r.guest_groups?.head_name ?? 'Unknown',
      totalPax: r.guest_groups?.coalesce ?? 0,
      hasVehicle: vehicleSet.has(r.group_id),
    }
    if (r.direction === 'arrival') arrivals.push(leg)
    else departures.push(leg)
  }

  return { arrivals, departures }
}

// ---------------------------------------------------------------------------
// Attention panel
// ---------------------------------------------------------------------------

export interface AttentionRow {
  confirmedNoRoom: number
  arrivalsNoVehicle: number
  noDeparture: number
  hampersPending: number
}

export async function readAttention(eventId: string): Promise<AttentionRow> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('v_event_attention')
    .select('*')
    .eq('event_id', eventId)
    .maybeSingle()

  if (error || !data) {
    return { confirmedNoRoom: 0, arrivalsNoVehicle: 0, noDeparture: 0, hampersPending: 0 }
  }

  return {
    confirmedNoRoom: data.confirmed_no_room ?? 0,
    arrivalsNoVehicle: data.arrivals_no_vehicle ?? 0,
    noDeparture: data.no_departure ?? 0,
    hampersPending: data.hampers_pending ?? 0,
  }
}
