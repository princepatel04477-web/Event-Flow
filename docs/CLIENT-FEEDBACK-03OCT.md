# Client feedback — 3 October 2026 — code map (F0)

Read-only investigation. Nothing in `src/`, `supabase/` or the database was changed.
Every row below was checked against the code with `grep` and a direct read.

## Which tree is live

The app ships **two screen trees** selected at build time by `NEXT_PUBLIC_UI`
(`src/lib/ui-version.ts`): `v2` is `src/app/(app)/v2/[eventCode]/**`, `v1` is
`src/app/(staff)/[eventCode]/**`. The deployed/production app is built with
`NEXT_PUBLIC_UI=v2` (stated in `EventFlow-CommandCode-Prompt-25-09-26.md` and
`REPORT-25sep.md`; the proxy `src/proxy.ts` rewrites every event-scoped URL onto
the `/v2` tree only when the flag is `v2`).

**Consequence for every row below:** the live screens are under
`src/app/(app)/v2/[eventCode]/`, but several v2 routes are thin re-exports of v1
`(staff)` components, and all business logic / export / import / server actions
live in shared `src/lib/**` and `supabase/**`. Where a live v2 screen re-exports a
v1 file, both paths are given; the re-export is the live entry point.

## Map

| item | files | current behaviour | root cause or gap | needs migration |
|---|---|---|---|---|
| **1 — PAX / Qty shows 1 in an export** | `src/lib/export/definitions.ts:154` (Deliverables `Qty`), `:74,107` (Guest Master `Pax`, Family Heads `Expected pax`), `:214,237` (Arrivals/Departures `Pax`); `src/lib/export/sheets.ts:226,276,352,493,530`; `src/lib/actions/deliveries.ts:110,127`; `src/app/(app)/v2/[eventCode]/logistics/sheets/DriverSheetsBoard.tsx:99`; `src/lib/actions/departures.ts:391`; `src/lib/actions/logistics.ts:115`; `src/lib/import/contactsSheet.ts:755` | The workbook has **two separate "1" defects**, not one. (a) **Deliverables sheet `Qty`** reads `deliverables.quantity`, and every deliverable is inserted with a hardcoded `quantity: 1` — so `Qty` is 1 on every hamper/return-gift row. (b) The only column literally headed **`PAX`** is the Driver-sheets export; it reads `trip_passengers.pax`, written by `commitTrips` from the leg's `paxOnLeg`, which is `pax_on_leg ?? 1` — so a leg with no per-leg pax exports **1**. (c) Guest Master `Pax` / Family Heads `Expected pax` read `guest_groups.expected_pax`, which the import sets to **1** for every family when the source sheet has no PAX column. | (a) **Root cause: `generateDeliverables` hardcodes `quantity: 1`** (`src/lib/actions/deliveries.ts:110` and `:127`), and `buildDeliverableRows` exports it verbatim (`sheets.ts:352`). (b) Root cause: `paxOnLeg: (leg.pax_on_leg as number) ?? 1` (`logistics.ts:115`) silently treats a missing leg headcount as one person. (c) Root cause: `const expectedPax = paxParsed ?? 1` (`contactsSheet.ts:755`) — the import default, not the export. | No |
| **2 — vehicle planning from the board** | board: `src/app/(app)/v2/[eventCode]/logistics/_components/TravelBoard.tsx:536-537` (button "Plan vehicles for this board"); target: `src/app/(app)/v2/[eventCode]/logistics/trips/page.tsx` → `src/app/(staff)/[eventCode]/logistics/LogisticsClient.tsx`; `src/lib/actions/logistics.ts:75-141` (`readUnplacedTravelLegs`, `readAvailableVehicles`) | The route and href are correct (the proxy rewrites `/{event}/logistics/trips`; the page exists). The failure is **silent**: the read actions destructure only `data` and **discard `error`**, so any query failure returns `[]` — indistinguishable from "no rows". The screen then shows its silent dead-end empty state ("No vehicles in the fleet…" / "No … legs need transport right now.") with no error and no recovery action. | **Root cause: swallowed supabase-js errors.** `readUnplacedTravelLegs` ignores `.error` at `logistics.ts:81` and `:93`; `readAvailableVehicles` at `:127`; `commitTrips` at `:293,303`. A second concrete bug: after commit, `LogisticsClient.tsx:362` links to `/${eventId}/logistics/fleet` using the **event UUID, not the event code** → 404 (the correct form is used at `:190`). | No |
| **3 — rename "Calls" section to "RSVP"** | live tab label: `src/lib/sections/v3.ts:70` (`rsvp: 'Calls'`); `src/lib/sections/config.tsx:124` (`label: 'RSVP calls', tabLabel: 'Calls'`); `src/app/(app)/v2/[eventCode]/_components/SectionSwitch.tsx:77` (`aria-label` = "Calls screens"); `src/app/(app)/v2/[eventCode]/rsvp/queue/page.tsx:10` (`metadata.title = 'Calls'`); `src/app/(app)/v2/[eventCode]/help/HelpScreen.tsx:25` (`Calls: …`); `src/app/(app)/v2/[eventCode]/families/[groupId]/page.tsx:307` (card heading "Calls") | The bottom-bar tab a user reads is **"Calls"** (from `v3.ts`), the desktop sidebar/section-strip name is "Calls" (from `config.tsx`), the queue screen's browser title is "Calls", the help list is keyed "Calls", and the family page has a card headed "Calls". | Gap: pure copy change. **Must not change** the section id (`rsvp`), the route segment `/rsvp`, or any key compared with `===`. Child tab labels `Call list` / `Call notes` / `Auto-call` (`config.tsx:135-137`) contain "Call" but are ordinary job words — **ambiguous whether the client wants them too** (see Questions). | No |
| **4 — "guests called" next to "families called"** | `src/app/(app)/v2/[eventCode]/rsvp/queue/CallNext.tsx:463-469` ("Families called" bar; data from `fetchQueue()` `select('*')` on `v_rsvp_queue`, rows carry `expected_pax`/`confirmed_pax`); `src/app/(app)/v2/[eventCode]/_home/today.ts:244` ("Families called" bar from `TodayNumbers`, aggregates only) | Queue screen: the counter counts families; each row already loads the family's guest count, so **guests-called = Σ `(confirmed_pax ?? expected_pax ?? 0)` over called rows is computable in TypeScript with no new DB read**. Today screen: the same counter comes from aggregate totals (`totalGroups`, `rsvpPending`) and per-family pax is **not** retained — guests-called is **not** derivable there without a new aggregate column/read. | Gap on the queue screen: add the sum in TS. Gap on Today: needs either an extra aggregate on `v_event_board` or a new read — F3 must stop and ask rather than add one silently. "Confirmed/pending" counters live in `today.ts:272-277` and are family counts with no per-family guest total retained. | No |
| **5 — logistics log rows like the call log** | call log: `src/app/(staff)/[eventCode]/rsvp/status/[groupId]/RsvpLogForm.tsx` (`PreviousAttempts`, ~L664-712) using `src/components/ui/Row.tsx`; served under v2 by the re-export `src/app/(app)/v2/[eventCode]/rsvp/status/[groupId]/page.tsx`. Logistics big boxes: `src/app/(staff)/[eventCode]/logistics/LogisticsClient.tsx` (one `Card`/`CardBody` per trip; mounted by v2 `logistics/trips/page.tsx`); v1 `.../logistics/arrivals/ArrivalsClient.tsx` (`ArrivalRowCard`, `p-3.5` box) and `.../logistics/departures/DeparturesBoard.tsx:350` | The call log is a compact two-line `Row` inside one bordered list. Logistics lists still render one padded, multi-line box per entry (trip planner `Card`, v1 arrival/departure cards). The v2 arrivals/departures board (`TravelBoard.tsx`) already uses compact `Row`s; the **trip planner is the remaining big-box logistics list under v2**. | Gap: no literal component is named "logistics log". The client's "bigger box" matches the trip-planner `Card` (v2) and/or the v1 arrival/departure cards. Confirm which list before changing. | No |
| **6 — departure notes** | `supabase/migrations/20260731000200_guests_rsvp.sql:93` (`travel_legs.notes text`); `src/lib/supabase/database.types.ts:2485`; departure form `src/app/(app)/v2/[eventCode]/logistics/departures/new/page.tsx` → `src/app/(staff)/[eventCode]/logistics/departures/DeparturesClient.tsx` and `src/lib/actions/departures.ts:200-209` (`saveDeparture`); departure board `.../logistics/departures/page.tsx` → `TravelBoard.tsx`; departure export `src/lib/export/definitions.ts:230-247` + `sheets.ts:520-551` | **The `notes` column already exists** on `travel_legs` (`text`, nullable, no length limit, no column comment) and is shared by arrival and departure rows (one table, `direction` discriminates). **No code reads or writes it.** `saveDeparture` never sets it; the only "notes" a user sees on the arrival side is the RSVP form's Notes box, which writes `guest_groups.remarks`, not a travel leg. | Gap: UI + export only. No schema change is required — the prompt's "probably a migration" is not needed. Decide whether departure notes should use the existing per-leg `travel_legs.notes` or the family-level `guest_groups.remarks` the arrival form already uses. | **No** |
| **7 — guests vs adults** | `supabase/migrations/20260806100000_rsvp_logging.sql:27-28` (`guest_groups.adults_confirmed`, `children_confirmed`, both `integer check (>=0)`, nullable); trigger `app.sync_confirmed_pax()` (`:52-71`) derives `confirmed_pax`; `app.age_band` enum + `guests.age_band` (`20260731000100_foundation.sql:52-53`, `20260731000200_guests_rsvp.sql:59`); `guest_groups.expected_pax` / `confirmed_pax` (`20260731000200_guests_rsvp.sql:19-20`); export `definitions.ts:105-107`; import `src/lib/import/contactsSheet.ts:222,755`, `src/lib/import/layout.ts:35-63` | **An adults/children split already exists — for the *confirmed* (post-call) headcount only.** The RSVP capture form edits `Adults`/`Kids` steppers (`.../rsvp/queue/InlineCaptureStep.tsx`), `save_rsvp_log` stores them, and the Family Heads export already emits `Adults`/`Children` beside `Expected pax`. The **expected/invited** headcount is a single integer (`expected_pax`) with no breakdown; the import reads only one `pax` column (with `'adults'` as an *alias* for pax) and never sets `guests.age_band`. | Gap: the **confirmed** split needs no migration — it exists and only needs surfacing in more counters/UI. An **expected/invited** split (and import columns for it) **does** need a migration. F6's premise ("add `adults`/`children` … with a CHECK that adults+children = the existing guest count") maps onto the already-existing confirmed pair, not a new one. | **Conditional — No for the confirmed split; Yes for an expected split / import columns** |
| **8 — occupied guests / guests with a bed / extra bed** | `src/app/(app)/v2/[eventCode]/hospitality/rooms/page.tsx` + `RoomsBoard.tsx`; data `src/lib/actions/rooms.ts:423-609` (`readRoomsGrid` → `RoomGridRow {capacity, maxCapacity, occupants[], freeBeds, isOverCapacity}` + `RoomsBoardTotals {confirmedGuests, guestsWithBed, bedsFree, familiesWaiting}` + `unplaced[]`); schema `rooms.capacity` (`20260731000300_rooms_deliverables.sql:25`), `rooms.max_capacity` (`20260805140000_room_allocation.sql:31-47`), `room_assignments.is_override`/`override_reason` (`.sql:59-60,71`); stat `src/components/ui/Progress.tsx`; optimistic move `RoomsBoard.tsx:205-252` | The board already loads, per room, its `capacity`, `maxCapacity` and active `occupants[]`, plus event totals and the unplaced list. So all four figures are computable in TypeScript with **no new query**: Occupied = `Σ occupants.length`; With bed = `Σ min(placed, capacity)`; Extra bed = `Σ max(0, placed − capacity)`; Not placed = `totals.confirmedGuests − withBed` (or `unplaced.length`). | Gap: display only. Note `totals.guestsWithBed` (`rooms.ts:601`) counts **all** confirmed active assignments and does **not** clamp at `capacity`, so it differs from the requested "with a real bed" exactly on over-capacity rooms. There is **no client-facing Rooms screen**. | No |
| **9 — hampers room-wise** | tables `deliverables` (`room_id` already exists — `20260731000300_rooms_deliverables.sql:133`, FK to `rooms(id,event_id)` `:146`, index `:150`; unique `deliverables_one_per_group_kind` on `(group_id, kind) WHERE guest_id IS NULL` `:151-152`), `delivery_proofs` (`:161-179`, insert-only, keyed by `deliverable_id`), `room_assignments` (`:47-72`); auto-hamper trigger `supabase/migrations/20260924140100_auto_hamper_on_room.sql:4-29`; screens `src/app/(app)/v2/[eventCode]/hamper/page.tsx`, `.../hospitality/deliveries/HamperRun.tsx`, `.../hamper/[deliverableId]/page.tsx`; grid to reuse `.../hospitality/rooms/RoomsBoard.tsx` + `_components/PlaceFamilySheet.tsx` / `RoomSheet.tsx`; actions `src/lib/actions/deliveries.ts`, `rooms.ts` | **A hamper is already linked to a room**: `deliverables.room_id` exists and a trigger auto-creates/updates a hamper carrying the room on every room assignment. But the unique index `(group_id, kind) WHERE guest_id IS NULL` enforces **exactly one hamper per family**, and `room_id` stores only the family's latest room ("one hamper per family, not per room"). The Rooms grid is a reusable pattern: orchestrator `RoomsBoard`, cards + `PlaceFamilySheet`/`RoomSheet`, writes through `useOptimisticAction` with `deferUntilCommit` + undo. | Gap: storing/reusing `room_id` needs no migration, but a **genuinely room-wise** allocation (a family split across two rooms getting two hampers) needs a changed uniqueness model → migration. Whether hampers are per-room-total or per-guest is the client's unanswered question. | **Conditional — No to store room_id; Yes for true per-room hampers** |

