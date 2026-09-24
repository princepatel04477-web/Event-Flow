import { describe, expect, it } from 'vitest'

import { applyOps, invertOps, mergeChanges, opKey } from '@/lib/store/reducer'
import { parseSnapshot, stateFromSnapshot } from '@/lib/store/snapshot'
import type { EventState, StoreOp } from '@/lib/store/types'

import {
  EVENT_ID,
  assignment,
  at,
  deliverable,
  group,
  guest,
  leg,
  rawSnapshot,
  room,
  stateFrom,
  twoFamilySnapshot,
} from './helpers/store-fixture'

/**
 * The three state transitions the store is built on.
 *
 * These are the cases where a bug is invisible on the screen and expensive on
 * the floor: a merge that keeps a released assignment (the room shows as taken
 * and the double-booking guard stops protecting it), an inversion that undoes
 * somebody else's write (a runner's placement disappears), and a watermark that
 * moves backwards (every later catch-up re-delivers rows forever).
 */

function state(): EventState {
  return stateFrom(twoFamilySnapshot())
}

describe('applyOps', () => {
  it('returns the same state for no ops, so a no-op write never re-renders', () => {
    const before = state()
    expect(applyOps(before, [])).toBe(before)
  })

  it('patches a group without touching any other record map', () => {
    const before = state()
    const next = applyOps(before, [
      { t: 'group.patch', id: 'g-sharma', patch: { rsvp_status: 'declined' } },
    ])
    expect(next.groups['g-sharma']?.rsvp_status).toBe('declined')
    // Identity, not equality: this is what stops an unrelated write from
    // rebuilding the rooms grid on the Calls tab.
    expect(next.groups).not.toBe(before.groups)
    expect(next.rooms).toBe(before.rooms)
    expect(next.guests).toBe(before.guests)
    expect(next.assignments).toBe(before.assignments)
  })

  it('ignores a patch for a row the store does not hold', () => {
    const before = state()
    const next = applyOps(before, [
      { t: 'group.patch', id: 'g-nobody', patch: { rsvp_status: 'confirmed' } },
    ])
    expect(Object.keys(next.groups)).toHaveLength(2)
    expect(next.groups['g-nobody']).toBeUndefined()
  })

  it('refuses to store an assignment that carries a release stamp', () => {
    // Every screen reads `state.assignments` as "who is in a room RIGHT NOW"
    // (the migration filters `released_at is null`), so a released row in it
    // would make a room look occupied and disable the check-in board's guard.
    const before = state()
    const next = applyOps(before, [
      {
        t: 'row.set',
        key: 'assignments',
        row: assignment({
          id: 'a-1',
          room_id: 'r-1',
          guest_id: 'gu-1',
          group_id: 'g-sharma',
          released_at: at(30),
        }),
      },
    ])
    expect(next.assignments['a-1']).toBeUndefined()
  })

  it('bumps a call aggregate by one, with the newest outcome', () => {
    const before = state()
    const next = applyOps(before, [
      {
        t: 'callStat.bump',
        groupId: 'g-sharma',
        at: at(5),
        outcome: 'no_answer',
        nextCallbackAt: null,
      },
    ])
    expect(next.callStats['g-sharma']?.n).toBe(3)
    expect(next.callStats['g-sharma']?.lastOutcome).toBe('no_answer')
    expect(next.callStats['g-sharma']?.lastAt).toBe(at(5))
  })

  it('makes an OPEN dial null the newest outcome, matching the view', () => {
    // `v_rsvp_queue`'s last_outcome is `(array_agg(outcome order by started_at
    // desc))[1]` over ALL attempts, including one that has not closed. Matching
    // that here is what stops the optimistic row flickering on the catch-up.
    const before = state()
    const next = applyOps(before, [
      { t: 'callStat.bump', groupId: 'g-sharma', at: at(6), outcome: null, nextCallbackAt: null, open: true },
    ])
    expect(next.callStats['g-sharma']?.n).toBe(3)
    expect(next.callStats['g-sharma']?.lastOutcome).toBeNull()
  })

  it('keeps the existing callback promise when a bump carries none', () => {
    const withCallback = applyOps(state(), [
      { t: 'callStat.set', groupId: 'g-desai', stat: { groupId: 'g-desai', n: 1, lastAt: at(1), lastOutcome: 'callback', nextCallbackAt: at(120) } },
    ])
    const next = applyOps(withCallback, [
      { t: 'callStat.bump', groupId: 'g-desai', at: at(2), outcome: 'no_answer', nextCallbackAt: null, open: true },
    ])
    expect(next.callStats['g-desai']?.nextCallbackAt).toBe(at(120))
  })

  it('removes a row from the named map', () => {
    const next = applyOps(state(), [{ t: 'row.remove', key: 'assignments', id: 'a-1' }])
    expect(next.assignments['a-1']).toBeUndefined()
    expect(Object.keys(next.groups)).toHaveLength(2)
  })

  it('names the record map each op touches', () => {
    const cases: [StoreOp, string][] = [
      [{ t: 'group.patch', id: 'x', patch: {} }, 'groups'],
      [{ t: 'leg.patch', id: 'x', patch: {} }, 'legs'],
      [{ t: 'assignment.patch', id: 'x', patch: {} }, 'assignments'],
      [{ t: 'deliverable.patch', id: 'x', patch: {} }, 'deliverables'],
      [{ t: 'vehicle.patch', id: 'x', patch: {} }, 'vehicles'],
      [{ t: 'trip.patch', id: 'x', patch: {} }, 'trips'],
      [{ t: 'staff.patch', id: 'x', patch: {} }, 'staff'],
      [{ t: 'row.set', key: 'proofs', row: { id: 'x' } }, 'proofs'],
      [{ t: 'row.remove', key: 'client', id: 'x' }, 'client'],
      [{ t: 'callStat.set', groupId: 'x', stat: null }, 'callStats'],
      [{ t: 'callStat.bump', groupId: 'x', at: at(), outcome: null, nextCallbackAt: null }, 'callStats'],
    ]
    for (const [op, key] of cases) expect(opKey(op)).toBe(key)
  })
})

