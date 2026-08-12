/**
 * The perf-baseline switch, in a module that is safe to import from anywhere.
 *
 * It used to live in queries.ts, which is `server-only` — so any client module
 * that wanted it dragged cookies() and redirect() in behind it and broke the
 * static export build.
 *
 * CAVEAT worth knowing before you trust a measurement: `NUVENT_PERF_BASELINE`
 * has no `NEXT_PUBLIC_` prefix, so Next inlines it as `undefined` in a client
 * bundle and this constant is ALWAYS false there. That was already true of the
 * old location; it matters more now, because M2 turns the whole app into client
 * code, so the flag stops having anywhere to be true. If baseline mode is still
 * wanted after the conversion, this needs a NEXT_PUBLIC_ variable — renaming it
 * is a deliberate change, not a cleanup, so it is left alone here.
 */
export const PERF_BASELINE = process.env.NUVENT_PERF_BASELINE === '1'
