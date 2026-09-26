/**
 * The family record's first load (G1).
 *
 * WHY THIS EXISTS. Opening a family is a real navigation to a SERVER component
 * that claims the caller lock before it renders anything, so there is a moment
 * with nothing on the glass. S4's answer — render the header instantly from the
 * row in the list cache — needs the record converted to a client query
 * consumer, and that conversion is still open (it is a rewrite of a screen the
 * v1 tree shares, and it touches the lock). Until then the wait is filled with
 * the SHAPE of the record: same identity card, same five outcome chips, same
 * notes field, same padding. Nothing jumps when the real screen replaces it.
 *
 * NOT A SPINNER, and not a full-screen one: T4 forbids a spinner standing where
 * a known layout belongs. No animation of its own either — the shell's fade
 * covers the arrival, and the blocks are static so a cheap handset paints them
 * once rather than animating 543 of nothing.
 */
export default function Loading() {
  return (
    <div
      className="flex flex-col gap-4 pb-nav-bottombar"
      role="status"
      aria-label="Loading the family record"
    >
      {/* The identity card: avatar, name, meta, status word. */}
      <div className="flex items-start gap-3 rounded-2xl border border-rule bg-surface p-4 shadow-e1">
        <span className="h-11 w-11 shrink-0 rounded-full bg-rule-strong" />
        <div className="min-w-0 flex-1">
          <div className="h-6 w-3/5 rounded bg-rule-strong" />
          <div className="mt-2 h-3.5 w-2/5 rounded bg-rule" />
        </div>
        <span className="h-4 w-16 shrink-0 rounded bg-rule" />
      </div>

      {/* "What happened?" — the five outcome chips. */}
      <div className="flex flex-col gap-2.5">
        <div className="h-3.5 w-28 rounded bg-rule" />
        <div className="flex flex-wrap gap-2">
          <span className="h-11 w-24 rounded-full bg-rule" />
          <span className="h-11 w-20 rounded-full bg-rule" />
          <span className="h-11 w-24 rounded-full bg-rule" />
          <span className="h-11 w-20 rounded-full bg-rule" />
          <span className="h-11 w-20 rounded-full bg-rule" />
        </div>
      </div>

      {/* The notes field. */}
      <div className="h-20 rounded-xl border border-rule bg-surface" />
    </div>
  )
}