describe('invertOps', () => {
  it('restores exactly the fields the patch changed', () => {
    const before = state()
    expect(before.groups['g-sharma']?.rsvp_status).toBe('confirmed')
    expect(before.groups['g-sharma']?.remarks).toBeNull()
    const ops: StoreOp[] = [
      { t: 'group.patch', id: 'g-sharma', patch: { rsvp_status: 'declined', remarks: 'changed' } },
    ]
    const after = applyOps(before, ops)
    expect(after.groups['g-sharma']?.rsvp_status).toBe('declined')
    const back = applyOps(after, invertOps(before, ops))
    expect(back.groups['g-sharma']?.rsvp_status).toBe('confirmed')
    expect(back.groups['g-sharma']?.remarks).toBeNull()
  })

  it('puts a released assignment back, exactly', () => {
    const before = state()
    const ops: StoreOp[] = [{ t: 'row.remove', key: 'assignments', id: 'a-1' }]
    const after = applyOps(before, ops)
    expect(after.assignments['a-1']).toBeUndefined()
    const back = applyOps(after, invertOps(before, ops))
    expect(back.assignments['a-1']).toEqual(before.assignments['a-1'])
  })

  it('undoes only its own rows, leaving a later write alone', () => {
    // THE CASE THIS WHOLE OP MODEL EXISTS FOR. The old revert restored a
    // snapshot of the query cache, which also threw away a second optimistic
    // write made in between — the runner's move would silently disappear when
    // the first write was refused.
    const before = state()
    const firstOps: StoreOp[] = [
      { t: 'group.patch', id: 'g-sharma', patch: { remarks: 'first' } },
    ]
    const afterFirst = applyOps(before, firstOps)
    const inverse = invertOps(before, firstOps)

    const secondOps: StoreOp[] = [
      { t: 'group.patch', id: 'g-sharma', patch: { remarks: 'second' } },
    ]
    const afterSecond = applyOps(afterFirst, secondOps)

    // The first write is refused → only its inverse is applied.
    const rolledBack = applyOps(afterSecond, inverse)
    // `remarks` was null before the first write and 'second' after the second,
    // and the inverse for the FIRST write sets it back to null — so this is the
    // documented limit of op inversion: fields touched by two writes cannot be
    // separated. What it never does is drop the second write's OTHER fields.
    expect(rolledBack.groups['g-sharma']?.remarks).toBeNull()
    expect(rolledBack.groups['g-sharma']?.head_name).toBe('Sharma')

    // The case with no overlap, which is the common one: the second write's
    // row survives untouched.
    const other: StoreOp[] = [
      { t: 'callStat.set', groupId: 'g-desai', stat: { groupId: 'g-desai', n: 9, lastAt: at(), lastOutcome: null, nextCallbackAt: null } },
    ]
    const inverseFirst = invertOps(before, firstOps)
    const withOther = applyOps(applyOps(before, firstOps), other)
    const finalState = applyOps(withOther, inverseFirst)
    expect(finalState.callStats['g-desai']?.n).toBe(9)
  })

  it('drops an inversion for a row the store never held', () => {
    const before = state()
    const ops: StoreOp[] = [{ t: 'row.remove', key: 'assignments', id: 'a-not-here' }]
    expect(invertOps(before, ops)).toEqual([])
  })

  it('removes a row that a write invented', () => {
    const before = state()
    const ops: StoreOp[] = [
      {
        t: 'row.set',
        key: 'assignments',
        row: assignment({ id: 'pending-gu-3', room_id: 'r-1', guest_id: 'gu-3', group_id: 'g-desai' }),
      },
    ]
    const after = applyOps(before, ops)
    expect(after.assignments['pending-gu-3']).toBeDefined()
    const back = applyOps(after, invertOps(before, ops))
    expect(back.assignments['pending-gu-3']).toBeUndefined()
  })

  it('round-trips a call-stat bump', () => {
    const before = state()
    const ops: StoreOp[] = [
      { t: 'callStat.bump', groupId: 'g-desai', at: at(3), outcome: 'busy', nextCallbackAt: null },
    ]
    const after = applyOps(before, ops)
    expect(after.callStats['g-desai']?.n).toBe(1)
    const back = applyOps(after, invertOps(before, ops))
    // g-desai had no stat at all, so the inverse is a removal, not a zero.
    expect(back.callStats['g-desai']).toBeUndefined()
  })
})

