# EventFlow — Client Feedback 3 Oct 2026 Prompt Series

For **Command Code (DeepSeek V4 Flash)** against `C:\dev\EventFlow`.

Run **one prompt per session, in order. Commit between each.** Every prompt is narrow on
purpose. Bugs first (the client is hitting them now), then wording, then new data, then the
big hamper change.

---

## What the client asked for, and how this series reads it

| # | Client's words | What it means in the app | Type | Prompt |
|---|---|---|---|---|
| 1 | "In exporting pax why it is one Qty only" | An Excel export puts `1` in the PAX/Qty column instead of the family's real guest count | Bug | F1 |
| 2 | "Planning vehicle for this board is not working" | Vehicle planning / fleet assignment from the board is broken | Bug | F2 |
| 3 | "Change calls Section To RSVP" | Rename every user-facing "Calls" section label to "RSVP" | Wording | F3 |
| 4 | "Families called ni guest called" | Counters say "families called"; client wants **guests called** (sum of guests in called families), shown next to families | Wording + count | F3 |
| 5 | "Make sure logistics log are same as the call logs dont want the bigger box" | Logistics log entries use a large card; make them the same compact row as the call log | UI | F4 |
| 6 | "Departure Notes is Missing" | Arrivals has notes, departures does not | Data | F5 |
| 7 | "Differentiate Guest And Adult" | Split each family's guest count into adults and children | Data | F6 |
| 8 | "Guest with bed" / "Occupied Guest" | Rooms screen should show how many guests are placed in rooms, how many have a real bed, and how many are on an extra bed | Count | F7 |
| 9 | "In hamper section add same as hospitality room section so that we can add hamper room wise" | Hamper allocation per **room**, using the same grid pattern as Rooms | Data + UI | F8 |

## Three things to confirm with the client BEFORE running F6, F7 and F8

Send these today. Each one changes the schema, so a wrong guess costs a migration.

1. **Adults vs children (F6):** up to what age is a guest a child? (Common: under 12.) Do
   children count in "guests" on every screen, or only adults?
2. **Guest with bed (F7):** does "guest with bed" mean *guests who got a proper bed in their
   room* (and the rest are on an extra mattress), or *guests who need a bed* (adults, not
   small children)? This series assumes the first; F7 says so in its prompt — edit it if the
   answer is the second.
3. **Hamper per room (F8):** one hamper per room, or one per guest in the room? And when a
   family is split across two rooms, does each room get its own hamper?
   (This is the open hamper question from before — the client has now answered "room-wise",
   but not the quantity rule.)

---

## PREAMBLE — paste at the top of every prompt, replacing `[PREAMBLE]`

```
You are working in C:\dev\EventFlow — a Next.js 16 / React 19 / TypeScript / Supabase /
TanStack Query / Capacitor app for running Indian wedding guest operations on cheap Android
phones over bad venue Wi-Fi. Read CLAUDE.md first; its rules override anything below.
Also read docs/UX-RULES.md and docs/GLOSSARY.md if they exist, and
docs/CLIENT-FEEDBACK-03OCT.md once F0 has created it.

Hard rules for this session:
- Change ONLY the files listed in "Files you may change". If the task needs another file,
  STOP and tell me which file and why. Do not change it.
- Schema changes go ONLY as a new timestamped file in supabase/migrations/. Write it, show
  it to me, and STOP. Do not apply it, do not run it in the SQL editor, until I say "apply".
- Every table is fenced by event_id. RLS stays in Postgres. Roles: admin, event_team,
  client (read-only). Never weaken a policy to make a feature work.
- No service-role writes from local scripts.
- Do not rename database columns, enum values, route segments, or cookie/storage keys
  (nuvent_* keys are FROZEN). User-facing strings may change; values compared with === may not.
- No `any`. No console.log. No TODOs, stubs or placeholders. If something cannot be
  finished, stop and say why.
- Do not add npm dependencies.
- Do not reformat or "tidy" code you are not changing. Keep every existing comment.
- Mobile first: 16px base, tap targets >= 44px, nothing overflows at 360px width.
- If the client-facing meaning of a field is unclear, STOP and ask me. Do not guess.

When done:
- Run `npx tsc --noEmit`, `npx vitest run`, and `npx eslint <files you touched>`.
  All must pass.
- Show `git diff --stat`.
- Append what you changed and why to DECISIONS.md.
- Commit as `fb03(<id>): <what>`.
- Tell me in plain words what the client can now do that they could not before, and what
  you verified only in code versus in a running app.
```

