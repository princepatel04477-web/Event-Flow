import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `pending.ts` reaches two server-action modules through its real drains —
 * `@/lib/voice-note/upload` (for `drainVoiceNotes`) and `@/lib/actions/call`
 * (lazily, inside `drainQueuedCompletions`). Both are `'use server'`, which
 * throws "This module cannot be imported from a Client Component module" the
 * moment a test resolves them, before a single assertion runs.
 *
 * They are mocked rather than removed from the module's import graph, because
 * the alternative — making the banner's caller inject every drain — would push
 * four real dependencies onto every screen that renders it. This suite only
 * exercises the COUNT, so the drains are stubbed and never called.
 */
vi.mock('@/lib/voice-note/upload', () => ({ drainVoiceNotes: async () => ({}) }))
vi.mock('@/lib/actions/call', () => ({ submitCallOutcome: async () => ({ ok: true }) }))
vi.mock('@/lib/proof', () => ({ submitProof: async () => null }))
vi.mock('@/lib/actions/voice-note', () => ({ registerVoiceNote: async () => ({ ok: true }) }))

import {
  __resetPendingForTests,
  pendingSummary,
  refreshPending,
  subscribePending,
  type PendingReaders,
} from '@/lib/mutate/pending'

/**
 * "How many changes is this phone holding?" — the banner's number (M50).
 *
 * THE BUG THIS PINS. The one global status surface in the app counted only the
 * proof queue. A call outcome queued with no signal rendered "Offline — 0 changes
 * queued" while the outcome sat unsent. The banner did not omit the backlog, it
 * DENIED it, during a calling shift. So the assertions below are about the SUM
 * crossing all four queues, and about the number being reported once rather than
 * four times.
 *
 * The readers are injected, which is the whole reason this is testable: there is
 * no `fake-indexeddb` in this project, and adding one to test four `.count()`
 * calls would be a dependency bought to avoid a seam.
 */

function readers(counts: {
  writes?: number
  proofs?: number
  completions?: number
  voiceNotes?: number
}): PendingReaders {
  return {
    writes: async () => counts.writes ?? 0,
    proofs: async () => counts.proofs ?? 0,
    completions: async () => counts.completions ?? 0,
    voiceNotes: async () => counts.voiceNotes ?? 0,
  }
}

beforeEach(() => {
  __resetPendingForTests()
})

describe('the pending total', () => {
  it('counts EVERY queue, not only proofs', async () => {
    const summary = await refreshPending(
      readers({ writes: 3, proofs: 1, completions: 2, voiceNotes: 4 }),
    )
    expect(summary).toEqual({ writes: 3, proofs: 1, completions: 2, voiceNotes: 4, total: 10 })
  })

  it('reports a queued call outcome as a change, which is the M50 case', async () => {
    // One call completion, nothing else. The old banner read 0 here.
    const summary = await refreshPending(readers({ completions: 1 }))
    expect(summary.total).toBe(1)
    expect(summary.proofs).toBe(0)
  })

  it('accepts a list OR a number from a reader', async () => {
    // The four queues expose both shapes; normalising them would mean touching
    // four persisted schemas for cosmetics.
    const summary = await refreshPending({
      writes: async () => [1, 2],
      proofs: async () => 3,
      completions: async () => [],
      voiceNotes: async () => [{}, {}],
    })
    expect(summary.total).toBe(7)
  })

  it('treats an unreadable queue as 0 rather than failing the whole banner', async () => {
    // Private mode, a cleared profile, a blocked database. Understating one
    // queue is survivable; a banner that cannot render hides the honest ones.
    const summary = await refreshPending({
      writes: async () => {
        throw new Error('blocked')
      },
      proofs: async () => 2,
      completions: async () => {
        throw new Error('blocked')
      },
      voiceNotes: async () => 1,
    })
    expect(summary.total).toBe(3)
  })

  it('shares one read between concurrent callers', async () => {
    const writes = vi.fn(async () => 1)
    const r: PendingReaders = {
      writes,
      proofs: async () => 0,
      completions: async () => 0,
      voiceNotes: async () => 0,
    }
    await Promise.all([refreshPending(r), refreshPending(r), refreshPending(r)])
    expect(writes).toHaveBeenCalledTimes(1)
  })
})

describe('publishing', () => {
  it('notifies subscribers when the total moves', async () => {
    const listener = vi.fn()
    subscribePending(listener)
    await refreshPending(readers({ completions: 1 }))
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('does NOT notify when nothing changed', async () => {
    // The 15s drain interval calls this unconditionally. A new object every
    // tick would re-render the banner (and every consumer) forever.
    await refreshPending(readers({ proofs: 2 }))
    const listener = vi.fn()
    subscribePending(listener)
    await refreshPending(readers({ proofs: 2 }))
    expect(listener).not.toHaveBeenCalled()
    expect(pendingSummary().total).toBe(2)
  })

  it('publishes a new object only when a number actually moves', async () => {
    const first = await refreshPending(readers({ proofs: 1 }))
    expect(pendingSummary()).toBe(first)
    await refreshPending(readers({ proofs: 1 }))
    expect(pendingSummary()).toBe(first)
    const third = await refreshPending(readers({ proofs: 2 }))
    expect(pendingSummary()).toBe(third)
    expect(pendingSummary()).not.toBe(first)
  })
})
