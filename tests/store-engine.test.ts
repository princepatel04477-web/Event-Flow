import { describe, expect, it, vi } from 'vitest'

import { EventStoreEngine, type SnapshotLoad } from '@/lib/store/engine'

import {
  EVENT_ID,
  assignment,
  at,
  group,
  rawSnapshot,
  twoFamilySnapshot,
} from './helpers/store-fixture'

/**
 * The engine: when to hydrate, when to catch up, and what a refusal undoes.
 *
 * These are the decisions a screen cannot make for itself and a unit test can:
 * the RPC is applied before its migration, so "the database has no
 * event_snapshot" has to become a working fallback rather than an empty event;
 * a transport failure must NOT be mistaken for a missing function, or one blip
 * would silently downgrade the whole app to its slow path; and a realtime row
 * must never overwrite a newer local one.
 *
 * Every test injects its loaders and disables IndexedDB and realtime, so nothing
 * here touches a network, a database or a DOM.
 */

function payload(over: Parameters<typeof rawSnapshot>[0] = {}) {
  return rawSnapshot({ ...twoFamilySnapshot(), ...over })
}

function ok(over: Parameters<typeof rawSnapshot>[0] = {}): SnapshotLoad {
  return { ok: true, payload: payload(over), unsupported: false, message: '' }
}

function engine(options: {
  load?: () => Promise<SnapshotLoad>
  loadChanges?: (eventId: string, since: string) => Promise<SnapshotLoad>
} = {}) {
  const load = options.load ?? (async () => ok())
  const loadChanges = options.loadChanges ?? (async () => ok({ groups: [], callStats: [] }))
  return new EventStoreEngine(EVENT_ID, {
    persist: false,
    realtime: false,
    load,
    loadChanges,
  })
}

/** Let the engine's un-awaited promises settle. */
async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe('a cold start', () => {
  it('takes one snapshot and becomes the read path', async () => {
    const load = vi.fn(async () => ok())
    const store = engine({ load })

    await store.revalidate()

    expect(load).toHaveBeenCalledTimes(1)
    expect(store.getState().mode).toBe('store')
    expect(store.getState().status).toBe('ready')
    expect(Object.keys(store.getState().groups)).toHaveLength(2)
    expect(store.getState().watermark).not.toBeNull()
  })

  it('notifies its subscribers once per change', async () => {
    const store = engine()
    const listener = vi.fn()
    store.subscribe(listener)

    await store.revalidate()

    expect(listener).toHaveBeenCalled()
    const after = listener.mock.calls.length
    store.stage([{ t: 'group.patch', id: 'g-sharma', patch: { remarks: 'x' } }])
    expect(listener.mock.calls.length).toBeGreaterThan(after)
  })

  it('does nothing after stop()', async () => {
    const load = vi.fn(async () => ok())
    const store = engine({ load })
    store.stop()
    await store.revalidate()
    expect(load).not.toHaveBeenCalled()
  })
})

describe('when the database has no event_snapshot', () => {
  it('falls back, and stops asking', async () => {
    const load = vi.fn<() => Promise<SnapshotLoad>>(async () => ({
      ok: false,
      unsupported: true,
      message: 'Could not find the function public.event_snapshot',
    }))
    const store = engine({ load })

    await store.revalidate()

    // The screens branch on this and use the reads they had before this job.
    expect(store.getState().mode).toBe('fallback')
    // `status: 'ready'` rather than 'empty': the store is not loading, it is
    // deliberately not the source of truth.
    expect(store.getState().status).toBe('ready')
    expect(store.getState().error).toBeNull()

    // AND IT STOPS ASKING. A missing function is not going to appear, and a
    // retry on every resume would be a wasted round trip on every dial.
    await store.revalidate()
    await store.catchUp()
    expect(load).toHaveBeenCalledTimes(1)
  })
})