---

# F0 — Map every item before touching anything

*Read-only. Produces the map every later prompt reads.*

```
[PREAMBLE]

TASK: Find where each piece of client feedback lives in the code, and reproduce the two
bugs. Change no app code.

For each item below, find the screen(s), components, server actions, export modules, SQL
views/RPCs and table columns involved. Use grep over src/, supabase/migrations/ and
src/lib/supabase/database.types.ts. Note which screen tree is live (the v2 tree under
src/app/(app)/v2/[eventCode] or the older src/app/(staff)/[eventCode]) — check which one
the deployed routes and src/lib/sections/config.tsx actually use, and only report files
from the live tree.

  1. PAX export: every Excel export in src/lib/export/. For each sheet that has a PAX or
     Qty column, write down exactly how that value is computed (which field, per guest row
     or per family row). Find the one that writes 1. Explain the root cause in one
     sentence.
  2. Vehicle planning on the board: find the "plan vehicle" / fleet assignment flow reached
     from the board (dashboard). Reproduce the failure: run it against the local DB or read
     the code path end to end and say exactly where it fails (wrong route, wrong query,
     RLS denial, missing column, wrong event filter, swallowed supabase error — remember
     supabase-js returns {data, error} and does not throw).
  3. Every user-facing occurrence of "Calls" / "Calling" as a section or tab name.
  4. Every counter that says "families called" (or similar), and where its number comes
     from. Say whether "guests called" (sum of the guest count of called families) can be
     computed from data the screen already loads.
  5. The logistics log component and the call log component. Name both files and list the
     visual differences (padding, card vs row, font sizes, borders).
  6. Departures: does the travel/departure table have a notes column? Does arrivals? Does
     the departure form, the departures board and the departures export show notes?
  7. Adults vs children: is there any adults/children/kids/age field anywhere in the schema
     or the Excel import? Where is the family guest count (pax) stored?
  8. Rooms: where room capacity, occupants and the over-capacity override live. Can
     "occupied guests", "guests with a bed" and "guests on an extra bed" be computed from
     what the rooms screen already loads?
  9. Hampers: the current hamper/deliverables tables and screens, whether anything links a
     hamper to a room today, and how the rooms grid (select-then-place) is built so it can
     be reused.

Write docs/CLIENT-FEEDBACK-03OCT.md: one table with columns
item | files | current behaviour | root cause or gap | needs migration (yes/no).
Then a section "Questions for Prince" with anything you could not decide from the code.

Files you may change: docs/CLIENT-FEEDBACK-03OCT.md (new). Nothing else.

Done when: the file exists, every row names real files from the live tree, both bugs have
a stated root cause, and `git status` shows no other change.
```

> **Read F0's report before running F1.** If a bug's root cause turns out to be in the
> database (a view or RLS), F1/F2 will stop and hand it back to you — that is correct.

---

# F1 — Fix PAX showing 1 in the export

