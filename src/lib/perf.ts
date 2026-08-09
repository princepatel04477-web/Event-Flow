/**
 * Route-load timing instrumentation (Problem 2 of the nav/perf pass).
 *
 * Every route's data fetch gets wrapped in `traceFetch`, which logs the
 * labelled wall-clock time to the browser console as
 * `[perf] <label>: <ms>ms`. On a device this shows up in `adb logcat`
 * (Chromium console messages); in a headless run a Playwright probe captures
 * it from `page.on('console')`. Measurement is the FIRST step of the
 * performance work — nothing is optimised blind.
 */

/**
 * Time a fetch (or any async producer) and log the result.
 *
 * `label` names the route and the query, e.g. `fleet :: readFleet`. The
 * producer may return a plain value, a Promise, or a thenable (Supabase's
 * `PostgrestBuilder` is await-able but not a Promise) — `Awaited<T>` keeps
 * the resolved type. Never throws: a timing wrapper must not change control
 * flow — the caller's own error handling stays in charge.
 */
export async function traceFetch<T>(label: string, producer: () => T): Promise<Awaited<T>> {
  const startedAt = performance.now()
  try {
    const result = await producer()
    const ms = Math.round(performance.now() - startedAt)
    console.log(`[perf] ${label}: ${ms}ms`)
    return result
  } catch (e) {
    const ms = Math.round(performance.now() - startedAt)
    console.warn(`[perf] ${label}: FAILED after ${ms}ms`, e)
    throw e
  }
}
