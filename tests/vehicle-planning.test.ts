import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * F2 — "Planning vehicle for this board is not working".
 *
 * The root cause was a swallowed supabase-js error: supabase-js returns
 * `{ data, error }` and never throws, so a failed read returned `[]` and the
 * screen rendered the empty state ("No vehicles in the fleet" / "Nothing to
 * plan") indistinguishable from a healthy empty event. These tests pin the
 * read actions to a result that CARRIES the error, and pin the trip commit to
 * surface the same.
 */

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import {
  readUnplacedTravelLegs,
  readAvailableVehicles,
  commitTrips,
} from '@/lib/actions/logistics'

type DbError = { message: string; code?: string } | null
type DbResult = { data: unknown; error: DbError }

/** A supabase query builder stand-in: every method chains, and it is thenable. */
function thenable(result: DbResult) {
  const chain: Record<string, unknown> = {}
  const passthrough = () => chain
  for (const method of [
    'select', 'eq', 'neq', 'order', 'not', 'in', 'is', 'update', 'insert',
    'delete', 'limit', 'match', 'filter', 'gte', 'lte', 'ilike',
  ]) {
    chain[method] = passthrough
  }
  chain.single = () => Promise.resolve(result)
  chain.then = (onFulfilled: (v: DbResult) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected)
  return chain
}

/** Point createClient at a per-table result. */
function mockDb(byTable: Record<string, DbResult>) {
  const from = vi.fn((table: string) => thenable(byTable[table] ?? { data: [], error: null }))
  ;(createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ from })
  return from
}

function leg(id: string, groupId: string, head: string) {
  return {
    id,
    group_id: groupId,
    direction: 'arrival',
    mode: 'air',
    travel_date: '2026-12-19',
    travel_time: '10:30:00',
    point: 'Ahmedabad T2',
    reference: '6E 5074',
    pax_on_leg: 4,
    needs_transport: true,
    guest_groups: { head_name: head },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('readUnplacedTravelLegs surfaces a read failure instead of returning []', () => {
  it('returns ok:false with a plain-language error when the query fails', async () => {
    mockDb({ travel_legs: { data: null, error: { message: 'relation does not exist', code: '42P01' } } })

    const res = await readUnplacedTravelLegs('e1', 'arrival')

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('Could not read the arrival travel legs from the database.')
  })

  it('says permission was refused for a 42501', async () => {
    mockDb({ travel_legs: { data: null, error: { message: 'permission denied', code: '42501' } } })

    const res = await readUnplacedTravelLegs('e1', 'arrival')

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('permission')
  })

  it('maps the rows it does read, and excludes legs already on a trip', async () => {
    mockDb({
      travel_legs: { data: [leg('l1', 'g1', 'Mehta'), leg('l2', 'g2', 'Shah')], error: null },
      trip_passengers: { data: [{ travel_leg_id: 'l1' }], error: null },
    })

    const res = await readUnplacedTravelLegs('e1', 'arrival')

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data).toHaveLength(1)
      expect(res.data[0].headName).toBe('Shah')
      expect(res.data[0].paxOnLeg).toBe(4)
    }
  })
})

describe('readAvailableVehicles surfaces a read failure', () => {
  it('returns ok:false rather than an empty fleet', async () => {
    mockDb({ vehicles: { data: null, error: { message: 'boom', code: '42P01' } } })

    const res = await readAvailableVehicles('e1')

    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('Could not read the fleet from the database.')
  })

  it('returns the fleet on success', async () => {
    mockDb({
      vehicles: {
        data: [{ id: 'v1', label: 'Sedan', capacity: 3, driver_name: null, driver_mobile: null }],
        error: null,
      },
    })

    const res = await readAvailableVehicles('e1')

    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data).toHaveLength(1)
      expect(res.data[0].capacity).toBe(3)
    }
  })
})

describe('commitTrips surfaces a failed vehicle read', () => {
  it('returns ok:false instead of committing a plan against an unknown fleet', async () => {
    mockDb({ vehicles: { data: null, error: { message: 'boom', code: '42P01' } } })

    const res = await commitTrips('e1', { trips: [], unplaced: [] })

    expect(res.ok).toBe(false)
  })
})