## Questions for Prince

Answers I could not decide from the code. The first three are the ones the series
already flags; the rest are new and each one is a guess that would cost a migration
or an unwanted UI change.

1. **Which export sheet is "pax … one Qty only"?** I found three separate places a
   `1` reaches a spreadsheet, and they need different fixes:
   - Deliverables sheet **`Qty`** — literally always 1 (`quantity: 1` at generation).
   - Driver-sheets sheet **`PAX`** — 1 whenever a travel leg has no `pax_on_leg`.
   - Guest Master **`Pax`** / Family Heads **`Expected pax`** — 1 for every family when
     the guest list was imported from a sheet with no PAX column.
   Which file/sheet was the client looking at? A screenshot settles it.

2. **Child age and whether children count in "guests"** (F6). Also: the confirmed
   adults/children split **already exists**. Does the client want it extended to the
   *expected/invited* count (a real migration), or only surfaced?) 

3. **"Guest with bed"** (F7): `min(guests placed, room capacity)` (got a real bed; the
   rest are on an extra mattress), or "adults need a bed, small children share"?

4. **Hamper quantity rule** (F8): one hamper **per room** or **per guest in the room**?
   When a family is split across two rooms, does **each room** get its own hamper?

5. **Departure notes** (F5): the `travel_legs.notes` column already exists but is unused.
   Should the departure note live on the travel leg (per departure) or reuse the
   family-level note (`guest_groups.remarks`) that the arrival/RSVP form already writes?

