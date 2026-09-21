import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

import { runOptimisticWrite, stageOptimisticWrite, type ActionResult } from '@/lib/mutate/optimistic'
import {
  UNDO_WINDOW_MS,
  __resetUndoStoreForTests,
  commitPendingUndo,
  getUndoSnapshot,
  offerUndo,
  undoPendingUndo,
} from '@/lib/mutate/undo-store'

/**
 * The optimistic-write contract, tested directly rather than through a screen.
 *
 * `runOptimisticWrite` is deliberately a plain function over a `QueryClient`, so
 * the part that decides whether a user's tap survives can be tested with no DOM
 * and no browser — which matters here, because the Playwright runner cannot run
 * in this environment (docs/FEEL-BASELINE.md) and an untested write path is
 * exactly the thing that loses someone's work.
 */

type Row = { id: string; status: string }

function makeClient(seed: Row[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const key = ['event', 'evt-1', 'rows'] as const
  qc.setQueryData(key, seed)
  return { qc, key }
}

const ok = <T,>(data: T): ActionResult<T> => ({ ok: true, data })

describe('runOptimisticWrite', () => {
  it('changes the cache BEFORE the server answers', async () => {
    const { qc, key } = makeClient([{ id: 'a', status: 'not_started' }])

    let release: (r: ActionResult<Row>) => void = () => {}
    const pending = new Promise<ActionResult<Row>>((res) => {
      release = res
    })

    const write = runOptimisticWrite<Row[], { id: string; status: string }, Row>({
      queryClient: qc,
      queryKey: key,
      vars: { id: 'a', status: 'confirmed' },
      apply: (prev, vars) => (prev ?? []).map((r) => (r.id === vars.id ? { ...r, status: vars.status } : r)),
      action: () => pending,
      callSite: 'test',
    })

    // The whole point: the screen is already right while the action is in flight.
    await vi.waitFor(() => {
      expect(qc.getQueryData<Row[]>(key)?.[0].status).toBe('confirmed')
    })

    release(ok({ id: 'a', status: 'confirmed' }))
    await expect(write).resolves.toEqual({ status: 'ok' })
  })

  it('reconciles the guess with what the server actually returned', async () => {
    const { qc, key } = makeClient([{ id: 'a', status: 'not_started' }])

    const outcome = await runOptimisticWrite<Row[], { id: string }, Row>({
      queryClient: qc,
      queryKey: key,
      vars: { id: 'a' },
      // The optimistic guess is vague; the server is authoritative.
      apply: (prev) => (prev ?? []).map((r) => ({ ...r, status: 'pending' })),
      action: async () => ok({ id: 'a', status: 'server-said-this' }),
      reconcile: (server, optimistic) =>
        optimistic.map((r) => (r.id === server.id ? { ...r, status: server.status } : r)),
      callSite: 'test',
    })

    expect(outcome).toEqual({ status: 'ok' })
    expect(qc.getQueryData<Row[]>(key)?.[0].status).toBe('server-said-this')
  })

  it('rolls back to the EXACT previous value and reports the real reason', async () => {
    const before: Row[] = [
      { id: 'a', status: 'confirmed' },
      { id: 'b', status: 'not_started' },
    ]
    const { qc, key } = makeClient(before)

    const outcome = await runOptimisticWrite<Row[], { id: string; status: string }, never>({
      queryClient: qc,
      queryKey: key,
      vars: { id: 'b', status: 'declined' },
      apply: (prev, vars) => (prev ?? []).map((r) => (r.id === vars.id ? { ...r, status: vars.status } : r)),
      // The database refused it — a real, user-meaningful reason.
      action: async () => ({ ok: false, message: 'Someone else is holding this record right now.' }),
      callSite: 'test',
    })

    expect(outcome).toEqual({
      status: 'rolled-back',
      message: 'Someone else is holding this record right now.',
      // A server decision, not a transport failure — so it must NOT be queued.
      // Replaying it would fail identically.
      network: false,
    })
    // Restored to the previous value, not to some guess at it.
    expect(qc.getQueryData<Row[]>(key)).toEqual(before)
  })

  it('rolls back when the action THROWS, and says something honest', async () => {
    const before: Row[] = [{ id: 'a', status: 'confirmed' }]
    const { qc, key } = makeClient(before)

    const outcome = await runOptimisticWrite<Row[], { id: string }, never>({
      queryClient: qc,
      queryKey: key,
      vars: { id: 'a' },
      apply: (prev) => (prev ?? []).map((r) => ({ ...r, status: 'declined' })),
      action: async () => {
        throw new Error('fetch failed')
      },
      callSite: 'test',
    })

    // A thrown transport failure is the path that used to leave a spinner up
    // forever. It must roll back and translate, not propagate a raw message.
    expect(outcome.status).toBe('rolled-back')
    if (outcome.status === 'rolled-back') {
      expect(outcome.message).toContain('Could not reach the server')
    }
    expect(qc.getQueryData<Row[]>(key)).toEqual(before)
  })

  it('never leaves the cache patched after a failure', async () => {
    const before: Row[] = [{ id: 'a', status: 'confirmed' }]
    const { qc, key } = makeClient(before)

    await runOptimisticWrite<Row[], { id: string }, never>({
      queryClient: qc,
      queryKey: key,
      vars: { id: 'a' },
      apply: (prev) => (prev ?? []).map((r) => ({ ...r, status: 'declined' })),
      action: async () => ({ ok: false, message: 'nope' }),
      callSite: 'test',
    })

    // The failure mode this guards: an optimistic patch that outlives the
    // rejection, so the screen confidently shows something the database refused.
    expect(qc.getQueryData<Row[]>(key)?.[0].status).toBe('confirmed')
  })

  it('MARKS a transport failure as network, so the caller can queue it', async () => {
    const { qc, key } = makeClient([{ id: 'a', status: 'confirmed' }])

    const outcome = await runOptimisticWrite<Row[], { id: string }, never>({
      queryClient: qc,
      queryKey: key,
      vars: { id: 'a' },
      apply: (prev) => (prev ?? []).map((r) => ({ ...r, status: 'declined' })),
      action: async () => {
        throw new Error('fetch failed')
      },
      callSite: 'test',
    })

    // The distinction is the whole point: this is the venue's failure mode —
    // Wi-Fi associated and carrying nothing — and it is worth retrying later,
    // whereas a server decision is not.
    expect(outcome.status).toBe('rolled-back')
    if (outcome.status === 'rolled-back') {
      expect(outcome.network).toBe(true)
    }
  })

  it('a NETWORK failure can HOLD the patch, so a queued write does not flash back', async () => {
    const { qc, key } = makeClient([{ id: 'a', status: 'confirmed' }])

    const outcome = await runOptimisticWrite<Row[], { id: string }, never>({
      queryClient: qc,
      queryKey: key,
      vars: { id: 'a' },
      apply: (prev) => (prev ?? []).map((r) => ({ ...r, status: 'declined' })),
      action: async () => {
        throw new Error('fetch failed')
      },
      callSite: 'test',
      holdOnNetworkFailure: true,
    })

    expect(outcome.status).toBe('rolled-back')
    // The row keeps what the user set, because the hook is about to queue this
    // and report it as saved-on-this-phone. Rolling it back here and re-applying
    // it from the queue made the row jump backwards and forwards.
    expect(qc.getQueryData<Row[]>(key)?.[0].status).toBe('declined')
  })

  it('a SERVER failure rolls back even when holding is allowed', async () => {
    const before: Row[] = [{ id: 'a', status: 'confirmed' }]
    const { qc, key } = makeClient(before)

    await runOptimisticWrite<Row[], { id: string }, never>({
      queryClient: qc,
      queryKey: key,
      vars: { id: 'a' },
      apply: (prev) => (prev ?? []).map((r) => ({ ...r, status: 'declined' })),
      action: async () => ({ ok: false, message: 'Not permitted.' }),
      callSite: 'test',
      holdOnNetworkFailure: true,
    })

    // `holdOnNetworkFailure` must not become a way to keep a patch the database
    // refused — that would leave the screen asserting something untrue.
    expect(qc.getQueryData<Row[]>(key)).toEqual(before)
  })
})

describe('undo store', () => {
  beforeEach(() => {
    __resetUndoStoreForTests()
    vi.useFakeTimers()
  })
  afterEach(() => {
    __resetUndoStoreForTests()
    vi.useRealTimers()
  })

  it('commits when the window expires', () => {
    const commit = vi.fn()
    offerUndo({ message: 'Sharma family · Confirmed', commit, undo: vi.fn() })

    expect(commit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(UNDO_WINDOW_MS)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(getUndoSnapshot()).toBeNull()
  })

  it('reverses instead of committing when Undo is pressed', () => {
    const commit = vi.fn()
    const undo = vi.fn()
    offerUndo({ message: 'x', commit, undo })

    undoPendingUndo()
    expect(undo).toHaveBeenCalledTimes(1)
    expect(commit).not.toHaveBeenCalled()

    // And the timer is gone, so it cannot fire afterwards.
    vi.advanceTimersByTime(UNDO_WINDOW_MS * 2)
    expect(commit).not.toHaveBeenCalled()
  })

  it('commits immediately when the bar is tapped to keep it', () => {
    const commit = vi.fn()
    offerUndo({ message: 'x', commit, undo: vi.fn() })

    commitPendingUndo()
    expect(commit).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(UNDO_WINDOW_MS * 2)
    expect(commit).toHaveBeenCalledTimes(1)
  })

  it('a second action COMMITS the first and replaces it', () => {
    const firstCommit = vi.fn()
    const firstUndo = vi.fn()
    offerUndo({ message: 'first', commit: firstCommit, undo: firstUndo })

    offerUndo({ message: 'second', commit: vi.fn(), undo: vi.fn() })

    // Displacement commits: the older write stops being in question, rather
    // than queueing up a second thing for one Undo button to reverse.
    expect(firstCommit).toHaveBeenCalledTimes(1)
    expect(firstUndo).not.toHaveBeenCalled()
    expect(getUndoSnapshot()?.message).toBe('second')
  })

  it('exposes at most one pending undo at any moment', () => {
    offerUndo({ message: 'a', commit: vi.fn(), undo: vi.fn() })
    offerUndo({ message: 'b', commit: vi.fn(), undo: vi.fn() })
    offerUndo({ message: 'c', commit: vi.fn(), undo: vi.fn() })

    // "One at a time" is the whole contract of the bar; two would give one Undo
    // button that can only reverse the newer of them.
    expect(getUndoSnapshot()?.message).toBe('c')
  })

  it('keeps a STABLE snapshot identity between changes', () => {
    offerUndo({ message: 'x', commit: vi.fn(), undo: vi.fn() })
    const a = getUndoSnapshot()
    const b = getUndoSnapshot()
    // useSyncExternalStore re-renders on identity change, so a fresh object here
    // would loop forever.
    expect(a).toBe(b)
  })
})

/**
 * The deferred mode: the write is held open until the undo window closes, so
 * Undo means NOTHING WAS SENT.
 *
 * This is the honest undo for state with no reverse action — `check_in_room` and
 * `check_out_room` only ever move forward (they set a timestamp, they never clear
 * one), so a compensating "reverse" write would land the row on a DIFFERENT
 * wrong state. Holding the write is the only way Undo can tell the truth.
 */
describe('stageOptimisticWrite (deferred)', () => {
  it('changes the screen WITHOUT telling the server', async () => {
    const { qc, key } = makeClient([{ id: 'a', status: 'not_started' }])
    const action = vi.fn(async () => ok({ id: 'a', status: 'confirmed' }))

    const staged = await stageOptimisticWrite<Row[], { id: string; status: string }, Row>({
      queryClient: qc,
      queryKey: key,
      vars: { id: 'a', status: 'confirmed' },
      apply: (prev, vars) => (prev ?? []).map((r) => (r.id === vars.id ? { ...r, status: vars.status } : r)),
      action,
      callSite: 'test',
    })

    expect(qc.getQueryData<Row[]>(key)?.[0].status).toBe('confirmed')
    expect(action).not.toHaveBeenCalled()
    expect(staged).toBeTruthy()
  })

  it('revert() restores the previous value and the action NEVER runs', async () => {
    const before: Row[] = [{ id: 'a', status: 'not_started' }]
    const { qc, key } = makeClient(before)
    const action = vi.fn(async () => ok({ id: 'a', status: 'confirmed' }))

    const staged = await stageOptimisticWrite<Row[], { id: string; status: string }, Row>({
      queryClient: qc,
      queryKey: key,
      vars: { id: 'a', status: 'confirmed' },
      apply: (prev, vars) => (prev ?? []).map((r) => (r.id === vars.id ? { ...r, status: vars.status } : r)),
      action,
      callSite: 'test',
    })

    staged.revert()

    expect(qc.getQueryData<Row[]>(key)).toEqual(before)
    // The point of deferring: Undo cancels a write that never happened, so
    // there is nothing to compensate for and nothing the database has to undo.
    expect(action).not.toHaveBeenCalled()
  })

  it('send() fires the action exactly ONCE, however many times it is called', async () => {
    const { qc, key } = makeClient([{ id: 'a', status: 'not_started' }])
    const action = vi.fn(async () => ok({ id: 'a', status: 'confirmed' }))

    const staged = await stageOptimisticWrite<Row[], { id: string; status: string }, Row>({
      queryClient: qc,
      queryKey: key,
      vars: { id: 'a', status: 'confirmed' },
      apply: (prev, vars) => (prev ?? []).map((r) => (r.id === vars.id ? { ...r, status: vars.status } : r)),
      action,
      callSite: 'test',
    })

    // The undo window expiring AND a displaced undo can both reach send(). On a
    // forward-only RPC a double send is two writes for one tap, and neither can
    // be taken back.
    await staged.send()
    await staged.send()
    await staged.send()

    expect(action).toHaveBeenCalledTimes(1)
  })
})
