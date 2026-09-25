# EventFlow: Paperclip prompt series (25 Sep 2026)

Paste each block into Paperclip as its own issue, in order. Every block stands alone, so an agent needs no other context.
Agents: **Claude** (brain: plans, merges, deploys) · **DeepSeek** (backend and database) · **Antigravity** (UI) · **Cursor/Composer** (code review) · **OpenCode** (security).

---

## 0. Company brief (set as the Paperclip company or goal description)

```
PRODUCT: EventFlow (Nuvent). Multi-tenant wedding/event operations app for large Indian weddings.
Covers RSVP calling, hospitality (rooms), hampers, logistics (arrivals/departures/fleet), and an admin view.
USERS: admin, event_team staff (department-scoped), client (read-only). Staff use an Android APK
(Capacitor remote shell that loads the web app URL) at a live venue in and around Surat, India.

REPO: C:\dev\EventFlow (GitHub princepatel04477-web/Event-Flow). CURRENT PRODUCTION BRANCH: brain/showcase.
Stack: Next.js 16.2 (App Router, src/proxy.ts), React 19, TypeScript strict, Tailwind v4 tokens (--ef-*),
TanStack Query, Dexie. Supabase Postgres (project xktxnkuzplhzxkevwrcj, Seoul) with RLS, SECURITY DEFINER/INVOKER
RPCs, triggers, and Realtime. v2 UI is baked at build time with NEXT_PUBLIC_UI=v2.
UI lives in src/app/(app)/v2/[eventCode]/**; older screens are in src/app/(staff)/[eventCode]/** (some are re-exported).

NON-NEGOTIABLE RULES
1. One ticket = one branch = one git worktree: C:\dev\ef-<ticket-id>, branched from brain/showcase.
   Run `npm ci` inside the worktree. Never junction node_modules.
2. Every schema change is a new file in supabase/migrations/ (timestamped). Never run ad-hoc SQL on prod.
   Claude reviews and applies migrations. Executors only write the files.
3. No `any` types, no console.log in production code, no stubs or placeholders. Ship complete working code.
4. Never edit next.config.ts and never add test shims to make your sandbox pass. Revert them if you did.
5. Before you hand off, all three gates must pass: `npx tsc --noEmit` (0 errors), `npx vitest run` (all green),
   `NEXT_PUBLIC_UI=v2 npm run build` (exit 0).
   Then write .brain/report-<ticket-id>.md: files changed, what you verified, anything left open.
6. If you cannot git commit (sandbox), leave the tree dirty. Claude commits.
7. Mobile first: test at 390x844. Nothing overflows, tap targets are at least 44px, the fixed tab bar never covers content.
8. Latency target: tap to visible change ≤120 ms (optimistic UI), warm screen change ≤120 ms.
9. Database connection strings and secrets never go into chat, issues, or commits. Use env vars / wrangler secrets.
```

---

## WAVE 1: Broken features (do these first, in parallel)

### T1 · Calling status and RSVP filters (DeepSeek)
```
TICKET T1. Branch brain/t1-rsvp-status, worktree C:\dev\ef-t1.
BUGS:
(a) Calling status does not update after a call outcome is saved.
(b) On the Calls screen, the filters Coming / Not coming / No answer do not work.
FILES: src/app/(app)/v2/[eventCode]/rsvp/queue/CallNext.tsx (filteredRows switch, logOutcomeDirectly,
handleSaveInline), OutcomeButtons.tsx, FamilyQueueSheet.tsx, AllContacts.tsx, src/lib/rsvp-log*, the call write
path (call_attempts insert and guest_groups.rsvp_status update), and the view public.v_rsvp_queue.
ALSO: branch brain/fix-server (unmerged) contains migrations 20260924000100..000600, including a v_rsvp_queue
callback coalesce and an update_message_status RPC. Read them, reuse what is correct, and cite them in your report.
DO:
1. Trace one outcome end to end: button tap → write → DB row → query invalidation → UI. Find where the status is
   lost. Likely suspects: rsvp_status is never written for no-answer, the query cache is not invalidated, or the
   optimistic state is overwritten by a stale refetch.
2. Make each outcome write a definite status: Coming=confirmed, Not coming=declined, No answer=unreachable,
   Maybe=tentative, Call back=callback (with callback_at). Keep optimistic update + rollback.
3. Make the filters: To call = not_started|attempted|null; Coming = confirmed|tentative; Not coming = declined;
   No answer = unreachable|attempted; Call back = callback or next_callback_at set; All.
   Show a count on every chip. Chips must fit at 390px with no overflow.
4. Add a vitest for the filter mapping and the outcome → status mapping.
ACCEPT: log each outcome on a test family. The status and the chip counts change within 120 ms and still match
after a reload.
```

