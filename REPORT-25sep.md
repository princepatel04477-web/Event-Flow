# REPORT — EventFlow task set of 25-09-26

Branch: `brain/cc-25sep` (worktree `C:\dev\ef-cc`), based on `origin/brain/showcase`
(`d9bc4f0`). One commit per task, in task order. **A12 was deliberately not
attempted** (per instruction).

Every task below passed all three gates **after that task's commit**:

- `npx tsc --noEmit`
- `npx vitest run` — **60 files, 777 tests, all passing**
- `NEXT_PUBLIC_UI=v2 npm run build`

No migration was applied to any database. Every DB change is a new timestamped
file under `supabase/migrations/`, listed at the end.

---

## Per task

### A1 · Calling status + RSVP filters — DONE
Carried over from the prior `ef-t1` worktree (uncommitted WIP), then verified.
- **Files:** `src/lib/rsvp-queue.ts` (new), `rsvp/queue/CallNext.tsx`,
  `CurrentFamilyCard.tsx`, `FamilyQueueSheet.tsx`, `types.ts`; `tests/rsvp-queue.test.ts` (new).
- One outcome→status table: Coming=confirmed, Not coming=declined, No answer=unreachable,
  Maybe=tentative, Call back=callback (+callback_at). Filters To call / Coming / Not coming /
  No answer / Call back / All, each with a count (`filterCounts`).
- **Verified:** tsc/vitest/build green. `tests/rsvp-queue.test.ts` pins both mappings.

### A2 · Import = export format — DONE
Carried over from `ef-t2` (commit `e945074`), verified.
- **Files:** `lib/import/knownSheet.ts`, `parse.ts`, `layout.ts`, `contactsSheet.ts`,
  `guests/import/_components/UploadStep.tsx`, new `lib/export/template.ts`,
  `tests/import-roundtrip.test.ts` (300 lines).
- Case/space-insensitive headers with aliases; old layout auto-detected; export→import round-trip test.

### A3 · Renames + Today cleanup — DONE
Carried over from `ef-t3` (commit `56cd528`), verified.
- "Travel"→"Logistics", "Rooms"→"Hospitality" across `departments.ts`,
  `sections/config.tsx`, `sections/v3.ts`, headings/help; Today/admin arrival+departure tiles removed. Tests updated.

### A4 · Room creation by quantity — DONE
Carried over from `ef-t4` WIP, verified.
- **New:** `supabase/migrations/20260925120000_rooms_room_type_bulk_create.sql` (room_type CHECK + backfill + index; `create_rooms_bulk` RPC, one transaction, skips existing, ≤500),
  `src/lib/rooms/room-type.ts`. **UI:** `RoomCreateForm.tsx`, `RoomsBoard.tsx`, `RoomSheet.tsx`,
  `PlaceFamilySheet.tsx`, `actions/hotels.ts`, `database.types.ts`.

### A5 · Room view — DONE
- **New:** `src/lib/rooms/filters.ts`, `src/lib/rooms/venue.ts`, `tests/rooms-filters.test.ts`.
- One **"Filter · n"** bottom sheet in `RoomsBoard.tsx`: Type (multi), Venue (single), Status
  (Empty/Partly filled/Full), **facet counts on every chip**. Occupancy colour EMPTY green /
  PARTLY amber / FULL red, a **"2/3 beds"** line and a legend. A device-remembered venue selector
  (`localStorage` inside try/catch, keyed per event).

### A6 · Rooming list + clickable everything — DONE
Carried over from `ef-t6` WIP, verified; **plus a fix** the WIP had missed.
- **New:** `hospitality/rooming-list/` (page, `RoomingList.tsx`, `RoomingRoomSheet.tsx`),
  `lib/rooms/rooming-list.ts`, `lib/actions/rooming-list.ts`, `lib/export/rooming-list.ts`,
  `tests/rooming-list.test.ts`; `HamperRun.tsx`, `RoomsBoard.tsx`, `query/keys.ts`, `sections/config.tsx`.
