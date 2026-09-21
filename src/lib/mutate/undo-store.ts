/**
 * The single pending undo, as a module-level store.
 *
 * WHY MODULE-LEVEL AND NOT REACT STATE. Two reasons, and the second is the one
 * that decides it:
 *
 *  1. "One at a time" is a global property, not a per-screen one. If two screens
 *     each held their own pending undo, navigating between them would silently
 *     drop one — and a dropped undo is a write that is never committed and never
 *     reversed, which is the worst of the three outcomes.
 *  2. A screen can unmount while an undo is still on the clock. Holding the timer
 *     here means navigating away COMMITS the write on schedule instead of
 *     cancelling it. With React state the unmount would clear the timeout and
 *     the write would simply vanish.
 *
 * Shape follows `src/lib/useOnline.ts` — a module store plus
 * `useSyncExternalStore` — rather than inventing a context provider, because it
 * can be read from anywhere without every layout in between having to mount one.
 */

/** How long the undo stays available. Seven seconds, per docs/UX-RULES.md R5. */
export const UNDO_WINDOW_MS = 7_000

export interface PendingUndo {
  /** Monotonic id, so React can tell two consecutive undos apart. */
  id: number
  /** One line, in the user's words: "Room 204 · Sharma family". */
  message: string
  /** Runs when the window expires, when the bar is tapped, or when displaced. */
  commit: () => void
  /** Runs when Undo is pressed. Must genuinely reverse the write. */
  undo: () => void
}

let current: PendingUndo | null = null
let nextId = 1
let timer: ReturnType<typeof setTimeout> | null = null

const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

function clearTimer() {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
}

export function subscribeUndo(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * The snapshot. Returns the SAME object reference until something actually
 * changes — `useSyncExternalStore` re-renders on identity change, so building a
 * fresh object here would loop forever.
 */
export function getUndoSnapshot(): PendingUndo | null {
  return current
}

/** Server render: there is never a pending undo. */
export function getUndoServerSnapshot(): PendingUndo | null {
  return null
}

/**
 * Commit whatever is pending, if anything. Idempotent, and safe to call when
 * nothing is pending.
 */
export function commitPendingUndo(): void {
  if (!current) return
  const { commit } = current
  current = null
  clearTimer()
  emit()
  commit()
}

/** Reverse whatever is pending, if anything. */
export function undoPendingUndo(): void {
  if (!current) return
  const { undo } = current
  current = null
  clearTimer()
  emit()
  undo()
}

/**
 * Offer a new undo.
 *
 * A second call COMMITS the first and replaces it. The alternative — queueing
 * them — means a runner tapping twice quickly would later watch two unrelated
 * things happen at once, with one Undo button that can only reverse the newer
 * one. Committing on displacement is the honest behaviour: at most one write is
 * ever in question.
 */
export function offerUndo(entry: Omit<PendingUndo, 'id'>): void {
  commitPendingUndo()

  current = { ...entry, id: nextId++ }
  timer = setTimeout(() => {
    commitPendingUndo()
  }, UNDO_WINDOW_MS)
  emit()
}

/**
 * Test-only reset. Vitest runs many cases in one process and the module store
 * would otherwise leak a pending undo (and its timer) between them.
 */
export function __resetUndoStoreForTests(): void {
  clearTimer()
  current = null
  nextId = 1
  emit()
}