```
[PREAMBLE]

TASK: Fix the Excel export so the PAX / Qty column shows the real number of guests, not 1.
docs/CLIENT-FEEDBACK-03OCT.md item 1 has the root cause — read it first.

RULES:
- The family's PAX is the family's guest count. If a sheet has one row per guest, PAX must
  not be summed per row by the client; decide per sheet:
    - one row per family -> PAX = that family's guest count
    - one row per guest  -> keep one row per guest, and the PAX column shows the family's
      count on the family head's row only, blank on member rows (so a SUM in Excel gives
      the true total). Write this rule in DECISIONS.md.
- Hamper / return gift Qty: if Qty was hardcoded to 1, it becomes the quantity actually
  stored for that delivery; if nothing is stored, keep 1 and say so in your report — do NOT
  invent a quantity rule (F8 decides hamper quantity).
- Keep the client's column names exactly (PAX stays PAX). Do not reorder columns.
- Add a vitest in tests/ that builds each affected sheet from a fixture of 3 families
  (pax 4, 2, 1; the first split into 4 guest rows) and asserts the PAX column totals 7.

Read first: docs/CLIENT-FEEDBACK-03OCT.md, the export module(s) it names, the existing
export tests.

Files you may change: the export module(s) named in item 1, one new test file, DECISIONS.md.

Done when: the test passes, an export of the test event opened in Excel shows the right PAX
per family and a correct column total, and no other sheet changed.
```

---

# F2 — Make vehicle planning from the board work

```
[PREAMBLE]

TASK: Fix the vehicle planning flow reached from the board. docs/CLIENT-FEEDBACK-03OCT.md
item 2 has the reproduction and root cause — read it first and fix THAT cause only.

RULES:
- If the cause is a wrong link, fix the href using sectionPath()/sectionHome() from
  src/lib/sections/config.tsx — never a hand-written path.
- If the cause is a swallowed supabase error, surface it: check `error` on every
  supabase-js call in the path and show the user what happened, what to do, and who to ask
  (UX-RULES R6), with the error reference small and last.
- If the cause is in SQL, a view, an RPC or RLS: STOP. Write the fix as a migration, show
  it, and do not apply it.
- Vehicle suggestion by guest count must follow the SRS capacities: Sedan 3, Family SUV 4,
  Tempo Traveller 17–24, Bus 34–56. Suggest, never auto-assign: a human taps to confirm.
- Assigning a vehicle uses the existing optimistic update + rollback.
- Add a vitest for the failing piece (the function, action or query builder that was wrong).

Read first: docs/CLIENT-FEEDBACK-03OCT.md, the files item 2 names.

Files you may change: the files item 2 names, one new test, DECISIONS.md.

Done when: from the board, a staff user can open vehicle planning, see a suggested vehicle
for a family by guest count, assign it, and see it saved after a reload; the test passes.
```

---

# F3 — "Calls" becomes "RSVP", and count guests called

```
[PREAMBLE]

TASK: Two wording changes the client asked for. Display strings and one display count only.

1. Rename the section the user sees as "Calls" (tab label, section strip, page titles,
   headings, empty states, metadata titles) to "RSVP". Use the list in
   docs/CLIENT-FEEDBACK-03OCT.md item 3. Do NOT rename the route segment, the folder, the
   section key in SECTIONS, any table, or call_attempts — only what a person reads.
   If two tabs would now both say "RSVP", STOP and show me both before choosing.
   Check the bottom bar label still fits at 360px without truncating.
2. Wherever the screen shows "families called", also show "guests called" — the sum of the
   guest count of the families that have been called. Layout: "Guests called 312 · 146
   families". Guests is the big number; families is the small one.
   Compute it in TypeScript from the rows the screen already loads. If the screen does not
   already load each family's guest count, STOP and tell me — do not add a database read
   in this prompt.
   Apply the same treatment to "families confirmed / pending" counters on the same screens
   only if their guest totals are already in the loaded data.
3. Update docs/GLOSSARY.md: "Calls (section)" -> "RSVP".

Files you may change: the files listed in items 3 and 4 of docs/CLIENT-FEEDBACK-03OCT.md
(display strings and the count only), the label fields in src/lib/sections/config.tsx,
docs/GLOSSARY.md, DECISIONS.md.

Done when: no screen a staff member or client sees says "Calls" as a section name;
every "families called" counter shows guests called next to it; `git diff` contains no
renamed identifiers; typecheck, tests and lint pass.
```

