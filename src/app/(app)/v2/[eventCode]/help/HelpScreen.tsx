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
 */
const WHAT_IT_IS_FOR: Record<string, string> = {
  Home: 'What needs you right now, and today’s numbers.',
  Guests: 'The full guest list. Anyone on it can be searched.',
  Calls: 'The family to call next, and where to log what they said.',
  Travel: 'Who is arriving, and which vehicle is meeting them.',
  Rooms: 'Families still waiting for a room.',
  Hampers: 'Hampers and return gifts left to deliver.',
  Setup: 'Production and setup items for this event.',
  // A runner in a multi-screen department gets that section's CHILDREN as their
  // tabs (`bottomTabsFor`), so those labels need lines too.
  'Guest list': 'Everyone on this event, by family.',
  Import: 'Load a guest list from a spreadsheet.',
  Export: 'Download the guest list as a spreadsheet.',
  'Call list': 'The family to call next, and where to log what they said.',
  'Call notes': 'Recorded calls waiting to be checked and saved.',
  Arrivals: 'Who is arriving, and which vehicle is meeting them.',
  Departures: 'Who is leaving, and when.',
  Fleet: 'The vehicles this event has, and where each one is.',
  Trips: 'Every planned run, and who is on it.',
  'Check in / out': 'Mark a guest as arrived or checked out.',
}

function lineFor(tab: NavTab): string {
  return WHAT_IT_IS_FOR[tab.label] ?? 'Part of your work for this event.'
}

export interface HelpScreenProps {
  /**
   * Exactly the tabs this viewer's own bar shows, from the same
   * `bottomTabsFor(event.code, access, department)` call the shell already
   * makes. A hand-written list of "the five tabs" would be wrong for every
   * runner on this event, because most of them do not have five.
   */
  tabs: NavTab[]
  /** "Event lead", "Travel" — `DEPARTMENT_LABELS`, resolved on the server. */
  departmentLabel: string
}

/**
 * The whole cheat sheet, sized to fit one 6-inch screen with no scrolling.
 *
 * That fit is why the list is capped by the app rather than by this component:
 * a client has no tabs and no way in (the header withholds the control), a
 * runner whose section is a single screen has no bar and gets one row, and an
 * event lead gets five. Nothing here is prose, and there is no sixth row to
 * push the answer off the bottom.
 */
export function HelpScreen({ tabs, departmentLabel }: HelpScreenProps) {
  return (
    /*
     * THE BUDGET IS THE POINT OF THIS LAYOUT.
     *
     * "Fits a 6-inch phone with no scrolling" is a hard requirement, and it was
     * measured on the way here rather than assumed: an earlier version of this
     * screen was 735px of content inside a 655px column at 360x800, i.e. a
     * scroll bar on the one screen in the app whose entire job is to be read at
     * a glance by someone who is lost. Two things bought the space back:
     *
     *   - the title block and the "Your screens" heading are gone. The sticky
     *     header already says "How this app works", and a list of five labelled
     *     rows does not need to be announced.
     *   - each row is label and line in ONE flow rather than two stacked
     *     paragraphs, and the tab ICON is not drawn. The icon is a 24px glyph
     *     the reader is about to see again in their own bar a second later; it
     *     cost 30px of row height for no information they did not already have.
     *
     * Measured after: 623px total, comfortably inside the column even with
     * phone chrome eating the bottom of an 800px viewport.
     */
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-1.5" aria-label="Your screens">
        {tabs.map((tab) => (
          <li
            key={tab.key}
            className="flex items-baseline gap-2 rounded-xl border border-rule-strong bg-surface px-3 py-2"
          >
            <p className="shrink-0 text-base leading-snug font-medium text-ink">{tab.label}</p>
            <p className="min-w-0 text-sm leading-snug text-muted">{lineFor(tab)}</p>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-1.5 rounded-xl border border-rule-strong bg-surface px-3 py-2 text-sm leading-snug text-ink">
        <p>
          <span className="font-medium">Ask your event lead</span> when something
          is wrong. Say which screen you were on and what it said. You are
          signed in as {departmentLabel}.
        </p>
        <p>
          <span className="font-medium">
            If the app stops responding, don’t reload and don’t press back.
          </span>{' '}
          Wait. What is on your screen still works, and anything you already
          saved sends itself when the signal comes back.
        </p>
      </div>
    </div>
  )
}

export default HelpScreen