describe('when the request fails for another reason', () => {
  it('does not mistake a transport failure for a missing function', async () => {
    const load = vi.fn<() => Promise<SnapshotLoad>>(async () => ({
      ok: false,
      unsupported: false,
      message: 'fetch failed',
    }))
    const store = engine({ load })

    await store.revalidate()

    // With no data at all the screens are handed back their own reads, so they
    // can show their honest error state instead of an empty screen...
    expect(store.getState().mode).toBe('fallback')
    expect(store.getState().error).toBe('fetch failed')
    // ...but the RPC is NOT disabled, so a later success puts the store back in
    // charge rather than leaving the app on the slow path for the session.
    await store.revalidate()
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('keeps the cached rows and stays the read path', async () => {
    let failing = false
    const load = async (): Promise<SnapshotLoad> =>
      failing ? { ok: false, unsupported: false, message: 'offline' } : ok()
    // The catch-up fails with the same transport, which is what a real corridor
    // does: both RPCs go over the one dead link. Injecting the failure matters,
    // because the default loader is a SUCCESS and would legitimately clear the
    // error — the assertion below is about a request that failed, not about a
    // revalidate that was never attempted.
    const loadChanges = async (): Promise<SnapshotLoad> =>
      failing ? { ok: false, unsupported: false, message: 'offline' } : ok()
    const store = engine({ load, loadChanges })

    await store.revalidate()
    expect(store.getState().mode).toBe('store')

    failing = true
    await store.catchUp()

    // A phone in a corridor loses the network constantly; it must not lose the
    // event with it.
    expect(store.getState().mode).toBe('store')
    expect(Object.keys(store.getState().groups)).toHaveLength(2)
    expect(store.getState().error).toBe('offline')
    expect(store.getState().staleForMs).not.toBeNull()
  })

  it('refuses a payload version it cannot read without downgrading', async () => {
    const load = async (): Promise<SnapshotLoad> => ({
      ok: true,
      payload: { ...payload(), v: 99 },
      unsupported: false,
      message: '',
    })
    const store = engine({ load })
    await store.revalidate()
    // The function answered, so it IS deployed. The right answer to "newer
    // payload" is an honest message, not the old slow path.
    expect(store.getState().mode).toBe('store')
    expect(store.getState().error).toMatch(/older than the server/)
  })
})

describe('a resume', () => {
  it('catches up after a short gap and re-snapshots after a long one', async () => {
    const load = vi.fn(async () => ok())
    const loadChanges = vi.fn(async () => ok({ groups: [], callStats: [] }))
    const store = engine({ load, loadChanges })
    await store.revalidate()
    expect(load).toHaveBeenCalledTimes(1)

    store.resumeAfter(2 * 60_000)
    await flush()
    expect(loadChanges).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledTimes(1)

    store.resumeAfter(20 * 60_000)
    await flush()
    // A gap this long may have contained a DELETE, and a delta cannot see one.
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('ignores a gap shorter than the resume threshold', async () => {
    const load = vi.fn(async () => ok())
    const loadChanges = vi.fn(async () => ok({ groups: [], callStats: [] }))
    const store = engine({ load, loadChanges })
    await store.revalidate()

    store.resumeAfter(5_000)
    await flush()
    // `tel:` backgrounds the WebView on EVERY call, so this fires dozens of
    // times an hour; a five-second hop is not worth a request.
    expect(loadChanges).not.toHaveBeenCalled()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('re-snapshots instead of catching up when there is no watermark yet', async () => {
    const load = vi.fn(async () => ok())
    const loadChanges = vi.fn(async () => ok())
    const store = engine({ load, loadChanges })

    // No snapshot has landed, so `catchUp` has nothing to ask from.
    await store.catchUp()
    expect(loadChanges).not.toHaveBeenCalled()
    expect(load).toHaveBeenCalledTimes(1)
  })
})

describe('a delta', () => {
  it('merges changed rows and advances the watermark', async () => {
    const next = at(600)
    const store = engine({
      loadChanges: async () => ok({ watermark: next, groups: [group({ id: 'g-desai', head_name: 'Renamed' })] }),
    })
    await store.revalidate()

    await store.catchUp()

    expect(store.getState().groups['g-desai']?.head_name).toBe('Renamed')
    // Sharma was not in the delta and must still be there: a delta never clears
    // a table.
    expect(store.getState().groups['g-sharma']).toBeDefined()
    expect(store.getState().watermark).toBe(next)
  })

  it('passes the current watermark as `since`', async () => {
    const seen: string[] = []
    const store = engine({
      loadChanges: async (_eventId, since) => {
        seen.push(since)
        return ok({ groups: [], callStats: [] })
      },
    })
    await store.revalidate()
    const first = store.getState().watermark
    await store.catchUp()
    expect(seen[0]).toBe(first)
  })

  it('drops an assignment that arrived released', async () => {
    const store = engine({
      loadChanges: async () =>
        ok({
          assignments: [
            assignment({
              id: 'a-1',
              room_id: 'r-1',
              guest_id: 'gu-1',
              group_id: 'g-sharma',
              released_at: at(30),
            }),
          ],
        }),
    })
    await store.revalidate()
    expect(store.getState().assignments['a-1']).toBeDefined()
    await store.catchUp()
    expect(store.getState().assignments['a-1']).toBeUndefined()
  })
})

describe('a local write', () => {
  it('applies at once and reverts exactly its own rows', async () => {
    const store = engine()
    await store.revalidate()

    const staged = store.stage([
      { t: 'group.patch', id: 'g-sharma', patch: { rsvp_status: 'declined' } },
      { t: 'callStat.bump', groupId: 'g-sharma', at: at(10), outcome: 'no_answer', nextCallbackAt: null },
    ])
    expect(store.getState().groups['g-sharma']?.rsvp_status).toBe('declined')
    expect(store.getState().callStats['g-sharma']?.n).toBe(3)

    staged.revert()
    expect(store.getState().groups['g-sharma']?.rsvp_status).toBe('confirmed')
    expect(store.getState().callStats['g-sharma']?.n).toBe(2)
  })

  it('leaves a later write alone when an earlier one is reverted', async () => {
    const store = engine()
    await store.revalidate()

    const first = store.stage([
      { t: 'group.patch', id: 'g-desai', patch: { remarks: 'placed' } },
    ])
    store.stage([{ t: 'row.remove', key: 'assignments', id: 'a-1' }])

    // The first write is refused; the second must survive. Restoring a snapshot
    // of the whole state would have taken the release with it.
    first.revert()
    expect(store.getState().groups['g-desai']?.remarks).toBeNull()
    expect(store.getState().assignments['a-1']).toBeUndefined()
  })

  it('is a no-op for an empty op list', async () => {
    const store = engine()
    await store.revalidate()
    const before = store.getState()
    store.stage([])
    expect(store.getState()).toBe(before)
  })
})

describe('a realtime row', () => {
  it('patches a group with no round trip', async () => {
    const load = vi.fn(async () => ok())
    const store = engine({ load })
    await store.revalidate()

    store.applyRealtimeGroup({
      eventType: 'UPDATE',
      new: {
        id: 'g-desai',
        event_id: EVENT_ID,
        head_name: 'Desai (live)',
        rsvp_status: 'confirmed',
        source_row_hash: 'abc',
      },
    })

    expect(store.getState().groups['g-desai']?.head_name).toBe('Desai (live)')
    // The row arrives with `event_id` and `source_row_hash` on it (they are
    // table columns) and the store's rows carry neither — the same strip the
    // migration performs, so a realtime row and a snapshot row are one shape.
    const row = store.getState().groups['g-desai'] as unknown as Record<string, unknown>
    expect(row.event_id).toBeUndefined()
    expect(row.source_row_hash).toBeUndefined()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('removes a deleted group', async () => {
    const store = engine()
    await store.revalidate()
    store.applyRealtimeGroup({ eventType: 'DELETE', old: { id: 'g-desai' } })
    expect(store.getState().groups['g-desai']).toBeUndefined()
    expect(store.getState().groups['g-sharma']).toBeDefined()
  })

  it('ignores a row with no usable id', async () => {
    const store = engine()
    await store.revalidate()
    const before = store.getState()
    store.applyRealtimeGroup({ eventType: 'UPDATE', new: { head_name: 'no id' } })
    expect(store.getState()).toBe(before)
  })
})

describe('serialisation', () => {
  it('never lets an older snapshot overwrite a newer one', async () => {
    let releaseFirst: (() => void) | undefined
    let call = 0
    const store = engine({
      load: async () => {
        call += 1
        if (call === 1) {
          // The first request hangs until the test lets it go, so the second
          // `revalidate()` is provably issued while the first is still in
          // flight. Without the engine's serialisation the two would settle out
          // of order and the stale rows would win.
          await new Promise<void>((resolve) => {
            releaseFirst = resolve
          })
          return ok({ groups: [group({ id: 'g-stale', head_name: 'Stale' })] })
        }
        return ok({ groups: [group({ id: 'g-fresh', head_name: 'Fresh' })] })
      },
    })

    const first = store.revalidate()
    // One microtask, so the loader has had its first suspension and the first
    // request is genuinely open rather than merely scheduled.
    await Promise.resolve()
    expect(releaseFirst).toBeTypeOf('function')

    const second = store.revalidate()
    releaseFirst?.()
    await first
    await second
    await flush()

    expect(store.getState().groups['g-fresh']).toBeDefined()
    expect(store.getState().groups['g-stale']).toBeUndefined()
  })
})