---

# F4 — Logistics log looks like the call log

```
[PREAMBLE]

TASK: The client does not want the big boxes in the logistics log. Make each logistics log
entry use the same compact row as the call log.

1. Read both components named in docs/CLIENT-FEEDBACK-03OCT.md item 5.
2. If the call log row is a reusable component, use it directly for logistics entries. If
   it is not, extract it into src/components/ui/LogRow.tsx (same markup and classes, no
   visual change to the call log) and use it in both places.
3. A logistics row shows, on at most two lines: time, who, what changed (e.g.
   "Tempo Traveller TT-2 assigned to Mehta family · 6 guests"), and status if any. Same
   padding, font sizes, divider and tap target as a call log row.
4. No information may be lost: anything the big box showed that does not fit two lines
   goes behind a tap on the row, not deleted.
5. Do not change what data is loaded.

Files you may change: the two log components, src/components/ui/LogRow.tsx (new, only if
needed), DECISIONS.md.

Done when: a screenshot of both logs at 390px shows identical row height and styling;
the call log looks exactly as before; typecheck, tests and lint pass.
```

---

# F5 — Departure notes

```
[PREAMBLE]

TASK: Departures need a notes field, the same as arrivals.

1. If docs/CLIENT-FEEDBACK-03OCT.md item 6 says the column is missing: write ONE migration
   adding the notes column to the departure record, matching the arrivals notes column
   exactly (type, nullability, length limit, comment). RLS: same as the rest of the row —
   check the existing policies cover it and say so. Regenerate database types only after
   I say "apply". SHOW THE MIGRATION AND STOP.
   If the column already exists, skip this step and say so.
2. After "apply":
   - Departure form: a notes textarea under the time/mode fields, same component and
     placeholder style as arrivals ("Anything the driver should know").
   - Departures board / list: show the note as one muted line under the row when present.
   - Departures Excel export: a "Notes" column after the last travel column, same position
     as in the arrivals export.
   - Client Road view (if it shows departures): show the note.
   - Offline: the field writes through the same queue as the rest of the departure form.

Files you may change: one new migration, database types (regenerated), the departure form,
departures board/list components, the departures export module, the client Road view
departure block, DECISIONS.md.

Done when: a note typed on a departure survives a reload, shows on the board, appears in the
Excel export, and an event_team user of another event cannot read it.
```

---

# F6 — Guests vs adults

*Only after the client has answered question 1 at the top of this file. Paste their answer
into the prompt where it says CLIENT ANSWER.*

```
[PREAMBLE]

TASK: Let staff record how many of a family's guests are adults and how many are children,
and show both everywhere guest totals appear.

CLIENT ANSWER: a child is anyone aged ___ or under. Children <do / do not> count in the
headline "guests" number.

1. Migration (show it and STOP): on the table that stores the family's guest count, add
   `adults int` and `children int`, both nullable, both >= 0, with a CHECK that when both
   are set, adults + children = the existing guest count. Do not change or rename the
   existing guest count column. Backfill nothing — existing families stay null until staff
   fill them in.
2. After "apply":
   - Family record / RSVP outcome: two steppers (Adults, Children) under the guest count,
     >= 44px buttons. Editing them keeps the guest count in sync. If the guest count is
     changed directly and no longer matches, clear the split and say "Adults/children need
     updating".
   - Counters: wherever a guest total is shown (home, RSVP, rooms, client home), show
     "465 guests · 402 adults · 63 children". Families with no split yet count in guests
     only, and the line says "(split not entered for 12 families)".
   - Excel import: accept optional "Adults" and "Children" columns. If both present and
     they do not add up to PAX, reject that row with a clear reason in the import report.
   - Excel export: "Adults" and "Children" columns right after PAX. PAX itself unchanged.
3. Update docs/GLOSSARY.md: guests = everyone; adults; children.

Files you may change: one new migration, database types (regenerated), the family record /
RSVP outcome components, the counters on the listed screens, the import and export modules,
docs/GLOSSARY.md, DECISIONS.md, tests.

Done when: a family of 5 can be saved as 3 adults + 2 children, totals update everywhere,
an import row with 3 + 1 for PAX 5 is rejected with a reason, and the export has the two new
columns; typecheck, tests and lint pass.
```

