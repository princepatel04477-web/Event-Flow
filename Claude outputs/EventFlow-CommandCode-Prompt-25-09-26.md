You are working on EventFlow (Nuvent), a wedding/event operations app. Repo: C:\dev\EventFlow
(GitHub princepatel04477-web/Event-Flow). Production code is on branch `brain/showcase`.

## Setup
1. `git fetch origin`. Create a worktree: `git worktree add C:\dev\ef-cc -b brain/cc-25sep origin/brain/showcase`.
   `cd C:\dev\ef-cc`, then `npm ci`. Never junction node_modules.
2. Stack: Next.js 16.2 (App Router, `src/proxy.ts`), React 19, TypeScript strict, Tailwind v4 tokens (`--ef-*`),
   TanStack Query, Dexie, Supabase Postgres (RLS, RPCs, triggers, Realtime). The v2 UI is baked at build time
   with `NEXT_PUBLIC_UI=v2`. Screens are in `src/app/(app)/v2/[eventCode]/**`. Older screens are in
   `src/app/(staff)/[eventCode]/**` and some are re-exported from there.

## Rules (all tasks)
- No `any` types, no `console.log` in production code, no stubs or TODOs. Every feature must work end to end.
- Every DB change is a new timestamped file in `supabase/migrations/`. Do NOT apply migrations to the live
  database. Write them, and list them in the final report.
- Don't edit `next.config.ts` and don't add test shims to get around your sandbox.
- Mobile first: at 390×844 nothing overflows, tap targets are ≥44px, and the fixed tab bar never covers content.
- Every write is optimistic, with rollback. Target: tap to visible change ≤120 ms.
- Rename labels only. Never rename routes, DB values, or department ids.
- Work the tasks IN ORDER. After EACH task run `npx tsc --noEmit`, `npx vitest run`, and
  `NEXT_PUBLIC_UI=v2 npm run build`. All must pass. Then commit with the message `feat(<task-id>): …`, one task
  per commit. If a task is blocked, write why in the report and move on.

## Tasks

**A1 · Calling status + RSVP filters.** Calling status does not update after a call outcome, and the
Coming / Not coming / No answer filters don't work.
Trace one outcome end to end: `rsvp/queue/CallNext.tsx` (filteredRows, logOutcomeDirectly, handleSaveInline)
→ the call_attempts insert and the guest_groups.rsvp_status update → query invalidation → UI.
Each outcome must write a definite status: Coming=confirmed, Not coming=declined, No answer=unreachable,
Maybe=tentative, Call back=callback (+callback_at).
Filters: To call=not_started|attempted|null; Coming=confirmed|tentative; Not coming=declined;
No answer=unreachable|attempted; Call back=callback or next_callback_at; All. Show a count on every chip and fit
them at 390px.
Reference only: branch `brain/fix-server` has migrations 20260924000100–000600 (v_rsvp_queue callback coalesce,
update_message_status) that may be relevant. Add vitest coverage for both mappings.

**A2 · Import = export format.** Importing fails with a format mismatch. Make the importer accept exactly the
columns the app's guest export produces (`src/lib/export/definitions.ts`). Match headers case- and
space-insensitively, with aliases (Name/Head name, Mobile/Phone, Pax/Guests, Side, City, RSVP), and keep the old
layout working (auto-detect). A missing column shows a plain message naming the column. Add a "Download
template" button that gives the export file. Add a round-trip vitest: export → import → 0 errors, same families.

**A3 · Renames + Today cleanup.** Rename the visible label "Travel" to "Logistics" and "Rooms" to "Hospitality"
everywhere: `src/lib/sections/config.tsx`, `src/lib/departments.ts` DEPARTMENT_LABELS, titles, headings,
help text. Remove the "Arrival today" and "Departure today" tiles from the Today and admin screens. Update the
tests.

**A4 · Room creation by quantity.** Migration: add `rooms.room_type` with a check constraint over
suite|standard|deluxe|king|queen, backfill 'standard', and index (event_id, room_type).
RPC `create_rooms_bulk(event, hotel, type, qty, start_number, prefix, capacity, max_capacity)`: one transaction,
skips existing numbers, returns {created, skipped}, qty ≤500.
UI in `hospitality/rooms/new/**`: Type, Quantity, Starting number, optional Prefix, and Capacity (defaults from
the type). Live preview "Creates 10 Deluxe rooms: 701–710". One Save.
Show the room type on every room card/row (RoomsBoard, RoomSheet, PlaceFamilySheet).

**A5 · Room view.** In `hospitality/rooms/RoomsBoard.tsx` add one "Filter · n" bottom sheet with:
- Type chips Suite/Standard/Deluxe/King/Queen (multi-select);
- Hotel/Venue;
- Status Empty/Partly filled/Full;
- counts on every chip.
Occupancy colour: EMPTY green, PARTLY FILLED yellow/amber, FULL red (ledger tokens). Also show "2/3 beds" and a
small legend.
Add a Venue selector at the top of the rooms/people view, remembered per device (localStorage inside try/catch).