### T2 · Import uses the same sheet format the app exports (DeepSeek)
```
TICKET T2. Branch brain/t2-import-roundtrip, worktree C:\dev\ef-t2.
BUG: importing a guest sheet fails with a format mismatch. Users expect to re-import the same sheet the app
exports. Today the importer asks for a different layout.
FILES: find the importer with `rg -n "import_batches|commit_guest_import|XLSX|sheetjs" src supabase`, and the
exporter in src/lib/export/definitions.ts and src/lib/actions/export.ts.
DO:
1. List the exact column headers of the guest export. Make the importer accept that header set as the primary
   format. Match headers case- and space-insensitively and accept common aliases (Name/Head name,
   Mobile/Phone/Contact, Pax/Guests, Side, City, RSVP).
2. Keep the old template working too (auto-detect which layout it is).
3. When a column is missing, show a plain message naming the missing column and the expected header,
   not a generic error.
4. On the import screen, add a "Download template" button that downloads the export file itself (with headers,
   empty or sample rows).
5. Round-trip test (vitest): export → import the same file → 0 errors and identical families.
ACCEPT: export the guest list from the app, import it back unchanged, and it succeeds.
```

### T3 · Renames and the Today screen cleanup (Antigravity)
```
TICKET T3. Branch brain/t3-names, worktree C:\dev\ef-t3.
DO:
1. Rename the tab and screen label "Travel" to "Logistics", and "Rooms" to "Hospitality", everywhere users can
   see it: src/lib/sections/config.tsx (label, tabLabel), src/lib/departments.ts (DEPARTMENT_LABELS),
   page titles/metadata, headings, empty states, and help text. Do NOT rename routes, DB values, or
   department ids.
2. Remove the "Arrival today" and "Departure today" tiles/cards from the Today and admin screens
   (grep "today" in src/app/(app)/v2/[eventCode]/page.tsx and the dashboard components). Nothing else may
   move or break.
3. Update the tests that assert these labels.
ACCEPT: screenshots at 390px of the tab bar, Today, and the admin view show the new names and no today tiles.
```

---

## WAVE 2: Hospitality (rooms and hampers)

### T4 · Create rooms by quantity + starting number + type; room type everywhere (DeepSeek backend, Antigravity UI)
```
TICKET T4. Branch brain/t4-room-create, worktree C:\dev\ef-t4.
GOAL: creating rooms must be fast. Admin picks a hotel/venue, then enters: Room type, Quantity, Starting room number
(and an optional prefix, e.g. "A-"). Capacity defaults from the type and stays editable.
Example: Deluxe × 10 from 701 creates rooms 701..710, all Deluxe.
ROOM TYPES (fixed list): Suite, Standard, Deluxe, King, Queen.
DO (backend):
1. Migration: add rooms.room_type text with a check constraint over (suite,standard,deluxe,king,queen). Backfill
   existing rooms to 'standard'. Add an index on (event_id, room_type).
2. RPC create_rooms_bulk(p_event_id, p_hotel_id, p_room_type, p_qty, p_start_number, p_prefix, p_capacity,
   p_max_capacity): SECURITY INVOKER, runs in one transaction, skips numbers that already exist, and returns
   {created, skipped[]}. Reject qty > 500.
3. Regenerate the Supabase types.
DO (UI): src/app/(app)/v2/[eventCode]/hospitality/rooms/new/**
4. One screen, 4 fields plus capacity, and a live preview line: "Creates 10 Deluxe rooms: 701–710".
   One Save button.
5. Show the room type on every room card/row (RoomsBoard.tsx, RoomSheet.tsx, PlaceFamilySheet.tsx) as a small
   label next to the room number.
ACCEPT: creating 10 rooms takes ≤3 taps after typing, and every room shows its type.
```