---

# F7 — Occupied guests and guests with a bed

*Assumes the client means "got a proper bed vs extra mattress" (question 2 at the top). If
they meant "adults need a bed, small children share", tell the agent that instead.*

```
[PREAMBLE]

TASK: The Rooms screen must answer three questions at a glance: how many guests are in
rooms, how many of them have a bed, and how many are on an extra bed.

DEFINITIONS (put them in docs/GLOSSARY.md):
- Occupied guests = guests currently placed in any room.
- Guests with bed = for each room, min(guests placed, room capacity), summed.
- Extra bed = for each room, max(0, guests placed - room capacity), summed. These are the
  rooms that went through the capacity override.
- Not placed yet = confirmed guests with no room.

BUILD:
1. A summary row at the top of the Rooms screen (and the client Rooms screen if one exists):
   four figures — Occupied guests, With bed, Extra bed, Not placed yet. Each figure is a
   link to the filtered room list (UX-RULES R4). Use the existing stat style; no new design.
2. Each room card shows "3 / 2 beds · 1 extra" when over capacity, "2 / 2 beds" when full,
   "1 / 2 beds" when there is space.
3. Compute everything in TypeScript from the rooms data the screen already loads. Figures
   update immediately on the existing optimistic room moves and roll back with them.
   If capacity or occupants are not in the loaded data, STOP and tell me what is missing.
4. If F6 has landed, add "· N children" under Occupied guests. If it has not, leave it out.

Files you may change: the Rooms screen and its _components, the client Rooms screen (if
present), docs/GLOSSARY.md, DECISIONS.md, tests (a vitest for the four counts from a
fixture with one over-capacity room).

Done when: the four figures are correct on the test event, moving a guest updates them
instantly, undo restores them, and the test passes.
```

---

# F8 — Hampers room-wise, like the Rooms grid

*Biggest change. Only after the client has answered question 3. Run it as two sessions:
F8a (schema, stop) and F8b (screen).*

## F8a — Schema

```
[PREAMBLE]

TASK: Let a hamper be assigned to a room, not only to a family or guest.

CLIENT ANSWER: <one hamper per room / one per guest in the room>. When a family is split
across rooms, <each room gets its own hamper / the family gets one hamper>.

1. Read the current hamper/deliverables tables (docs/CLIENT-FEEDBACK-03OCT.md item 9).
2. Migration (show it and STOP): make the hamper delivery target polymorphic — nullable
   `room_id`, `group_id`, `guest_id`, with a CHECK that exactly one is not null. Existing
   rows keep their current target. Foreign keys scoped to the same event_id (a hamper in
   event A can never point at a room in event B — enforce it with a composite FK or a
   trigger, and say which and why).
   Quantity: a `quantity int not null default 1 check (quantity > 0)`, set by the rule in
   CLIENT ANSWER at assignment time (store it, do not compute it on read — a later room
   move must not change a hamper already delivered).
3. Delivery proofs: when a proof is sealed, snapshot the room_id at that moment on the proof
   row. Proofs stay insert-only (CLAUDE.md §5.2). Do not touch existing proofs.
4. RLS: same as existing deliverables. A client may read hamper status per room for their
   event; never proof photos' storage paths unless they could before.
5. A SQL test under supabase/tests/: cross-event room_id is rejected; two targets set is
   rejected; event_team of event B cannot see event A's room hampers.

Files you may change: one new migration, one new file in supabase/tests/, DECISIONS.md.

Done when: you have shown me the migration and test and STOPPED.
```

