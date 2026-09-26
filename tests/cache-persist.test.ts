import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

import { cacheScope, dehydrateSafe, isPersistableKey, scopeFromPath } from '@/lib/queries/persist'

/**
 * The persisted query cache (S5).
 *
 * These test the pure decisions — what is safe to keep, and under which key —
 * because those are what decide whether one event's rows can ever reach another
 * event's screen. The IndexedDB write itself is exercised by the browser, not
 * here (jsdom has no IndexedDB, and a fake would prove nothing about the real
 * one).
 */

describe('scopeFromPath', () => {
  it('reads the event code from an event screen', () => {
    expect(scopeFromPath('/SAMPLE2026/guests/list')).toBe('SAMPLE2026')
    expect(scopeFromPath('/SHARMA26/hospitality/rooms')).toBe('SHARMA26')
  })

  it('refuses every path that is not event-scoped', () => {
    expect(scopeFromPath('/login')).toBeNull()
    expect(scopeFromPath('/pick-staff')).toBeNull()
    expect(scopeFromPath('/admin/events')).toBeNull()
    // The internal prefix, in case a pathname is ever read before the rewrite
    // is undone — it must not be mistaken for an event code.
    expect(scopeFromPath('/v2/SAMPLE2026')).toBeNull()
    expect(scopeFromPath('/')).toBeNull()
  })
})

describe('cacheScope', () => {
  it('partitions by event code and staff member, not event code alone', () => {
    expect(cacheScope('SAMPLE2026', 'staff-a')).toBe('SAMPLE2026:staff-a')
    expect(cacheScope('SAMPLE2026', 'staff-b')).toBe('SAMPLE2026:staff-b')
    expect(cacheScope('SHARMA26', 'staff-a')).toBe('SHARMA26:staff-a')
  })

  it('never lets two staff on the same event share a key', () => {
    expect(cacheScope('SAMPLE2026', 'staff-a')).not.toBe(cacheScope('SAMPLE2026', 'staff-b'))
  })

  it('sends a session with no identity to the shared anon partition', () => {
    expect(cacheScope('SAMPLE2026', null)).toBe('SAMPLE2026:anon')
    expect(cacheScope('SAMPLE2026', '')).toBe('SAMPLE2026:anon')
  })
})

describe('isPersistableKey', () => {
  it('keeps the screens S5 names', () => {
    expect(isPersistableKey(['event', 'e1', 'dashboard', 'board'])).toBe(true)
    expect(isPersistableKey(['event', 'e1', 'rooms', 'grid'])).toBe(true)
    expect(isPersistableKey(['event', 'e1', 'guests', 'list'])).toBe(true)
    expect(isPersistableKey(['event', 'e1', 'rsvp', 'queue', { statuses: [] }])).toBe(true)
    expect(isPersistableKey(['event', 'e1', 'logistics', 'arrivals'])).toBe(true)
  })

  it('drops search results and one-off details', () => {
    expect(isPersistableKey(['event', 'e1', 'guests', 'search', 'mehta'])).toBe(false)
    expect(isPersistableKey(['event', 'e1', 'guests', 'find', 'mehta'])).toBe(false)
    expect(isPersistableKey(['event', 'e1', 'family', 'g1'])).toBe(false)
    expect(isPersistableKey(['event', 'e1', 'deliveries', 'detail', 'd1'])).toBe(false)
  })

  it('refuses anything that is not event-scoped', () => {
    expect(isPersistableKey(['viewer'])).toBe(false)
    expect(isPersistableKey(['event', 'e1'])).toBe(false)
    expect(isPersistableKey(['event', 'e1', 'dashboard'])).toBe(false)
  })
})

describe('dehydrateSafe', () => {
  it('writes only the allowlisted queries, and never mutations', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(['event', 'A', 'dashboard', 'board'], { total: 1 })
    queryClient.setQueryData(['event', 'A', 'rooms', 'grid'], { rooms: [] })
    queryClient.setQueryData(['event', 'A', 'guests', 'search', 'mehta'], [{ id: 'g1' }])

    const state = dehydrateSafe(queryClient)
    const keys = state.queries.map((query) => query.queryKey.map(String).join('/'))

    expect(keys.some((k) => k.includes('dashboard/board'))).toBe(true)
    expect(keys.some((k) => k.includes('rooms/grid'))).toBe(true)
    expect(keys.some((k) => k.includes('guests/search'))).toBe(false)
    expect(state.mutations).toEqual([])
  })

  it('keeps the event id inside the dehydrated key, so scope B cannot match it', () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(['event', 'A', 'rooms', 'grid'], { rooms: ['A'] })

    const state = dehydrateSafe(queryClient)
    expect(state.queries[0].queryKey[1]).toBe('A')
    expect(state.queries[0].queryKey[1]).not.toBe('B')
  })
})