### T5 · Room filters, occupancy colours, venue option (Antigravity)
```
TICKET T5. Branch brain/t5-room-view, worktree C:\dev\ef-t5. Depends on T4 (rooms.room_type). Rebase on
brain/t4-room-create.
FILES: src/app/(app)/v2/[eventCode]/hospitality/rooms/RoomsBoard.tsx and _components/*.
DO:
1. Filter on the room view: type chips Suite / Standard / Deluxe / King / Queen (multi-select), plus
   Hotel/Venue, plus status Empty / Partly filled / Full. Show counts on the chips. Put the filters in one
   bottom sheet behind a "Filter · n" button so nothing overflows at 390px.
2. Occupancy colour on every room tile: EMPTY = green, PARTLY FILLED = yellow/amber, FULL = red (occupied ≥
   capacity). Use the existing tokens (ledger-green / ledger-amber / ledger-red). Add a tiny legend.
   Colour must not be the only signal: also show "2/3" beds.
3. Venue option on the people/room view: a Venue/Hotel selector at the top, so staff see only the rooms and
   people of the venue they stand in. Remember the choice per device (localStorage, wrapped in try/catch).
ACCEPT: filter Deluxe + Full shows only full Deluxe rooms, in red, and the colours update instantly after
placing a family.
```

### T6 · Rooming list in admin, everything clickable, hampers clickable (Antigravity)
```
TICKET T6. Branch brain/t6-rooming-list, worktree C:\dev\ef-t6.
DO:
1. Admin panel → Hospitality → "Rooming list": a table with Hotel, Room no., Type, Family head, Pax, Guests
   names, Check-in status, Hamper status. Sort by hotel then room. Search by name or room number. Export to
   Excel using the existing export helpers.
2. Every item in the Hospitality section must be clickable: a room → room sheet; a family → family detail;
   a count tile → the filtered list behind it. Remove any dead tap areas.
3. Hampers: every row (pending AND the new "Delivered" list in
   src/app/(app)/v2/[eventCode]/hospitality/deliveries/HamperRun.tsx) opens the hamper detail with its proof
   photo. The progress tile opens the full list.
ACCEPT: in the admin rooming list, tapping any row, count, or hamper opens the right screen. No element that
looks tappable is dead.
```

---

## WAVE 3: Admin, access, notifications

### T7 · Admin view: pax, families, confirmation tabs, faster event creation (DeepSeek + Antigravity)
```
TICKET T7. Branch brain/t7-admin, worktree C:\dev\ef-t7.
DO:
1. The admin dashboard counts people in PAX, not groups. Show "No. of families" as its own number next to
   total pax. Use confirmed_pax, falling back to expected_pax.
2. Add confirmation tabs to the admin guest view: Confirmed · Not coming · Maybe · No answer · Not called.
   Each tab shows its pax and family count and the list.
3. Event creation is too slow. Measure it: time each step of the create flow (form → server action → inserts →
   redirect) with the existing phaseTiming helper. Remove the serial round-trips: batch the inserts into one RPC
   (create_event_with_defaults) and prefetch the destination. Target ≤1.5 s from tap to the new event's Today
   screen.
ACCEPT: the numbers on the dashboard match a SQL count by pax; the tabs work; event creation timing is
written into the report (before/after).
```

