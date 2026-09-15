# EventFlow UX Rules

These eight rules govern every screen in EventFlow. The standard: **a 14-year-old handed the phone with no explanation can do the job on the screen.** If they have to ask what a word means, or cannot tell what to tap, the screen has failed.

---

### R1. One job per screen
A screen must name the single job it exists for in its title, and its primary action must be the largest, most obvious tappable control on the screen. Do not clutter primary task flows with competing secondary buttons or unrelated stats.

- **Right:** `src/app/(staff)/[eventCode]/hospitality/deliveries/[deliverableId]/DeliveryDetail.tsx` clearly focuses on confirming delivery, with the large, prominent "Take photo proof" button dominating the action area.
- **Wrong:** Detail routes like `src/app/(staff)/[eventCode]/rsvp/status/[groupId]/page.tsx` where the header only displays the event name instead of the action ("Log RSVP"), leaving the user to figure out what the screen is asking them to do.

---

### R2. Plain words only
Every noun and label displayed on screen must be a word a wedding guest or first-day runner understands. Trade terms, internal jargon, and developer vocabulary are banned from the user interface; they survive only in database schemas and Excel export column headers where third-party sheets require them.

- **Right:** Showing "guests" for people counts, "family" for groups, "hamper" / "return gift" for items, and "Home" / "Rooms" / "Setup" for navigation tabs.
- **Wrong:** Displaying `"Total pax on the list"` in `src/app/(staff)/[eventCode]/dashboard/page.tsx:177`, labelling tabs `"Board"` / `"Stay"` / `"Prep"` in `src/lib/sections/config.tsx`, or displaying `"Unmatched"` and `"Deliverable"` on staff cards.

---

### R3. Never a dead end
Every screen must provide a clear, visible way back and an obvious next step. Detail screens must provide an explicit back button in the header naming where it leads, and empty states must direct the user to what to do next rather than simply reporting that nothing is there.

- **Right:** `src/app/(staff)/[eventCode]/dashboard/page.tsx:121` where an empty board explains: *"The board fills in as soon as there is a guest list to count. Import the calling sheet and every number on this screen starts working"* with a direct button to `Import the guest list`.
- **Wrong:** Screens like `src/app/(staff)/[eventCode]/rsvp/status/[groupId]` or `src/app/(staff)/[eventCode]/hamper/[id]` that lack a back button in `StickyHeader` and render no `SectionTabs`, stranding the user unless they know to swipe or use their hardware back gesture.

---

### R4. Every number is a door
Any metric, counter, or figure displayed on a screen must link directly to the list of items it counts. If a runner sees "12 pending", tapping that number must take them straight to those 12 items.

- **Right:** `src/components/dashboard/StatCard.tsx` where tapping `"RSVP pending"` navigates straight to `/${eventCode}/rsvp/queue`.
- **Wrong:** Plain text summaries or counter chips that display numbers without a click target, forcing users to manually navigate through sections to find what was counted.

---

### R5. Undo, don't confirm
Reversible operations must take effect immediately and offer a temporary, non-blocking "Undo" bar. Do not interrupt common workflows with confirmation dialogs unless the action is truly irreversible (such as sealing an insert-only photo delivery proof).

- **Right:** Moving a guest room assignment or toggling a check-in status applies immediately and surfaces an `UndoBar` for 7 seconds. Sealing a proof in `src/app/(staff)/[eventCode]/hospitality/deliveries/[deliverableId]/DeliveryDetail.tsx` shows a confirmation dialog explicitly noting that photo proofs cannot be deleted.
- **Wrong:** Presenting confirmation modals on every routine assignment or room swap, or offering a dangerous capacity override dialog when swapping two full rooms instead of prompting to empty one room first.

---

### R6. Tell the truth about failure
Error messages must plainly explain three things in one or two short sentences: what happened, what to do right now, and who to contact if it persists. Never display raw Postgres codes, HTTP numbers, or cryptic exceptions.

- **Right:** `src/app/(staff)/[eventCode]/dashboard/page.tsx:85` stating: *"Could not load the numbers. The dashboard counters did not come back from the database this time. This is a load failure, not an empty event — reload the page, and tell your admin if it keeps happening."*
- **Wrong:** Displaying unhandled runtime alerts like `"Postgres error 23514: check constraint violation"` or `"PGRST205 relation does not exist"` with no recovery action.

---

### R7. Thumb-sized and daylight-legible
All interactive controls must be at least 44×44px with generous spacing for single-handed operation on low-cost mobile handsets. Text must use a 16px minimum base font, strong contrast that remains readable in harsh outdoor sunlight or bright hotel lobbies, and fit comfortably within a single 480px column without horizontal scrolling.

- **Right:** Using `tap min-h-12 text-base` buttons and `data-theme="client"` high-contrast warm paper ground for bright lobby reading.
- **Wrong:** 24px icon links tightly clustered together, 12px muted grey text against low-contrast backgrounds, or horizontal table overflow at 360px screen width.

---

### R8. It works when the Wi-Fi doesn't
Every write operation must honestly inform the user of its synchronization status. If a write is stored locally on the phone because the network dropped, the UI must say it is saved on this phone rather than silently pretending it reached the server or failing outright.

- **Right:** Using `src/components/ui/SyncChip.tsx` to clearly indicate whether an action is `"Saved on this phone"`, `"Sending..."`, or `"Saved"`.
- **Wrong:** Silent mock-success alerts when offline, or blocking the user with infinite loading spinners when venue Wi-Fi drops in the banquet hall.