## F8b — Screen

```
[PREAMBLE]

TASK: Build hamper allocation room-wise, reusing the Rooms grid pattern
(select-then-place). The F8a migration is applied and types are regenerated.

1. Hamper screen gets a "By room" view, set as default: the same venue switcher, the same
   room cards and layout as the Rooms grid, reusing its components wherever they can take
   props. Do NOT copy-paste the Rooms grid; if a component cannot be reused without
   changing it, STOP and tell me which one.
2. Each room card shows: room number, family name(s) in it, guests in it, and hamper status
   (No hamper / Assigned ×N / Delivered ×N), with the existing StatusPill colours.
3. Select rooms (multi-select like Rooms), choose hamper type, tap "Assign hamper to N rooms".
   Quantity per room follows the stored rule from F8a and is shown before confirming
   ("6 rooms · 6 hampers"). Optimistic update + rollback + Undo for 5 seconds.
4. Delivering from a room card opens the existing delivery-proof flow, which keeps its
   real confirmation ("This cannot be undone") because proofs are insert-only.
5. The existing family-wise hamper view stays available as a second tab ("By family").
6. Excel export: a "Hampers by room" sheet — Hotel, Room, Families, Guests, Hamper type,
   Qty, Status, Delivered by, Delivered at.
7. Client view: room-wise hamper status read-only, no assign or deliver controls.

Files you may change: the hamper screens and their _components, shared Rooms grid
components only if needed for reuse (props added, no behaviour change — prove it with the
existing rooms tests still passing), the hamper export module, the client hamper view,
DECISIONS.md, tests.

Done when: staff can select 3 rooms, assign hampers, undo, re-assign, and deliver one with
a photo; the Rooms grid behaves exactly as before; the export has the new sheet; a client
sees status only.
```

---

# F9 — Verify and hand back to the client

```
[PREAMBLE]

TASK: Prove every item is done and write the note for the client. No app code changes.

1. Re-read docs/CLIENT-FEEDBACK-03OCT.md. For each of the 9 items mark DONE / PARTIAL /
   NOT DONE with the commit hash, and how it was verified (test name, screen checked in
   the browser, or real phone).
2. Run the whole test suite and the build. Report results.
3. Write docs/CLIENT-UPDATE-03OCT.md in plain English (no code words, no "pax" except as
   the Excel column name): one short line per item saying what changed and where to find it
   in the app. Under it, list anything still waiting on the client's answer.
4. List for me the checks that still need a real Android phone (CLAUDE.md §14).

Files you may change: docs/CLIENT-FEEDBACK-03OCT.md, docs/CLIENT-UPDATE-03OCT.md (new),
DECISIONS.md.

Done when: both docs exist and `git status` shows nothing under src/ changed.
```

---

## Running order

| Prompt | What it fixes | Needs migration | Blocked on client |
|---|---|---|---|
| F0 | Map + reproduce the two bugs | No | No |
| F1 | PAX shows 1 in export | No | No |
| F2 | Vehicle planning from board | Only if cause is in SQL | No |
| F3 | Calls → RSVP, guests called | No | No |
| F4 | Logistics log = call log rows | No | No |
| F5 | Departure notes | Probably | No |
| F6 | Adults vs children | Yes | Yes — child age |
| F7 | Occupied / with bed / extra bed | No | Yes — meaning of "with bed" |
| F8a/b | Hampers room-wise | Yes | Yes — quantity rule |
| F9 | Verify + client note | No | No |

F0–F5 can ship this week without waiting on anyone. Send the three questions today so
F6–F8 are not blocked by the time you get there.

**After every session:** review the diff yourself, then open the deployed app on a real
phone. For migrations: read the SQL before saying "apply", and never apply one while a real
event is running.
