/**
 * Every open sheet or dialog, topmost last.
 *
 * WHY THIS EXISTS (UI4 Part S, N4). Android's back button used to call
 * `history.back()` unconditionally (`NativeBridge`), so with a sheet open it
 * navigated the page underneath away — the sheet vanished with the screen it
 * was about. Back must close the top sheet first. A sheet registers its close
 * function while it is open; the back handler asks `closeTopSheet()` before it
 * touches history.
 *
 * Module state, not React context: the back button is a native event that
 * arrives outside any component tree, and one tab has one stack.
 */

type Close = () => void

const stack: Close[] = []

/** Register an open sheet. Returns the function that unregisters it. */
export function pushSheet(close: Close): () => void {
  stack.push(close)
  return () => {
    const i = stack.lastIndexOf(close)
    if (i !== -1) stack.splice(i, 1)
  }
}

/** Close the topmost sheet, if any. True when one was closed. */
export function closeTopSheet(): boolean {
  const top = stack[stack.length - 1]
  if (!top) return false
  top()
  return true
}

/** How many sheets are open. For tests and the back-button resolver. */
export function openSheetCount(): number {
  return stack.length
}
