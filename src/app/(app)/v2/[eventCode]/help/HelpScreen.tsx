import { Row } from '@/components/ui/Row'
import { V2_OFFLINE_NOTE } from '@/lib/offline-note'
import type { NavTab } from '@/lib/sections/config'

/**
 * The cheat sheet's body.
 *
 * ── One line per screen, in the runner's own words ────────────────────────
 * Keyed by the tab's LABEL, which comes from the shared nav config, so a screen
 * renamed there loses its line here rather than silently describing the old
 * one. Deliberately NOT keyed by href: the Calls tab renders `/rsvp/queue`
 * while still being the `rsvp` section tab (`tabHrefFor` in `AppTabs`), so an
 * href-keyed map would stop matching the moment that one remap changed.
 *
 * The fallback below is the point of the fallback: an unknown label renders a
 * true, boring sentence rather than an empty row.
 *
 * v3 (SPEC-V3 §4, "fewer words") shortened every line so it fits ONE line in a
 * `Row`'s meta slot at 360px — the truncated tail of a two-line sentence is
 * worse than no sentence, because the reader cannot tell there was more.
 */
const WHAT_IT_IS_FOR: Record<string, string> = {
  // The v3 labels (src/lib/sections/v3.ts, `V3_TAB_LABEL`) come first.
  Today: 'What needs you right now.',
  Calls: 'Call the next family and log it.',
  Logistics: 'Who is arriving, and their car.',
  Hospitality: 'Families still waiting for a room.',
  Hampers: 'Hampers left to deliver.',
  // The v1 labels, kept because the v1 shell renders this file's sibling
  // screens and a missing key would print the fallback line there.
  Home: 'What needs you right now.',
  Guests: 'The full guest list.',
  Setup: 'Setup items for this event.',
  // A runner in a multi-screen department gets that section's CHILDREN as their
  // tabs, so those labels need lines too.
  'Guest list': 'Everyone here, by family.',
  Import: 'Load a guest list from a spreadsheet.',
  Export: 'Download the guest list.',
  'Call list': 'Call the next family and log it.',
  'Call notes': 'Recorded calls to check and save.',
  Arrivals: 'Who is arriving, and their car.',
  Departures: 'Who is leaving, and when.',
  Fleet: 'The vehicles, and where each is.',
  Trips: 'Every planned run, and who is on it.',
  'Check in / out': 'Mark a guest arrived or checked out.',
}

function lineFor(tab: NavTab): string {
  return WHAT_IT_IS_FOR[tab.label] ?? 'Part of your work for this event.'
}

export interface HelpScreenProps {
  /**
   * Exactly the tabs this viewer's own bar shows, from the same
   * `v3TabsFor(event.code, access, department)` call the shell already makes. A
   * hand-written list of "the five tabs" would be wrong for every runner on
   * this event, because most of them do not have five.
   */
  tabs: NavTab[]
  /** "Event lead", "Travel" — `DEPARTMENT_LABELS`, resolved on the server. */
  departmentLabel: string
}

/**
 * The whole cheat sheet: one `Row` per screen, then two lines of housekeeping.
 *
 * ── What changed in v3, and what deliberately did not ─────────────────────
 * The per-tab lines are the useful part and they stay — one line each, now a
 * `Row`'s heading/meta pair instead of a bordered strip that repeated the same
 * box around every label. What left is the prose: the four-line "Ask your
 * event lead…" block is one sentence, and the paragraph shape is gone.
 *
 * THE OFFLINE LINE STAYS, VERBATIM, AND IS IMPORTED RATHER THAN RETYPED.
 * `V2_OFFLINE_NOTE` is the same string the offline banner renders, and it is
 * the deliberate operational mitigation for remote-shell mode (CLAUDE.md
 * §11b): a reload during a Wi-Fi drop lands the runner on `offline.html` with
 * nothing behind it, so "don't reload and don't press back" is the one
 * instruction that has to survive the redesign. A second copy of the sentence
 * here is how the two drift apart.
 */
export function HelpScreen({ tabs, departmentLabel }: HelpScreenProps) {
  return (
    <div className="flex flex-col gap-4">
      <section
        aria-label="Your screens"
        className="overflow-hidden rounded-2xl border border-rule bg-surface"
      >
        {tabs.map((tab) => (
          <Row key={tab.key} heading={tab.label} meta={lineFor(tab)} />
        ))}
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-rule bg-surface p-4">
        <p className="text-sm leading-snug text-muted">
          Signed in as {departmentLabel} — ask your event lead if something looks wrong.
        </p>
        <p className="text-base leading-snug font-medium text-ink">{V2_OFFLINE_NOTE}</p>
      </section>
    </div>
  )
}

export default HelpScreen