### T8 · Section locking + RSVP caller role (DeepSeek)
```
TICKET T8. Branch brain/t8-section-lock, worktree C:\dev\ef-t8.
CONTEXT: staff departments are in src/lib/departments.ts (management, logistics, hospitality, hamper,
production). There is NO RSVP role today, so a caller cannot be scoped to Calls only.
DO:
1. Add department 'rsvp' (label "RSVP / Calls"). Its sections are ['dashboard','rsvp'] and its home is the call
   queue. Migration: allow 'rsvp' on staff_members.department. Add it to the Add-staff and pick-staff screens.
2. Section locking: an admin can lock a section per event (rsvp, hospitality, hamper, logistics). A locked
   section is read-only for staff: writes are blocked in the DB (RLS/RPC check on a new event_section_locks
   table), not just hidden in the UI. Staff see a clear "Locked by admin" banner. The admin toggle goes in the
   admin panel → Settings.
3. Tests: an RLS/RPC test showing a staff write is rejected while locked and allowed after unlocking.
ACCEPT: an RSVP staff member only sees Today + Calls. Locking Hospitality makes Place/Check-in fail for
staff with a clear message.
```

### T9 · Arrival notifications (DeepSeek + Antigravity)
```
TICKET T9. Branch brain/t9-arrivals-notify, worktree C:\dev\ef-t9.
GOAL: when a guest arrival is due or happens, the app must say so clearly.
DO:
1. In-app: a persistent banner/badge on the Logistics tab and Today screen. Examples: "3 arriving in the next
   60 min", "Sharma family arrived · Room 705". It updates live via Supabase Realtime on travel_legs and the
   arrival marks. Tap opens the arrivals list.
2. Push notification to the Android app for "arriving in 30 min" and "arrived", to logistics + hospitality
   staff of that event only (use Capacitor Push / FCM, keys in env). If push is not configured, fall back to the
   in-app banner. Never crash.
3. Admin setting to switch each notification on/off.
ACCEPT: marking a family arrived shows the banner on a second device within 2 s.
```

---

## WAVE 4: Web portal + Files

### T10 · Full web portal (desktop) (Antigravity)
```
TICKET T10. Branch brain/t10-web-portal, worktree C:\dev\ef-t10.
GOAL: the whole software is usable on a laptop/desktop browser, not just the phone.
DO:
1. At ≥1024px, switch to a desktop layout: a left sidebar nav (Today, Calls, Hospitality, Hampers, Logistics,
   Guests, Files, Settings), a wide content area, tables instead of stacked cards, and a detail panel on the
   right instead of bottom sheets. Mobile (<768px) stays exactly as it is.
2. Every screen must work with a keyboard (tab order, Enter/Escape) and a mouse (hover states).
3. No duplicate screens: same components, responsive layout only.
ACCEPT: screenshots at 390px, 768px, and 1440px for every tab. Nothing breaks and the mobile output is unchanged.
```

### T11 · Files area for exports (DeepSeek + Antigravity)
```
TICKET T11. Branch brain/t11-files, worktree C:\dev\ef-t11. (Storage target: R2 after the infra wave; write the
code against a StorageAdapter interface so it works on Supabase Storage now and R2 later.)
DO:
1. "Files" section (admin + management): one place to generate and download every export: Guest list, RSVP
   status, Rooming list, Hampers (with proof links), Arrivals, Departures, Fleet/driver sheets. Excel (.xlsx),
   with CSV as an option.
2. Keep a history: file name, who, when, size, a re-download link (signed URL, 1 h expiry). Table
   export_files(event_id, kind, path, bytes, created_by, created_at) with RLS by event.
3. Also provide "Download full event backup" (all sheets in one .xlsx).
ACCEPT: every export downloads and opens in Excel, and the history shows it.
```

---

## WAVE 5: Infrastructure move to Cloudflare (lowest latency for Surat)