6. **Which list is "the logistics log"** (F4)? The trip planner's per-trip card (the only
   big-box logistics list left under v2), or the v1 arrival/departure cards?

7. **Scope of the "Calls" rename** (F3): are the child tabs **"Call list"**, **"Call notes"**
   and **"Auto-call"** to be renamed too, and is the **"Calls" heading on the family page**
   (`families/[groupId]/page.tsx:307`) in scope?

8. **Today's "Families called" bar** (F3.2) is aggregate-only — the per-family guest counts
   are not loaded there, so "guests called" needs a new aggregate column on `v_event_board`
   or a new read. May I add that, or should Today keep the families-only wording?

## Status — 3 October 2026

| # | Item | Prompt | Commit | Status | Verified by |
|---|---|---|---|---|---|
| 1 | PAX / Qty export | F1 | `8708668` | **DONE** | `tests/export-pax.test.ts` (5); full suite |
| 2 | Vehicle planning from the board | F2 | `cf8ac9c` | **DONE** | `tests/vehicle-planning.test.ts` (6) |
| 3 | "Calls" → "RSVP" | F3 | `dc98ecc` | **DONE** | `nav-model.test.ts`, `v3-nav.test.ts`; needs a handset for the 360px label |
| 4 | "Guests called" counter | F3 | `dc98ecc` | **PARTIAL** | Queue screen done (rows already loaded); **Today blocked** — its `TodayNumbers` is aggregate-only, no per-family pax, so it needs a new count (F3 says stop, not add a read) |
| 5 | Logistics log rows | F4 | `5ef5776` | **DONE** (assumption) | typecheck + tests; row height is structural (same `Row`) — needs a handset screenshot |
| 6 | Departure notes | F5 | `93feef7` | **DONE** | no migration — `travel_legs.notes` already existed |
| 7 | Guests vs adults | F6 | `60b68b1` | **NOT DONE** | migration written, **NOT applied**; UI/import/export/counters gated on "apply" |
| 8 | Occupied / with bed / extra bed / not placed | F7 | `0de4381` | **DONE** | `tests/rooms-board.test.ts` (4 new); needs a handset pass |
| 9 | Hampers room-wise | F8a | `93fc65c` | **PARTIAL** | migration + `supabase/tests/f8_hamper_room.sql` written, **NOT applied**; F8b screen blocked on apply |

**Suite:** 843 tests, 70 files, all passing. **Build:** `NEXT_PUBLIC_UI=v2 npm run build` exit 0.

**Not applied (awaiting your "apply"):** `20261003090000_guest_groups_expected_split.sql`
(F6) and `20261003091000_deliverables_room_target.sql` (F8a). Nothing was pushed
to any database. **F8a must be applied together with F8b**, or it breaks
`generateDeliverables` (see DECISIONS).

## Done check (as of F0 — the read-only mapping)

- `docs/CLIENT-FEEDBACK-03OCT.md` (this file) exists.
- Every row names real files from the live tree (or its v1 origin where the v2 route re-exports it).
- Both bugs have a stated root cause (item 1 and item 2 above).
- When F0 ran, no app code, migration or database was changed. Later prompts
  (F1–F8a) changed app code and added two unapplied migrations — see the Status
  table above.