describe('mergeChanges', () => {
  function delta(over: Parameters<typeof rawSnapshot>[0]) {
    const parsed = parseSnapshot(rawSnapshot(over))
    if (!parsed) throw new Error('delta did not parse')
    return { data: parsed.data, dropped: parsed.dropped }
  }

  /** `mergeChanges` with the parser's drop count carried through, as the engine does. */
  function merge(before: EventState, over: Parameters<typeof rawSnapshot>[0]) {
    const parsed = delta(over)
    return mergeChanges(before, parsed.data, parsed.dropped)
  }

  it('replaces changed rows and leaves the rest of the table alone', () => {
    const before = state()
    const next = merge(before, { groups: [group({ id: 'g-desai', head_name: 'Desai (renamed)' })] })
    expect(next.groups['g-desai']?.head_name).toBe('Desai (renamed)')
    // Not cleared: a delta says "these rows changed", never "this is the table".
    expect(next.groups['g-sharma']).toBeDefined()
    expect(Object.keys(next.groups)).toHaveLength(2)
  })

  it('adds a row the store has never seen', () => {
    const before = state()
    const next = merge(before, { groups: [group({ id: 'g-new', head_name: 'New Family' })] })
    expect(next.groups['g-new']?.head_name).toBe('New Family')
  })

  it('removes an assignment that arrived released', () => {
    // The one delete a delta can express, and the one it needs to: soft release
    // is an UPDATE, so the row comes back with `released_at` set.
    const before = state()
    expect(before.assignments['a-1']).toBeDefined()
    const next = merge(before, {
      assignments: [
        assignment({
          id: 'a-1',
          room_id: 'r-1',
          guest_id: 'gu-1',
          group_id: 'g-sharma',
          released_at: at(30),
        }),
      ],
    })
    expect(next.assignments['a-1']).toBeUndefined()
  })

  it('replaces a call aggregate whole rather than adding to it', () => {
    const before = state()
    const next = merge(before, {
      callStats: [
        { groupId: 'g-sharma', n: 7, lastAt: at(1), lastOutcome: 'busy', nextCallbackAt: null },
      ],
    })
    expect(next.callStats['g-sharma']?.n).toBe(7)
  })

  it('never moves the watermark backwards', () => {
    const before = state()
    const stale = merge(before, {
      watermark: at(-600),
      groups: [group({ id: 'g-desai', head_name: 'Late' })],
    })
    // An out-of-order delta must still APPLY (its rows are real) but must not
    // rewind the watermark, or the next catch-up re-delivers them forever.
    expect(stale.groups['g-desai']?.head_name).toBe('Late')
    expect(stale.watermark).toBe(before.watermark)
  })

  it('advances the watermark when the delta is newer', () => {
    const before = state()
    const ahead = at(600)
    const next = merge(before, { watermark: ahead })
    expect(next.watermark).toBe(ahead)
  })

  it('replaces the client array wholesale for a client delta', () => {
    const before = state()
    const next = merge(before, {
      role: 'client',
      client: [{ guest_id: 'gu-3', guest_name: 'Nilesh Desai', family_head: 'Desai' }],
    })
    // The view has no updated_at, so its array is always sent whole; anything
    // the phone held and the server did not send is genuinely gone.
    expect(Object.keys(next.client)).toEqual(['gu-3'])
  })

  it('adds proofs without disturbing anything else', () => {
    const before = state()
    const next = merge(before, {
      proofs: [
        {
          id: 'p-1',
          deliverable_id: 'd-1',
          storage_bucket: 'delivery-proofs',
          storage_path: 'e/d/x.jpg',
          recorded_at: at(20),
        },
      ],
    })
    expect(next.proofs['p-1']).toBeDefined()
    expect(next.deliverables['d-1']?.status).toBe('delivered')
    expect(next.groups).toBe(before.groups)
  })

  it('counts rows the parser refused', () => {
    const next = merge(state(), { groups: [group({ id: 'ok' }), { head_name: 'bad' }] })
    expect(next.dropped).toBe(1)
  })

  it('adds rows to empty maps without touching identity elsewhere', () => {
    const before = state()
    const next = merge(before, {
      legs: [leg({ id: 'leg-9', group_id: 'g-desai', direction: 'departure' })],
    })
    expect(next.legs['leg-9']).toBeDefined()
    expect(next.rooms).toBe(before.rooms)
  })
})