**Read this first (Claude):** Cloudflare has no India location for D1. Its options are wnam, enam, weur, eeur,
apac, and oc, and apac usually means Singapore or Tokyo. A Worker, though, can be pinned to AWS Mumbai
(`placement.region = "aws:ap-south-1"`). The lowest-latency setup for Surat is therefore:
**Cloudflare Workers (edge in Mumbai) + a Worker pinned to aws:ap-south-1 + Postgres in Mumbai (Supabase ap-south-1) through Hyperdrive + R2 for files.**
Moving the data to D1 means rewriting RLS, all RPCs, triggers, Realtime, and Auth on SQLite. That is weeks of
work, and its primary would still sit in apac, not India. So I1–I5 below are today's move. I6 is only a
time-boxed spike to decide on D1 later.

### I0 · Owner checklist (Prince does this; agents cannot)
```
1. Cloudflare account on the Workers Paid plan; create an API token (Workers, R2, Hyperdrive, D1 edit).
   Share it only as an env var on the PC, never in chat.
2. Pick a domain (e.g. app.<yourdomain>) and add it to Cloudflare DNS. The APK will point to this domain from
   now on, so future moves never need a new APK.
3. Create a new Supabase project in region ap-south-1 (Mumbai), same plan tier.
4. Choose a 30-minute cutover window with no live event running.
```

### I1 · Move Postgres to Mumbai (DeepSeek writes scripts, Claude runs them)
```
TICKET I1. No app code changes.
Supabase cannot change a project's region, so we dump and restore into the new ap-south-1 project.
DO:
1. Script scripts/migrate-region.ps1:
   - dump schema, data, and auth from the Seoul project (supabase db dump --schema public,app,auth and --data-only);
   - restore into the Mumbai project;
   - re-apply grants, RLS, functions, triggers, views, publications (realtime), and cron;
   - copy the storage buckets and objects (or move them to R2 in I3).
2. Verification script: row counts per table must match on both sides; also list functions, policies,
   triggers, and auth.users. Output a diff. Any mismatch = STOP.
3. Keep Seoul read-only as the fallback for 7 days.
ACCEPT: the diff is empty and a login plus one RSVP write works against Mumbai from a preview deploy.
```

### I2 · Deploy the Next.js app on Cloudflare Workers (DeepSeek)
```
TICKET I2. Branch brain/i2-cloudflare, worktree C:\dev\ef-i2.
DO:
1. Add @opennextjs/cloudflare (it supports Next 16) and wrangler. Create open-next.config.ts and wrangler.jsonc:
   - compatibility_flags ["nodejs_compat"]; a recent compatibility_date;
   - "placement": { "region": "aws:ap-south-1" }  (pins the server code next to the Mumbai database);
   - the custom domain from I0 as a route;
   - env vars: NEXT_PUBLIC_UI=v2 and the Supabase URL/anon key for the MUMBAI project; secrets via
     `wrangler secret put`.
2. KNOWN RISK: OpenNext does not yet support Node-runtime middleware. Check src/proxy.ts. If it needs the Node
   runtime, move its logic to the edge-compatible form or into route handlers. Document what changed.
3. Remove any Vercel-only APIs (@vercel/*, headers that assume Vercel) or put them behind an adapter.
4. Scripts: "cf:build" (opennextjs-cloudflare build), "cf:preview", "cf:deploy".
5. Deploy to a *.workers.dev preview first. Measure from Surat with `npm run latency` (existing script) against
   the preview: TTFB, tap→content. Compare with nuvent-five.vercel.app and put the numbers in the report.
ACCEPT: every tab works on the preview, and the latency numbers are recorded and better than Vercel icn1.
```

### I3 · Hyperdrive + R2 (DeepSeek)
```
TICKET I3. Branch brain/i3-hyperdrive-r2 (on top of I2).
DO:
1. Server-side database reads/writes that use a direct Postgres connection go through a Hyperdrive binding
   pointed at the Mumbai database (connection pooling + query caching for safe reads). supabase-js REST calls
   stay as they are. Don't change RLS: queries must keep running as the user (pass the user JWT), never as the
   service role.
2. R2 bucket "eventflow-files" for: hamper proof photos, exports (T11), import uploads.
   - Implement the StorageAdapter for R2: presigned PUT for uploads from the phone, signed GET (1 h) for
     viewing.
   - Keys are prefixed by event_id; the server checks event access before signing.
3. Migration script: copy the existing Supabase Storage objects to R2 and rewrite the stored paths. Idempotent;
   dry-run first.
ACCEPT: a hamper photo taken on the phone uploads to R2 and shows on the detail screen; an export downloads from R2.
```