- **Fix (`52c7b55`):** the new `hospitality/rooming-list` route had to be registered in
  `tests/v2-route-parity.test.ts`'s genuinely-new allowlist, or the parity suite fails. This was
  the only breakage in the carried-over WIP.

### A7 · Admin view — DONE
- **New migrations:** `20260925130000_event_rsvp_buckets.sql` (`v_event_rsvp_buckets`,
  `security_invoker`), `20260925140000_create_event_with_defaults.sql` (one-transaction event+codes RPC).
- **New:** `src/lib/rsvp-buckets.ts`, `admin/.../[eventCode]/ConfirmationTabs.tsx`.
- Dashboard now leads with **Guests (PAX)** = `coalesce(confirmed_pax, expected_pax)`, with
  **No. of families** beside it, and adds the tabs Confirmed · Not coming · Maybe · No answer ·
  Not called, each with **pax + family count + list**.
- Event creation: `createEvent` now hashes the codes then calls **one RPC** (was two sequential
  inserts) and the form **prefetches the destination** (`router.prefetch`). `phaseTiming` marks
  `imports` / `codes` / `rpc`.
- **Timing before/after:** structurally 2 round-trips → 1. **No live number is claimed** — the
  migration is not applied and no event was created against a live DB, so the `[perf] event ::
  createEvent phases :: …` line has not been observed yet. Run one create after the migration is
  applied and read that log line for the real figure.

### A8 · RSVP role + section locking — DONE
- **New migrations:** `20260925150000_staff_department_rsvp.sql` (adds `rsvp` to
  `app.staff_department`), `20260925160000_event_section_locks.sql` (`event_section_locks` table +
  RLS + **`app.enforce_section_lock()` BEFORE trigger on 11 section tables** — INSERT/UPDATE/DELETE).
- **New:** `src/lib/section-locks.ts`, `src/lib/actions/section-locks.ts`,
  `src/components/LockedSectionBanner.tsx`, `admin/.../[eventCode]/settings/{page,SectionLockSettings}.tsx`;
  `departments.ts`, `today.ts`, `database.types.ts`, `AdminSidebar.tsx` (Settings nav), v2 shell
  (banner mount).
- Department `rsvp` = label "RSVP / Calls", sections dashboard+rsvp, home `/{event}/rsvp/queue`;
  the add-staff and pick-staff screens iterate `STAFF_DEPARTMENTS`, so they pick it up with no edit.
- **Locking is enforced in the DATABASE**, not the UI: a non-admin write to a locked section is
  refused by the trigger (errcode `42501`). Admins bypass. Staff get a "Locked by admin" banner.
