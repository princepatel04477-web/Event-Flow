import { describe, expect, it } from 'vitest'

import { emptyState, parseSnapshot, stateFromSnapshot, SNAPSHOT_VERSION } from '@/lib/store/snapshot'

import {
  EVENT_ID,
  guest,
  group,
  rawSnapshot,
  twoFamilySnapshot,
} from './helpers/store-fixture'

/**
 * The snapshot mapper: the boundary between a payload nobody type-checks and a
 * store every screen trusts.
 *
 * The cases below are the ones that would put a WRONG SCREEN in front of a
 * runner rather than an error message, which is why they are tested and not
 * merely reviewed: a payload version this build does not understand, a row with
 * no id (the store's only hard requirement), a client payload that must NOT be
 * dressed up as a full one, and a missing event header.
 */

describe('parseSnapshot: what it refuses', () => {
  it('refuses a payload version it does not understand', () => {
    // A newer server is a real state: the migration and the app ship
    // separately. Guessing at a v2 payload would put unknown rows on screen;
    // refusing makes the engine fall back to reads that are merely slow.
    expect(parseSnapshot(rawSnapshot({ v: SNAPSHOT_VERSION + 1 }))).toBeNull()
    expect(parseSnapshot(rawSnapshot({ v: 0 }))).toBeNull()
    expect(parseSnapshot(rawSnapshot({ v: undefined }))).toBeNull()
  })

  it('refuses anything that is not an object', () => {
    for (const value of [null, undefined, 'a string', 42, [], true]) {
      expect(parseSnapshot(value)).toBeNull()
    }
  })

  it('refuses a payload with no event header', () => {
    expect(parseSnapshot(rawSnapshot({ event: null }))).toBeNull()
    // An event object with no id is not an event: `EventHeader.id` is the one
    // field every tenancy decision downstream depends on.
    expect(parseSnapshot(rawSnapshot({ event: { code: 'X' } }))).toBeNull()
  })

  it('treats a missing array as empty rather than as a failure', () => {
    const parsed = parseSnapshot(rawSnapshot({ groups: undefined }))
    expect(parsed).not.toBeNull()
    expect(parsed?.data.groups).toEqual([])
  })
})

describe('parseSnapshot: what it keeps and drops', () => {
  it('drops rows with no usable id and counts them', () => {
    const parsed = parseSnapshot(
      rawSnapshot({
        groups: [group({ id: 'ok' }), { head_name: 'no id' }, null, { id: '' }],
      }),
    )
    expect(parsed?.data.groups).toHaveLength(1)
    expect(parsed?.dropped).toBe(3)
  })

  it('keys client rows by guest_id and drops the ones without one', () => {
    const payload = rawSnapshot({
      client: [
        { guest_id: 'gu-1', guest_name: 'A' },
        { guest_id: null, guest_name: 'B' },
        { guest_name: 'C' },
      ],
    })
    const parsed = parseSnapshot(payload)
    expect(parsed?.data.client).toHaveLength(1)
    expect(parsed?.dropped).toBe(2)
  })

  it('keys callStats by groupId', () => {
    const parsed = parseSnapshot(
      rawSnapshot({
        callStats: [
          { groupId: 'g-1', n: '2', lastAt: null, lastOutcome: 'connected', nextCallbackAt: null },
          { n: 1 },
        ],
      }),
    )
    expect(parsed?.data.callStats).toHaveLength(1)
    expect(parsed?.data.callStats[0]?.groupId).toBe('g-1')
    expect(parsed?.dropped).toBe(1)
  })

  it('keeps a client payload client-only', () => {
    const parsed = parseSnapshot(
      rawSnapshot({ groups: undefined, guests: undefined, client: [{ guest_id: 'gu-1' }] }, 'client'),
    )
    expect(parsed?.data.role).toBe('client')
    // The migration drops the staff arrays entirely for a client, and the
    // mapper must not invent them: an empty `groups` here is the honest
    // representation of "the server sent none".
    expect(parsed?.data.groups).toEqual([])
    expect(parsed?.data.client).toHaveLength(1)
  })

  it('reads an unknown role as team rather than as client', () => {
    // Failing toward the STAFF branch would be the dangerous direction, so the
    // fallback is the conservative one: a client payload cannot reach the
    // staff selectors because it has no rows in them, not because of this
    // string.
    expect(parseSnapshot(rawSnapshot({ role: 'wizard' }))?.data.role).toBe('team')
  })
})

describe('stateFromSnapshot', () => {
  it('indexes every table by id', () => {
    const parsed = parseSnapshot(twoFamilySnapshot())
    const state = stateFromSnapshot(EVENT_ID, parsed!.data, parsed!.dropped)

    expect(Object.keys(state.groups).sort()).toEqual(['g-desai', 'g-sharma'])
    expect(state.groups['g-sharma']?.head_name).toBe('Sharma')
    expect(Object.keys(state.guests)).toHaveLength(3)
    expect(Object.keys(state.rooms)).toEqual(['r-1'])
    expect(Object.keys(state.assignments)).toEqual(['a-1'])
    expect(Object.keys(state.callStats)).toEqual(['g-sharma'])
    expect(state.callStats['g-sharma']?.n).toBe(2)
    expect(state.status).toBe('ready')
    expect(state.mode).toBe('store')
    expect(state.watermark).not.toBeNull()
    expect(state.event?.code).toBe('SHARMA26')
  })

  it('gives every client row an id equal to its guest_id', () => {
    const parsed = parseSnapshot(twoFamilySnapshot())
    const state = stateFromSnapshot(EVENT_ID, parsed!.data)
    // The store's client map is keyed the same way `setRow` addresses rows, so
    // a map key and a row id can never disagree.
    for (const [key, row] of Object.entries(state.client)) {
      expect(row.id).toBe(key)
      expect(row.id).toBe(row.guest_id)
    }
  })

  it('starts from an empty state with every map present', () => {
    const state = emptyState(EVENT_ID)
    // A missing map would be `undefined` rather than empty, and every selector
    // would throw on the first render after a failed load.
    expect(state.groups).toEqual({})
    expect(state.client).toEqual({})
    expect(state.dropped).toBe(0)
    expect(state.event).toBeNull()
  })

  it('does not carry rows across events', () => {
    const parsed = parseSnapshot(twoFamilySnapshot())
    const state = stateFromSnapshot('99999999-9999-4999-8999-999999999999', parsed!.data)
    // Rows themselves are event-free (the migration strips `event_id`), so the
    // fence is the key the engine stores them under, not a field on the row.
    expect(state.eventId).toBe('99999999-9999-4999-8999-999999999999')
    expect(state.groups['g-sharma']).toBeDefined()
    expect('event_id' in (state.groups['g-sharma'] as object)).toBe(false)
  })

  it('keeps a guest with no group rather than dropping it', () => {
    // An orphan guest is a real state (a group deleted mid-shift) and the
    // screens that read guests tolerate it; the mapper must not silently
    // shrink the event.
    const parsed = parseSnapshot(
      rawSnapshot({ guests: [guest({ id: 'gu-orphan', group_id: 'g-gone' })] }),
    )
    expect(parsed?.data.guests).toHaveLength(1)
  })
})