### I4 · Security review of the move (OpenCode)
```
TICKET I4. Review brain/i2-cloudflare + brain/i3-hyperdrive-r2 + T8.
Check: no secrets in the repo or wrangler.jsonc; no service-role key in any Worker path that user input can
reach; RLS still enforced (queries run with the user JWT); R2 URLs are signed, short-lived, and event-scoped;
no open CORS; the section locks from T8 are enforced in the DB; auth cookies are Secure/HttpOnly/SameSite on
the new domain; the Capacitor androidScheme 'https' session still persists.
Output .brain/security-I4.md with severity-ranked findings, and file:line for each.
```

### I5 · Cutover + new APK (Claude)
```
TICKET I5.
1. Freeze writes (maintenance banner). Run I1's final delta sync. Verify counts.
2. Deploy brain/i2 + i3 to production on the custom domain. Smoke test every tab at 390px.
3. Build the APK with CAP_SERVER_URL=https://<custom domain>, bump versionCode, output to
   C:\android-builds\nuvent\eventflow-final-09.apk.
4. Keep Vercel + Seoul alive and untouched for 7 days as the rollback path (the rollback is the old APK/URL).
5. Report: before/after latency from Surat, APK path, rollback steps.
```

### I6 · (Optional) D1 feasibility spike, time-boxed to 1 day (DeepSeek)
```
TICKET I6. Research only, no production changes.
Evaluate moving from Postgres to D1 (SQLite) with read replication, primary location hint "apac".
Deliver .brain/d1-spike.md covering:
- which tables, views, RPCs, and triggers would need rewriting;
- how RLS would be replaced (app-layer checks in every Worker route);
- what replaces Realtime (Durable Objects + WebSockets) and Supabase Auth;
- the measured round-trip latency from Surat to an apac D1 versus Hyperdrive→Mumbai Postgres (same query);
- an effort estimate in days.
Recommend GO/NO-GO. Default expectation: NO-GO unless it is clearly faster AND the effort is under 2 weeks.
```

---

## Review gates (run after every wave)

### R-Cursor · Code review (Cursor, Composer)
```
Review branches <list> against brain/showcase. For each: correctness bugs, missed edge cases (empty lists, 0
pax, a family split across rooms, offline/optimistic rollback), mobile overflow at 390px, `any` types,
console.log, dead taps, and N+1 queries. Output .brain/review-<wave>.md with findings as file:line + a
concrete fix. Do not rewrite features.
```

### R-OpenCode · Security scan (OpenCode)
```
Scan the diffs of <list>: RLS bypass, SECURITY DEFINER functions without an event/role check, IDOR on
event_id or group_id, secrets, XSS in names/remarks, and unsafe file handling in import/export.
Output .brain/security-<wave>.md, severity-ranked.
```

### R-Claude · Merge + verify + deploy (Claude)
```
For each approved ticket: revert next.config.ts and test shims; commit; merge into brain/integration in order
T1→T11; apply the reviewed migrations to staging first, then prod; run tsc, vitest, and the v2 build; take
screenshots at 390px of every touched screen; deploy; tell Prince what changed and what to test on the phone.
```

---

### Suggested run order today
1. Parallel: **T1, T2, T3**, while Prince does **I0**.
2. Parallel: **T4 → T5**, **T6**, **I1** (scripts), **I2** (preview).
3. **R-Cursor + R-OpenCode** on wave 1 and 2, then **R-Claude** deploys.
4. **I3, I4**, then **I5** cutover in the quiet window.
5. Next day: **T7, T8, T9, T10, T11**, then reviews. **I6** only if you still want D1.