- **Test:** `tests/section-locks.test.ts` — a write to a locked section is refused (DB-backed;
  self-skips when the migration is not applied, per the repo's convention).

### A9 · Arrival notifications — DONE (banner + switch; push inert without keys)
- **New migration:** `20260925170000_event_notification_settings.sql` (per-event `arrivals_enabled`,
  default true, staff-read / admin-write).
- **New:** `src/lib/arrivals/banner.ts`, `src/lib/actions/arrivals.ts`, `src/components/ArrivalBanner.tsx`,
  `admin/.../settings/NotificationSettings.tsx`; mounted in the v2 shell.
- Banner shows **"N families arriving in the next 60 min"** or **"<Family> family arrived · Room 705"**
  on **Today and Logistics**, updates live via **Supabase Realtime on `travel_legs`** plus a 60s tick,
  and taps through to arrivals. Admin on/off switch in Settings.
- **Push:** the brief says "if push isn't configured, silently use the banner only." No FCM/APNs keys
  are configured, so push is **banner-only** as permitted. Wiring Capacitor Push/FCM is the follow-up
  once keys exist.

### A10 · Web portal — DONE
Carried over from `ef-t10` WIP, verified.
- **New:** `_components/AppSidebar.tsx`, `src/lib/sections/sidebar.ts`, `tests/sidebar-model.test.ts`;
  `layout.tsx`, `AppTabs.tsx`. Desktop (≥1024px) sidebar; mobile unchanged (lg-only).

### A11 · Files area — DONE (see caveats)
- **New migration:** `20260925180000_export_files.sql` (`export_files` history table, RLS by event;
  private `eventflow-exports` bucket + event-fenced storage policies).
- **New:** `src/lib/files/kinds.ts`, `src/lib/files/storage.ts` (`StorageAdapter` interface +
  Supabase implementation — R2 drops in here), `src/lib/actions/files.ts`,
  `admin/.../[eventCode]/files/{page,FilesClient}.tsx`, `tests/export-kinds.test.ts`;
  `AdminSidebar.tsx` (Files nav).
- Generates Guest list, RSVP status, Rooming list, Hampers, Arrivals, Departures and a Full event
  backup (.xlsx), plus **CSV** for single-sheet kinds; stores privately; records history;
  re-download via a **1-hour signed URL**.
- **Caveats:** the **Fleet/driver sheet is not implemented** — there is no fleet data in the export
  read (`readExportData`) to build it from. CSV writes the workbook's **first sheet only**. Hampers
  export uses the existing Deliverables sheet; it does **not** yet inline proof URLs.

### A12 · Cloudflare deployment — NOT DONE (per instruction)

---

## New migration files (in order, NOT applied)

1. `20260925120000_rooms_room_type_bulk_create.sql` (A4)
2. `20260925130000_event_rsvp_buckets.sql` (A7)
3. `20260925140000_create_event_with_defaults.sql` (A7)
4. `20260925150000_staff_department_rsvp.sql` (A8)
5. `20260925160000_event_section_locks.sql` (A8)
6. `20260925170000_event_notification_settings.sql` (A9)
7. `20260925180000_export_files.sql` (A11)

## Test counts

- Final: **60 files / 777 tests passing.**
- New files added by this work: `rsvp-queue`, `rooms-filters`, `arrival-banner`, `export-kinds`
  (plus the carried-over `import-roundtrip`, `rooming-list`).
- Update required by A8: `tests/find-family-link.test.ts` (the RSVP section now admits `rsvp` too).

## What Prince must do

1. **Review + apply the 7 migrations** above to the Supabase project (in order). This branch writes
   them and does not apply them.
2. **A9 push:** provide Capacitor Push/FCM keys via env; until then arrivals are banner-only.
3. **A11 storage:** the migration creates the `eventflow-exports` bucket and policies; no manual bucket.
4. **A12 (deferred):** Cloudflare API token, a custom domain, and a **new Supabase project in
   ap-south-1 (Mumbai)** — a region can't be changed in place, so it needs a dump/restore.
5. Note: this worktree needed the developer's gitignored `.env.local` / `.env.test` copied in for the
   test/build gates (they were absent from a fresh worktree).

## Screen checklist to test on the phone

- **Calls:** log each of the five outcomes; the family's status chip updates and the count under each
  filter changes; every chip fits at 390px.
- **Import:** download the template; re-import an untouched export → 0 errors, same families.
- **Today / Hospitality:** labels read "Logistics" and "Hospitality"; no Arrival/Departure tiles.
- **Rooms:** create 10 rooms by quantity with live preview; "Filter · n" sheet (type/venue/status +
  counts); occupancy colours; "2/3 beds"; venue remembered after a reload.
- **Rooming list:** sort by hotel then room; search a name or room; export.
- **Admin:** dashboard shows Guests (PAX) + No. of families; the five confirmation tabs; create an
  event and feel the destination open.
- **RSVP role + locks:** add an `rsvp` staff member; lock Hospitality in Settings; as staff, the
  banner appears and a write is refused.
- **Arrivals:** mark an arrival on one phone, watch the banner update on another within a minute.
- **Files:** generate each export; re-download from history; confirm the link expires.