describe('a full snapshot after a delta', () => {
  it('drops rows the delta could not know were deleted', () => {
    // The documented reason the engine takes a periodic full snapshot: a delta
    // cannot see a DELETE, so only a snapshot can remove a deleted room.
    const parsed = parseSnapshot(
      rawSnapshot({
        groups: [group({ id: 'g-sharma' })],
        rooms: [room({ id: 'r-1', hotel_id: 'h-1' }), room({ id: 'r-deleted', hotel_id: 'h-1' })],
        guests: [guest({ id: 'gu-1', group_id: 'g-sharma' })],
      }),
    )
    const state = stateFromSnapshot(EVENT_ID, parsed!.data)
    expect(state.rooms['r-deleted']).toBeDefined()

    const repaired = parseSnapshot(
      rawSnapshot({ groups: [group({ id: 'g-sharma' })], rooms: [room({ id: 'r-1', hotel_id: 'h-1' })] }),
    )
    const after = stateFromSnapshot(EVENT_ID, repaired!.data)
    expect(after.rooms['r-deleted']).toBeUndefined()
    expect(after.rooms['r-1']).toBeDefined()
  })
})

describe('deliverable status', () => {
  it('is carried through a patch', () => {
    const before = state()
    const next = applyOps(before, [
      { t: 'deliverable.patch', id: 'd-2', patch: { status: 'delivered' } },
    ])
    expect(next.deliverables['d-2']?.status).toBe('delivered')
    expect(deliverable({ id: 'd-2', group_id: 'g-desai' }).status).toBe('pending')
  })
})