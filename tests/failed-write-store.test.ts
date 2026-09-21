import { describe, it, expect, beforeEach, vi } from 'vitest'

import {
  __resetUndoStoreForTests,
  clearFailedWrite,
  getFailedWriteSnapshot,
  offerUndo,
  reportFailedWrite,
  subscribeUndo,
} from '@/lib/mutate/undo-store'

/**
 * Guards the second slot in the undo store: a write the server REFUSED after
 * the screen that sent it had gone.
 *
 * WHY THIS FILE EXISTS. `offerUndo` is module-level so a deferred write commits
 * on schedule when the user walks away mid-window — that is the design. But the
 * result of that commit was reported only through React state on the component
 * that armed it, so a server refusal (the room guard's 23514, an RLS refusal)
 * reached nobody once that component had unmounted: the cache rolled back and
 * the row quietly reappeared in a list nobody was looking at. R1 found it by
 * reading `report` in `useOptimisticAction` against the unmount path.
 *
 * A transport failure never had this hole — it is queued, and `SyncChip` counts
 * the queue. A server DECISION is deliberately not queued, because replaying it
 * fails identically, which is exactly why it needed a surface of its own.
 */
describe('the failed-write slot', () => {
  beforeEach(() => {
    __resetUndoStoreForTests()
  })

  it('starts empty, so the bar renders nothing on a healthy screen', () => {
    expect(getFailedWriteSnapshot()).toBeNull()
  })

  it('holds the server’s own words and notifies the bar', () => {
    const listener = vi.fn()
    subscribeUndo(listener)

    reportFailedWrite('Room 412 has no bed left for these guests.')

    expect(getFailedWriteSnapshot()?.message).toBe(
      'Room 412 has no bed left for these guests.',
    )
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('is dismissed by the user, and then stays gone', () => {
    reportFailedWrite('Nope.')
    const listener = vi.fn()
    subscribeUndo(listener)

    clearFailedWrite()

    expect(getFailedWriteSnapshot()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(1)

    // Idempotent: dismissing an empty slot must not re-render the whole app.
    listener.mockClear()
    clearFailedWrite()
    expect(listener).not.toHaveBeenCalled()
  })

  it('is cleared by the test reset, so cases cannot leak into each other', () => {
    reportFailedWrite('Nope.')
    __resetUndoStoreForTests()
    expect(getFailedWriteSnapshot()).toBeNull()
  })

  it('does not consume or disturb a pending undo — they are different answers', () => {
    // "Do you want this?" and "that was refused" are not the same message and
    // must never be merged into one control: one offers a way back, the other
    // reports that there is nothing to go back to.
    offerUndo({ message: 'Room 204 · Sharma family', commit: () => {}, undo: () => {} })
    reportFailedWrite('Room 412 has no bed left for these guests.')

    expect(getFailedWriteSnapshot()?.message).toContain('no bed left')
    clearFailedWrite()
    expect(getFailedWriteSnapshot()).toBeNull()
  })
})