**A6 · Rooming list + clickable everything.** Admin → Hospitality → "Rooming list": a table of Hotel, Room,
Type, Family head, Pax, Guest names, Check-in status, Hamper status. Sorted by hotel then room, searchable by
name or room, with an Excel export via the existing helpers.
Every item in Hospitality must open something: room → room sheet, family → detail, count tile → the filtered
list.
Hampers: every row, pending and delivered (`hospitality/deliveries/HamperRun.tsx`), opens the hamper detail
with its proof photo.

**A7 · Admin view.** The dashboard counts PAX (confirmed_pax, falling back to expected_pax), not groups, and
shows "No. of families" beside it.
Add confirmation tabs: Confirmed · Not coming · Maybe · No answer · Not called, each with pax + family count +
list.
Event creation is slow: time each step with the existing `phaseTiming` helper, collapse the inserts into one
RPC `create_event_with_defaults`, and prefetch the destination. Target ≤1.5 s. Put before/after numbers in the
report.

**A8 · RSVP role + section locking.** Add department `rsvp` (label "RSVP / Calls", sections dashboard+rsvp,
home = call queue) in `src/lib/departments.ts`, a migration allowing it on staff_members, and the add-staff and
pick-staff screens.
Section locking: admin locks a section per event (rsvp, hospitality, hamper, logistics) via a new
`event_section_locks` table. Locked means read-only for staff, enforced in the DB (RLS/RPC checks), not just
the UI. Staff see a "Locked by admin" banner. The toggle goes in admin Settings. Add a test that a staff write is
rejected while locked.

**A9 · Arrival notifications.** A clear in-app banner on the Logistics tab and Today: "3 arriving in the next
60 min", "Sharma family arrived · Room 705". It updates live via Supabase Realtime on travel_legs and arrival
marks, and tapping opens arrivals.
Push (Capacitor Push/FCM, keys from env) for "arriving in 30 min" and "arrived", sent to that event's logistics
+ hospitality staff. If push isn't configured, silently use the banner only.
Admin on/off setting.

**A10 · Web portal.** At ≥1024px use a desktop layout:
- a left sidebar (Today, Calls, Hospitality, Hampers, Logistics, Guests, Files, Settings);
- a wide content area, tables instead of cards, and a right-side detail panel instead of bottom sheets;
- keyboard + mouse support.
Same components, responsive only. Mobile (<768px) must be unchanged.

**A11 · Files area.** A "Files" section (admin/management) to generate and download every export: Guest list,
RSVP status, Rooming list, Hampers (with proof links), Arrivals, Departures, Fleet/driver sheets. Formats: .xlsx
plus CSV, and a "Full event backup" .xlsx with all sheets.
History table `export_files(event_id, kind, path, bytes, created_by, created_at)` with RLS by event. Re-download
via a 1-hour signed URL.
Write the storage code behind a `StorageAdapter` interface (Supabase Storage now, R2 later).

**A12 · Cloudflare deployment (preview only, no cutover).** Goal: minimum latency for users in Surat.
Facts:
- D1 has no India location (its closest is "apac"), so do NOT move data to D1.
- Use: Next.js on Cloudflare Workers via `@opennextjs/cloudflare` (supports Next 16) + Wrangler.
- `wrangler.jsonc` must include:
  - `"compatibility_flags": ["nodejs_compat"]` and a recent compatibility_date;
  - `"placement": { "region": "aws:ap-south-1" }` (Mumbai);
  - env NEXT_PUBLIC_UI=v2;
  - Supabase URL/anon key from env (secrets via `wrangler secret put`, never committed).
Known risk: OpenNext doesn't support Node-runtime middleware. Check `src/proxy.ts` and adapt it
(edge-compatible or route handlers). Document the change.
Add an R2 implementation of the StorageAdapter (bucket `eventflow-files`: presigned PUT, 1-hour signed GET, keys
prefixed by event_id, access checked before signing).
Add a Hyperdrive binding for any direct Postgres connection (queries still run as the user, never the service
role).
npm scripts: `cf:build`, `cf:preview`, `cf:deploy`. Build must succeed locally. Do NOT deploy to production.
If Cloudflare credentials are missing, stop after a successful `cf:build` and list what's needed.

## Finish
Push `brain/cc-25sep`. Write `REPORT-25sep.md` in the repo root with:
- per task: done/blocked, files changed, how you verified it, and test counts;
- all new migration files, in order, not applied;
- event-creation timing before/after;
- anything Prince must do: Cloudflare API token, custom domain, and a new Supabase project in ap-south-1 Mumbai
  (a region can't be changed in place, so it needs a dump/restore);
- a screen checklist to test on the phone.
