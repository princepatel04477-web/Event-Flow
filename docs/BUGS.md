# BUGS.md — bug hunt, Wave 3 (v2/v3 screens)

**What this is.** Every defect found in one bug-hunt pass over the v2/v3 screens and the server
actions behind them, plus every place an untrained wedding runner would get stuck. It is a
**discovery** document: nothing here is fixed, and no screen code was changed.

**How it was found.** Two methods, both recorded so a reader can judge the evidence:

1. **Eight end-to-end flow specs** under `e2e/flows/`, one per real job, driving the workflow
   through the UI, counting the taps it took and asserting the outcome. Run them with
   `NEXT_PUBLIC_UI=v2` (see **Too many steps**):
   `$env:NEXT_PUBLIC_UI='v2'; npx playwright test --project=flows`
2. **A static read of every v2 screen and every server action**, hunting eight specific classes:
   unhandled errors, silent failures, missing loading/empty/error states, double-submit, stale data
   after a write, wrong role access, date/timezone bugs (IST), phone-number formatting, and raw
   errors or English jargon shown to staff.

**The browser could not be launched in the session that wrote this** (`chromium.launch` fails with
`spawn EPERM` under the sandbox). So: every spec typechecks and every spec is discovered by
Playwright (`npx playwright test --list --project=flows` → 31 tests), the tap budgets are derived
from each flow's own step list rather than measured, and **no finding below has been reproduced in
a browser.** Each one cites a real line that was read. Where a finding is arithmetic (a cache key,
a cast, a date function) that is enough; where it is a visual occlusion, the spec asserts geometry
so a real run settles it.

**Severity.**

| | Means |
|---|---|
| **blocker** | the job cannot be done, or data is written wrong or lost, or a tenancy/security break |
| **major** | the job is doable but the screen lies, stalls or double-writes, or staff get stuck or misread it |
| **minor** | cosmetic, wording, small confusion |

**Deliberately not reported** (already documented and decided — `CLAUDE.md` §10/§11b/§12/§14 and
`docs/UX-RULES.md`): cross-direction vehicle double-booking; the room-swap-between-two-full-rooms
gap; the 15-minute caller lock with no admin override; missing audit triggers on
`transcripts`/`trip_passengers`/`messages`/`import_*`; `apply_rsvp_extraction()` updating only the
oldest leg per direction; the missing pair `CHECK` on `delivery_proofs`; no "disputed proof"
mechanism; the `.env.test` `E2E_EVENT_ID` vs access-code event mismatch; repo-wide pre-existing
lint/style noise (`any`, `console.log`, unused vars) unless it causes a real user-visible bug.

---

## Blockers

### B1 — The **Rooms** tab in the bottom bar leads to a page that does not exist

- **where:** `src/lib/sections/v3.ts:80` (`v3Href`) + `src/lib/sections/config.tsx:148`
  (`SECTIONS.hospitality` has no `path`), and there is **no** `page.tsx` at
  `src/app/(app)/v2/[eventCode]/hospitality/` or `src/app/(staff)/[eventCode]/hospitality/`
  (verified by glob over `src/app/**/hospitality/page.tsx` → no files).
- **what:** the v3 bar builds each tab from `SECTIONS[section].path ?? section`, so the Rooms tab
  renders `href="/{event}/hospitality"`. Nothing serves that path. Nothing redirects it either —
  `next.config.ts`'s `redirects()` has no `hospitality` entry.
- **repro:** open the app, tap **Rooms** in the bottom bar (Today · Calls · **Rooms** · Hampers ·
  Travel). Every viewer the tab is shown to is affected: management, admin, and a hospitality
  runner (whose only bar is that section).
- **expected:** the Rooms board (`/{event}/hospitality/rooms`).
- **actual:** the event's not-found screen, "That page is not here". One of five tabs is dead, and
  a hospitality runner has no route into their own job.
- **fix:** give the section a destination — either a `redirect('/{event}/hospitality/rooms')` page
  at `hospitality/page.tsx` (both trees), or a `path`/`href` on `SECTIONS.hospitality` pointing at
  `rooms`. **`tests/v3-nav.test.ts:50` pins the current broken href as the contract**, so the test
  and the new page must move together.
- **spec:** `e2e/flows/b-rooms.spec.ts` → `(b0) the Rooms tab opens the Rooms board`, which asserts
  the not-found note is absent.

### B2 — Messaging always resolves **zero recipients**, so both send screens do nothing

- **where:** `src/lib/actions/messages.ts:119` and `:123` (two independent causes, fix both)
- **what:** `resolveRecipients` selects `id, head_name, primary_mobile, rsvp_status` and returns the
  rows through `as unknown as RecipientGroup[]` with no mapping, while `RecipientGroup` requires
  `groupId`/`headName`/`mobileNumber`/`rsvpStatus`. Every field is `undefined` at runtime, so the
  mobile filter a few lines down drops every row of every filter. The double cast is why `tsc` is
  clean.
- **repro:** admin → Messages & access → **Send messages** (or **Prepare messages**) → any template
  + "All confirmed" → Preview.
- **expected:** the confirmed families, with their numbers, and a real count on the send button.
- **actual:** an empty list and "Send to 0 families"; Prepare messages shows a blank "Messages
  ready" with count 0.
- **fix:** map explicitly before returning —
  `.map(r => ({ groupId: r.id, headName: r.head_name, mobileNumber: r.primary_mobile ?? '', rsvpStatus: r.rsvp_status }))`
  — for both return branches, and drop the `as unknown as`.

### B3 — Even with B2 fixed, **every WhatsApp send fails**: stored numbers are 10 digits, `parsePhone` demands a country code

- **where:** `src/lib/messaging/provider.ts:102`
- **what:** `parsePhone` matches `/^\+?(\d{1,3})(\d{10})$/` (11–13 digits), but
  `guest_groups.primary_mobile` is stored normalised to **exactly 10 digits with no `+91`**
  (`src/lib/phone.ts:118`). Every recipient is rejected as `invalid_number`.
- **repro:** admin → Send messages → any template → Send. Every recipient reads "Invalid number:
  9876543210". The test-mode field's own placeholder (`+919876543210`) shows the country code the
  real path never adds.
- **expected:** a 10-digit Indian mobile is sent as country code `91` + the 10 digits.
- **actual:** `sendBsp` returns `{ ok: false, code: 'invalid_number' }` for every number in the
  database.
- **fix:** in `parsePhone`, default `countryCode` to `'91'` when the input reduces to 10 digits;
  keep the existing branch for 11–13-digit inputs.
- **note:** B2 and B3 are independent. Fixing the row mapping alone still leaves every send failing.

### B4 — "Reject" on the review screen still writes the AI value into guest data

- **where:** `src/components/review/ReviewPanel.tsx:246` (and `:254`; the lying copy is at `:700`)
- **what:** `handleCommit` builds the RPC payload from the whole live form
  (`buildRpcPayload(values)`) and never excludes fields marked `rejected`. The rejection only changes
  the **audit** row (`finalValue: null`); `apply_rsvp_extraction()` applies everything in the payload
  (`supabase/migrations/20260807000502_code_auth_attribution.sql:301`). So the rejected value lands in
  `travel_legs`/`guest_groups` while the insert-only audit says the human rejected it — and the summary
  even reads "<value> — left unchanged".
- **repro:** open a call-notes draft, **Reject** `Arrival flight/train no` (a hallucinated PNR), decide
  the rest, **Commit**.
- **expected:** rejected fields omitted from the payload; data and audit agree.
- **actual:** the hallucinated PNR is written and can never be corrected; the audit trail is a lie.
- **fix:** build the payload from the DECISIONS, not from `values` — skip any path whose decision is
  `rejected`.
- **why it matters:** CLAUDE.md §5.8 makes "only a human-reviewed commit becomes data" the
  non-negotiable rule, and this is the one mechanism that enforces it per field.

### B5 — Logging "Coming" from the Calls screen **wipes the family's special requirements**

- **where:** `src/app/(app)/v2/[eventCode]/rsvp/queue/InlineCaptureStep.tsx:87` → `src/lib/rsvp-log.ts:472`
- **what:** `buildRsvpLogPayload` hardcodes `specialRequirements: []`, and the inline capture step is
  its only caller. `save_rsvp_log` does
  `case when p_special_requirements is null then g.special_requirements else p_special_requirements end`
  — `[]` is not null, so the column is overwritten empty. The two other v2 paths
  (`CallNext.tsx:383`, `:434`) pass the array through, so only the most-used path loses data.
- **repro:** open Calls on a family flagged `wheelchair`, tap **Coming**, **Save · next family**.
- **expected:** recorded needs survive a travel save; this screen has no control to re-enter them.
- **actual:** `special_requirements` becomes `{}` silently. "wheelchair for mother" is gone.
- **fix:** add a `specialRequirements` param and pass `family.special_requirements`; or send `null`
  when the screen has no such control so the RPC's `coalesce` keeps the stored value.

### B6 — A lost response after the proof commits queues a **second, unrecoverable photo proof**

- **where:** `src/app/(staff)/[eventCode]/hospitality/deliveries/[deliverableId]/DeliveryDetail.tsx:260`
  (see also `src/lib/proof.ts:249`, `src/lib/proof-queue.ts:54`)
- **what:** `handleConfirm` calls `submitProof` with no idempotency key — one is minted inside as
  `crypto.randomUUID()` — and **any** failure, including a response lost *after* the upload and the
  `delivery_proofs` insert already committed, falls into `catch` and calls `queueProof`, which mints a
  **new** `localId`. The replay uploads to a different storage path and inserts a second proof row.
  `storage_path` is the unique key, so the 23505 branch that was meant to make this idempotent never
  fires. The screen also told the runner "This is NOT marked delivered yet" while the row already was.
- **repro:** with Wi-Fi associated-but-dead (`navigator.onLine` still true), tap **Confirm delivery** as
  the link drops after the server committed.
- **expected:** one proof per deliverable; a retry of a committed proof is recognised as already-synced.
- **actual:** two insert-only rows for one hamper, forever. **Nothing can delete, correct or dispute
  them — not even the service role** (CLAUDE.md §5.2).
- **fix:** generate the key in the UI *before* the attempt, pass it to `submitProof`, and pass the
  **same** key into `queueProof` (extend it to accept `idempotencyKey`).

### B7 — Arrivals and Departures share **one TanStack cache entry**, so Departures paints arrivals

- **where:** `src/app/(app)/v2/[eventCode]/logistics/_components/TravelBoard.tsx:131`;
  `src/lib/query/keys.ts:118`; the 30s default at `src/components/providers/QueryProvider.tsx:42`
- **what:** one component serves both directions but always keys on
  `queryKeys.logistics.arrivals(eventId)`, while its `queryFn` filters `direction = 'departure'`.
  TanStack identifies a query by key, so the second direction reuses the first's cached rows and never
  runs its own `queryFn` while the data is fresh.
- **repro:** on a phone open Travel → **Arrivals**, then tap the Arrivals|Departures switch within 30
  seconds — the one-tap path the `Segmented` exists for.
- **expected:** the departures board.
- **actual:** it renders the arrival families, flight numbers and statuses; the sheet's "Leaving" line
  sits over an arrival time, and **"Mark departed" stamps `departed_at` on a family that is still
  arriving.** Optimistic marks from either board also land in the one entry.
- **fix:** add the direction to the key (`queryKeys.logistics.legs(eventId, direction)`), keep the
  arrival key shared with `ArrivalsClient`, and update the `useOptimisticAction` `queryKey` in
  `TravelBoard`.
- **spec:** `e2e/flows/e-travel.spec.ts` → `(e2)`, which asserts a family whose only leg is an arrival
  never appears on the departures board.

### B8 — Concurrent flushes replay the same queued write up to N times

- **where:** `src/lib/mutate/write-queue.ts:162` (the entry read), `src/lib/mutate/useOptimisticAction.ts:180`
  (the drain), `src/lib/mutate/write-queue.ts:20` (the `localId` claim), `src/lib/actions/rooms.ts:1264`
- **what:** `flushWriteQueue()` reads the whole table into `entries` and then awaits each replay with
  **no in-flight guard**, while every mounted `useOptimisticAction` hook installs its own
  unconditional drain effect. On the offline→online transition all sibling hooks fire in the same
  commit, read the same rows before any is deleted, and each row is sent once per hook. The row's
  `localId` is described as the idempotency key but is never passed to any action (the replay
  signature is `(eventId, payload)` only), so nothing downstream can dedupe.
- **repro:** on the Rooms board with no signal, place a family (3 guests) in a room, then move one
  occupant — two rows queued. Restore signal while still on Rooms. Four hooks (`place`, `move`,
  `remove`, `add`) each drain; the `assign-guests-room` row replays up to four times, and each replay
  places the **next** unplaced guests of that family (`rooms.ts:1264`).
- **expected:** a queued write is delivered exactly once.
- **actual:** guests are assigned to rooms the coordinator never placed.
- **fix:** serialise the drain behind a module-level in-flight promise in `write-queue.ts` (return the
  existing promise when one is running) and thread `localId` into the replay so actions that accept an
  idempotency key can no-op the second call.

### B9 — The **Remark** column the preview shows is never written; import silently discards it

- **where:** `src/app/(staff)/[eventCode]/guests/import/_components/PreviewStep.tsx:77`,
  `src/lib/actions/import.ts:148`, `supabase/migrations/20260805001100_fix_import_commit_schema.sql:132`
- **what:** the commit payload omits `remark`; `commitFamilySchema` has no `remark`, so zod strips it;
  the RPC **does** read `v_row ->> 'remarks'` and would insert it. `src/lib/import/normalize.ts:107`
  claims "the remark itself is still imported" — it is not. `rsvpStatus` is dropped by the same payload
  while the preview copy says `Imported as "declined" from the remark` and the summary counts
  Declined/Tentative, so those counters describe state the database never receives.
- **repro:** import a sheet with Remark `wheelchair for mother` / `Not Coming`, confirm, then open the
  family's RSVP record.
- **expected:** every Remark cell lands in `guest_groups.remarks`; the Declined/Tentative wording
  matches what is stored.
- **actual:** `remarks` stays null for all 238 families, and the family is still in the to-call queue.
  The only record of "not coming", and every accessibility/dietary note, is gone.
- **fix:** add `remark` to the zod schema, send `remarks: f.remark`, and either add an `rsvp_status`
  insert branch or correct the "Imported as …" copy.

### B10 — **"Confirm import" is painted under the fixed tab bar**, so the import cannot be committed by tapping

- **where:** `src/app/(staff)/[eventCode]/guests/import/_components/PreviewStep.tsx:234` and
  `src/app/globals.css:451`
- **what:** the confirm bar is `sticky bottom-0` with no z-index; `AppTabs` is `fixed … z-40` at
  `bottom: 0`. `globals.css:451-461` documents this exact trap and ships `bottom-nav`/`bottom-bar`;
  this bar uses neither.
- **repro:** as admin at 360px, upload a real sheet and scroll — the sticky bar pins to the viewport
  bottom and the 64px tab bar covers all but the top few pixels of the 56px maroon button.
- **expected:** the primary commit above the tab bar, as every `BottomBar` does.
- **actual:** the button renders (so `toBeVisible()` passes), and the tap lands on the tab bar. The
  import cannot be completed.
- **fix:** use `BottomBar`, or add `bottom-nav z-40` plus `pb-nav-bottombar` clearance.
- **spec:** `e2e/flows/h-admin.spec.ts` → `(h3)` asserts the geometry (the confirm bar's bottom edge
  must be above the tab bar's top edge), because visibility alone does not catch occlusion.

---

## Major

### Access, roles and guards

#### M1 — A skipped-name team session gets five tabs, four of which bounce

- **where:** `src/lib/sections/v3.ts:129`
- **what:** `isLead` includes `department === null`, so a code session that never picked a staff name
  gets Today/Calls/Rooms/Hampers/Travel; `sectionAllowedForDepartment(id, null)` allows only
  `dashboard` (`src/lib/departments.ts:129`), so the other four redirect to `?denied=section`.
- **repro:** `/pick-staff` → **Skip for now** (or an event with no staff rows → "Continue without a
  name"), then tap any tab but Today.
- **expected:** the one screen the session can open — v1 renders Home only for this session.
- **actual:** four live-looking tabs that only bounce back.
- **fix:** drop `|| department === null` from `isLead` in `v3TabsFor`.

#### M2 — Re-exported v1 pages under the v2 hospitality tree **lose the section guard**

- **where:** `src/app/(app)/v2/[eventCode]/hospitality/checkin/page.tsx:7`, and the same pattern in
  `rooms/new/page.tsx:7` and `rooms/allocate/page.tsx:7`
- **what:** a v2 re-export calls the v1 *module*, so the v1 group's `layout.tsx` never runs. The page's
  own guard is `requireStaff` only, and the v2 shell deliberately does not inherit a per-section guard.
- **repro:** sign in as an `event_team` member whose department is Travel, then open
  `/{eventCode}/hospitality/checkin`. The screen opens and its controls are usable.
- **expected:** the same `requireSection(event.id, event.code, 'hospitality')` gate the v3 Rooms page
  uses.
- **actual:** `/{eventCode}/hospitality/rooms` correctly bounces them; check-in, add-rooms and
  allocate do not.
- **fix:** add the guard to each v2 hospitality page that re-exports v1, or give
  `(app)/v2/[eventCode]/hospitality/` its own layout doing it.

#### M3 — Find's "Open the family record" bounces every runner whose section is not Calls

- **where:** `src/app/(app)/v2/[eventCode]/guests/_components/StaffGuestDirectory.tsx:225`;
  `src/app/(staff)/[eventCode]/rsvp/layout.tsx:16`
- **what:** `familyHref` is hardcoded to `/rsvp/status/{id}` for every staff viewer, but `/rsvp/**` is
  gated by `requireSection('rsvp')` (management only). The search button is in **every** header, so all
  four runner departments reach the sheet and its maroon primary button.
- **repro:** hospitality runner → header search → result → **Open the family record**.
- **expected:** either no link, or a destination they may open.
- **actual:** bounced to Rooms with `?denied=section` — and the Rooms board does not render the denied
  note, so the bounce is silent (UX-RULES R3).
- **fix:** resolve permission server-side (as `rooms/page.tsx:47` does) and pass `familyHref` only when
  the RSVP section is open to the viewer.

#### M4 — Admin-only update actions report `{ ok: true }` when RLS matched zero rows

- **where:** `src/lib/actions/staff.ts:155`; `src/lib/actions/events.ts:329`
- **what:** `setStaffMemberActive` / `setStaffMemberDepartment` have no TypeScript permission check and
  treat a Supabase error as the only failure signal. An RLS-refused UPDATE is **not** an error — it
  updates 0 rows and returns `error: null` — so a non-admin gets `{ ok: true }`. `archiveEvent` /
  `unarchiveEvent` make the same mistake and assert in comments that a refusal "comes back as `42501`";
  that is true for INSERT (`with check`), not for UPDATE (`using`).
- **repro:** call `setStaffMemberActive('<any staff id>', '<code>', false)` as an authenticated
  non-admin — it resolves `{ ok: true }` and changes nothing.
- **expected:** an explicit admin guard, or the update paired with `.select('id')` so a zero-row result
  is detected and reported.
- **actual:** the caller is told the write succeeded while the database was never touched.
- **fix:** add `getEventAccess`/`is_admin` guards to the staff actions and check the returned row count
  (`.select('id').maybeSingle()` → `PGRST116` means nothing matched) in the archive actions.

#### M5 — Import advertises `event_team` in the nav but the page refuses them

- **where:** `src/lib/sections/config.tsx:119` vs `src/app/(staff)/[eventCode]/guests/import/page.tsx:49`
- **what:** the config roles are `['admin','event_team']` with a comment asserting the fix, and
  `commitImport` (`src/lib/actions/import.ts:191`) also accepts `event_team`, but the page still calls
  `requireAdmin(..., 'import')`.
- **repro:** team code as a management-department lead → Guests → **Import** tab → bounced to Home with
  "Importing the guest list is an admin job".
- **expected:** the tab and the page agree.
- **actual:** v1's second-level strip shows a tab that can only bounce.
- **fix:** either swap to `requireStaff` (and give v3 a door) or revert the config to `['admin']`.

#### M6 — An unauthenticated endpoint mints paid xAI realtime credentials

- **where:** `src/app/api/grok-voice/ephemeral/route.ts:7`
- **what:** `POST` has no session or role check of any kind; it reads `XAI_API_KEY` and returns a
  300-second client secret from `api.x.ai`. The sibling `save-draft/route.ts:20-28` **does** check
  `getSessionClaims()`/`getUser()` and `getEventAccess`, so the omission is inconsistent rather than
  deliberate. It is inert today only because `XAI_API_KEY` is not among the three Vercel env vars.
- **repro:** `curl -X POST https://<deploy>/api/grok-voice/ephemeral` with no cookie.
- **expected:** 401 for an anonymous caller plus an event-scoped role check.
- **actual:** anyone who finds the URL can spend the owner's Grok Voice budget the moment the key is
  added.
- **fix:** require `getSessionClaims()`/`auth.getUser()` plus `getEventAccess`, mirroring `save-draft`.

#### M7 — A Rooms runner cannot open the hamper run in v2, and the bounce is silent

- **where:** `src/app/(app)/v2/[eventCode]/hamper/layout.tsx:42` (narrow `requireSection(..., 'hamper')`)
  versus the guard it overrides, `src/app/(app)/v2/[eventCode]/hospitality/deliveries/_guard.ts:52`;
  the redirect at `.../hospitality/deliveries/page.tsx:29`
- **what:** `_guard.ts` and `HamperRun` are built to admit the UNION of the hamper and hospitality
  departments, and the layout's own comment says a hospitality runner's copy is
  `/hospitality/deliveries`. Both are now false: that address 307s to `/hamper`, where the layout admits
  `hamper` only, so the runner is sent to `hospitality/rooms?denied=section`.
- **repro:** as a hospitality runner with `NEXT_PUBLIC_UI=v2`, open a pre-v3 bookmark or shared link to
  `/EVENT/hospitality/deliveries`.
- **expected:** the hamper run — v1 allowed it.
- **actual:** a silent teleport to Rooms with no explanation, and the `?denied=section` marker is
  dropped because only the dashboard pages read it.
- **fix:** gate the hamper section with `requireHamperScreen`'s union in the layout (or drop the
  deliveries redirect), and render the denial note on non-dashboard department homes.

### Calling

#### M8 — Outcome buttons stay live while a write is in flight; a double tap logs the **next** family

- **where:** `src/app/(app)/v2/[eventCode]/rsvp/queue/CallNext.tsx:523`, `:527`, `:391`
- **what:** `OutcomeButtons` is disabled only while the family row is missing; `syncState` guards only
  the BottomBar primary. `logOutcomeDirectly` fires the write and then advances the card immediately,
  with no in-flight guard and no Undo offered.
- **repro:** tap **Not coming** twice quickly.
- **expected:** the second tap absorbed; one family, one outcome.
- **actual:** the second tap logs the NEXT family with the wrong family's `needs_pickup` and
  `special_requirements`.
- **fix:** gate the three outcome buttons on a saving flag cleared when the write settles.

#### M9 — A failed `submitCallOutcome` inside a successful RSVP write is swallowed, and the screen says "saved"

- **where:** `src/app/(app)/v2/[eventCode]/rsvp/queue/CallNext.tsx:265`, `:274`, `:279`
- **what:** the action saves the RSVP and closes the call attempt in one `Promise.all`. When
  `saveRsvpLog` succeeds but `submitCallOutcome` fails, the failure is only sent to
  `captureDiagnostic`; the action still returns `{ ok: true }`, so the write is reported `saved`,
  `lastError` stays null, and the queue path never runs.
- **repro:** tap **Coming** at the moment the venue link accepts the RSVP but drops the second request.
- **expected:** the whole write reported as unsent (queued on the phone, R8), or the open attempt
  surfaced and retried.
- **actual:** the RSVP is written, the `call_attempts` row stays open forever (append-only, one-shot
  freeze — CLAUDE.md §5.4), and the UI claims success.
- **fix:** return `{ ok: false, message }` when `call && !call.ok && !call.alreadyFinalized`, or run the
  attempt closure through the queue separately.

#### M10 — `v_rsvp_queue` lost `coalesce(gg.callback_at, …)`, so a callback time vanishes and v1's filter misses it

- **where:** `src/app/(app)/v2/[eventCode]/rsvp/queue/CallNext.tsx:235`;
  `.../CurrentFamilyCard.tsx:44`; the view at
  `supabase/migrations/20260808110000_queue_view_staff_lock.sql:34`
- **what:** `v_rsvp_queue.next_callback_at` is `min(call_attempts.callback_at)` only. Migration
  `20260806100000` had `coalesce(gg.callback_at, c.next_callback_at)`; `20260808110000` recreated the
  view without it (and dropped `adults_confirmed`/`children_confirmed` that `1600` added), and no later
  migration restored it. `save_rsvp_log` writes `guest_groups.callback_at`, which the view does not
  expose.
- **repro:** pick a family, **Call back later or Maybe** → "In 1 hour" → Save **without dialling**. The
  card shows the time (optimistic patch), then the promised background re-read wipes it.
- **expected:** the saved callback time persists, and v1's "Callback booked" filter finds the family.
- **actual:** the time vanishes; the filter returns nothing for every callback logged without a dial.
- **fix:** a new migration restoring `coalesce(gg.callback_at, c.next_callback_at)` (plus the
  adult/child columns) in `v_rsvp_queue`. `src/lib/supabase/database.types.ts:3260` confirms the live
  shape.

#### M11 — After the last save, a failed queue read says every family has already been called

- **where:** `src/app/(staff)/[eventCode]/rsvp/next/page.tsx:30`; `rsvp/status/page.tsx:42` (empty state
  at `:72`)
- **what:** both reads destructure only `{ data }` and drop `error`; `null` → `/rsvp/next` redirects to
  `/rsvp/status`, which renders "Nothing waiting to call — Every family has been called, or the list is
  empty."
- **repro:** bad Wi-Fi, save any outcome, let the next read fail once.
- **expected:** a load-failure state with retry.
- **actual:** the caller believes the 238-family list is finished and stops working.
- **fix:** check `error` in both and show an `ErrorState` with retry.

#### M12 — The auto-call board treats a failed read as an empty event, and loses rounds silently

- **where:** `src/app/(staff)/[eventCode]/rsvp/campaigns/page.tsx:26` / `:47`;
  `src/lib/actions/campaigns.ts:95`; `src/components/rsvp/CampaignBoard.tsx:77`
- **what:** the guest-count `error` is dropped (`?? 0`) → `guestCount === 0` renders "No families to
  call yet — Import the guest list first." Separately, the `rsvp_campaigns` insert in `ensureCampaigns`
  ignores its `{ error }` → returns `[]` → no round card at all (no "Start calling", no message, no way
  to create rounds).
- **repro:** an expired code token with a live cookie (the exact case `QueueBoard.knownGroupCount`
  exists for).
- **expected:** the refused-read error state, and a surfaced insert failure.
- **actual:** a false "import the guest list" instruction, and a screen with no control on it.
- **fix:** keep the count error and render the error state; check the insert error and surface it.

#### M13 — The auto-call notice always says "Call started"

- **where:** `src/lib/actions/outbound.ts:53` (shown at `CampaignBoard.tsx:73`)
- **what:** `body.message ?? body.started ? 'Call started' : 'Job queued'` parses as
  `(body.message ?? body.started) ? … : …`, discarding any non-empty `body.message`.
- **expected / fix:** `message: body.message ?? (body.started ? 'Call started' : 'Job queued')`.
- **actual:** every notice claims a call started, including a queued job that never dialled.

#### M14 — Commit is disabled with no explanation when a pax field is not a whole number

- **where:** `src/components/review/ReviewPanel.tsx:174` (`canCommit`), summary at `:418`;
  `invalidNumbers` is computed at `:168` and never rendered
- **repro:** Edit Confirmed pax → `2.5` → Done → decide every field.
- **expected:** the screen names the bad field.
- **actual:** the summary says "Every field decided", the primary stays disabled, and no reason appears
  anywhere — the reviewer is stuck.
- **fix:** render `invalidNumbers` in the same red block as `clearAttempts`.

### Rooms, allocation and check-in

#### M15 — A failed room read is presented as an empty event

- **where:** `src/lib/actions/rooms.ts:107` and `:464`
- **what:** `readAllocationData` destructures only `.data` from all three reads and `readRoomsGrid` only
  from all five — the Supabase `error` is never inspected, so a transport/RLS/timeout failure returns an
  empty dataset with HTTP 200.
- **repro:** read the code: `readAllocationData` → `planRoomAllocation` returns
  `{ok:false, error:'No rooms have been added to this event yet.'}` (`rooms.ts:1351`).
- **expected:** a load failure with retry (R6).
- **actual:** the board says "No rooms on this event yet" with an **"Add rooms"** button, the Waiting
  tab says "Add the rooms first", and the v1 suggest panel says "Every confirmed family already has a
  room." On a real event with 168 rooms and 14 unplaced families, staff are told to create rooms that
  already exist.
- **fix:** check every read's `error` and return a failure result the screens render as an error state.

#### M16 — Check-in lists one row per **assignment** but writes one check-in per **family**

- **where:** `src/app/(staff)/[eventCode]/hospitality/checkin/CheckInClient.tsx:128` (rows per
  assignment), `:320` (`Progress … total={expected}`), `:315` (`expected = rows.length`)
- **what:** a family placed across two rooms has two active assignments, so it renders twice, but
  `check_in_room` stamps only the group's **oldest** assignment
  (`supabase/migrations/20260806160000_event_day_state.sql:157`). Tapping "Checked in" on the second
  room's row patches that row optimistically, the RPC returns the *other* assignment, `reconcile`
  matches nothing, and the post-write invalidate flips the row back to "Not yet" — with no message.
- **repro:** place a 6-person family across two rooms, then on Check-in tap the row for the second room
  → **Checked in**. A second later the row reads "Not yet" again.
- **expected:** one row per family (or a check-in that covers all the family's rooms), and a bar that
  reads families, not assignments.
- **actual:** the same family appears twice, one of the two can never be checked in, and the tap reports
  success then silently reverts.
- **fix:** group the rows by `group_id` (label extra rooms in the meta line) or make the action cover
  every active assignment; base `expected`/`done` on distinct groups.

#### M17 — A failed auto-fill commit is completely silent while the review screen is open

- **where:** `src/app/(app)/v2/[eventCode]/hospitality/rooms/RoomsBoard.tsx:434` (the review's early
  return) vs `:470` (the only place `planError` is rendered), fed by the catch at `:356`
- **what:** `confirmPlan`'s catch sets `planError`, but the review branch returns before the banner
  block, and unlike the success path it does not clear `plan`.
- **repro:** start Auto-fill, kill the network, tap **Confirm**.
- **expected:** a visible failure on the review screen with a retry.
- **actual:** the button returns from "Saving…" to "Confirm 14"; nothing else happens. Staff tap again,
  unsure whether anything saved.
- **fix:** render the error banner inside the review branch (pass `planError` into `AllocateReview`), or
  `setPlan(null)` before `setPlanError`.

#### M18 — The extra-bed ceiling is `capacity + 1` while every screen counts against `capacity`

- **where:** `src/lib/actions/hotels.ts:249` (also `:288`, `:325`),
  `src/lib/actions/import-hotels.ts:176`, surfacing at
  `.../hospitality/rooms/_components/PlaceFamilySheet.tsx:98` vs `:205`
- **what:** every room created or edited by the app gets `max_capacity = capacity + 1`, and the DB
  trigger enforces `max_capacity` (`20260816150000_room_guard_row_lock.sql:79`), so one guest over the
  stated bed count needs no override and no reason. Meanwhile the sheet's engine (`suggestRooms`) ranks
  against `maxCapacity` while its own list marks rooms by `freeBeds` (= `capacity − occupied`).
- **repro:** a 2-bed room holding 2 guests (max_capacity 3); place a 1-guest family from Waiting. The
  maroon "Best fit" card names that room, and the list directly beneath shows the same room as **Full**
  in red.
- **expected:** one ceiling; a room the app calls Full must not be offered as the best fit.
- **actual:** the app recommends a room it simultaneously calls Full, and the placement succeeds with no
  override reason recorded.
- **fix:** read `max_capacity` in the sheet's fit arithmetic (or drop the `+ 1` in
  `createRooms`/`updateRoom`/`commitHotelImport`) so one number decides both.

#### M19 — The capacity refusal tells staff to "add a written reason", but no override control exists in v2

- **where:** `src/app/(app)/v2/[eventCode]/hospitality/rooms/RoomsBoard.tsx:156`;
  `src/lib/errors.ts:145`
- **what:** `roomGuardMessage('capacity', …)` returns "…choose another room, or add a written reason to
  put them in anyway." The v3 board has no override UI — `assignGuestsToRoom` takes no
  `overrideReason` — and the only override sheet in the codebase is the v1 grid's, which a v2 session
  never reaches.
- **repro:** on the Rooms board open a Waiting family, tap a room that is tight for them.
- **expected:** the refusal names an action that exists on this screen.
- **actual:** it instructs an action with no control behind it, and staff go looking for it.
- **fix:** pass a capacity message that offers only "choose another room / split them", or add the
  reason field to `assignGuestsToRoom` and render it.

#### M20 — The room-creation picker shows the raw database error and offers no way forward

- **where:** `src/app/(staff)/[eventCode]/hospitality/rooms/new/page.tsx:46`
- **what:** the failure branch renders `description={error.message}` inside an `EmptyState` with **no
  retry action** (contrast every v3 screen's `ErrorState … onRetry`).
- **expected:** a house sentence plus a Try-again control (R6, R3).
- **actual:** "permission denied for table hotels" / "TypeError: fetch failed" with no next step, on the
  only route that creates rooms, reachable from both trees.
- **fix:** swap `error.message` for the house sentence and add a retry.

#### M21 — Room creation can hang on "Creating…" forever, and its range mode is unbounded

- **where:** `src/app/(admin)/admin/events/[eventCode]/hotels/[hotelId]/rooms/_components/RoomCreateForm.tsx:50`;
  `src/lib/actions/hotels.ts:241` and `:264`
- **what:** `handleSubmit` awaits `createRooms` with no `try/finally`; if the server action **rejects**
  (dropped Wi-Fi mid-request) `setSubmitting(false)` never runs and every control stays disabled on
  "Creating…". Independently, range mode builds a row for every `n` from `start` to `end` with no cap
  (the `MAX_RANGE_SIZE` guard exists in `src/lib/rooms/parse.ts:77` and is never used here) and inserts
  them one round trip at a time; on a non-duplicate failure it returns
  `{ok:false, error:'Room 217: <raw pg message>', created, skipped}` and the form drops `created`, so
  rooms that did land are never reported.
- **repro:** type First 1 / Last 2000 (the inputs have no max) and submit on venue Wi-Fi.
- **expected:** a bounded range with the friendly message `expandRoomRange` already produces, a
  `try/catch/finally`, and "N rooms were added before this failed".
- **actual:** a stuck "Creating…" or a raw Postgres sentence with no count, and an unknown number of
  rooms created.

### Hampers and proofs

#### M22 — The proof screen's "Received by (name)" field is captured and silently discarded

- **where:** `src/app/(staff)/[eventCode]/hospitality/deliveries/[deliverableId]/DeliveryDetail.tsx:127`
  (state), `:354` (the input), `:273` (`submitProof({ eventId, deliverableId, dataUrl })`)
- **what:** the operator types who took the hamper; `receivedBy` is never read again. `submitProof` takes
  no such field and `delivery_proofs` has no column for it.
- **repro:** take a photo, type "Ravi (room service)" in the optional field, Confirm delivery.
- **expected:** either the field is stored, or it is not offered.
- **actual:** the name is thrown away, and because the proof is insert-only it can never be added later
  — not by an admin, not by the service role.
- **fix:** either add a `received_by` column and thread it through `submitProof` (a migration, since
  proofs are insert-only), or remove the input. Do not leave a field that does nothing.

#### M23 — A proof queued while the phone thinks it is **online** never syncs

- **where:** `src/components/native/OfflineBanner.tsx:54` (the only caller of `flushProofQueue`);
  `src/lib/proof-queue.ts:91`
- **what:** the flush lives in `useEffect(..., [online])` and returns early unless online, so it runs
  only on an offline→online **transition**. A proof queued by a transport failure — "Wi-Fi associated
  and carrying nothing", the failure mode CLAUDE.md §11b documents — is never retried while the app
  stays open, and the banner reads "N changes queued — will sync when online" while online.
- **repro:** queue a proof with the link associated-but-dead, keep the app open or background/foreground
  it; nothing uploads until an app relaunch or a real network flip.
- **expected:** the queue drains on its own.
- **actual:** the proof sits in IndexedDB indefinitely.
- **fix:** mirror `useOptimisticAction`'s drain (mount + `visibilitychange` + timer); `flushProofQueue`'s
  per-entry backoff already paces retries.

#### M24 — Proofs, call completions and voice notes have no working retry schedule

- **where:** `src/lib/proof-queue.ts:91` (no backoff despite the doc at `:20` and the comment at `:88`),
  `src/lib/call/outbox.ts:73` (`bumpQueuedAttempt` increments `attempts`, which nothing reads),
  `src/components/call/CallScreen.tsx:176`, `src/components/voice-note/VoiceNoteRecorder.tsx:121`
- **what:** only `write-queue.ts:172` actually honours backoff; the other three queues attempt everything
  on every trigger, and their only trigger is mount plus the `online` event. The write-queue was
  explicitly fixed for the "associated but dead" case with a `visibilitychange` drain
  (`useOptimisticAction.ts:206`); that fix was not applied to the three older queues.
- **repro:** on associated-but-dead Wi-Fi (`navigator.onLine` stays true), photograph a hamper: the
  upload fails and the proof queues. `online` never fires again, so the photo is retried only on the next
  full app launch.
- **expected:** retry on foreground/visibility with growing backoff, and a visible "needs attention"
  surface.
- **actual:** no retry until relaunch, no backoff, `attempts` is dead data, and `stuckProofs` renders
  only on `/debug`.

### Travel and fleet

#### M25 — "Back to fleet" after committing a plan links with the event **id**, not the code → 404

- **where:** `src/app/(staff)/[eventCode]/logistics/LogisticsClient.tsx:362`
- **what:** `href={`/${eventId}/logistics/fleet`}`. Routes resolve the first segment with
  `resolveEventByCode`, so a uuid 404s; the sibling link at `:190` correctly uses `eventCode`.
- **repro:** Travel → Trips → commit a plan → **Back to fleet**.
- **expected:** the fleet screen.
- **actual:** the not-found page for the whole event route — a dead end out of a completed job (R3).
- **fix:** use `eventCode`.

#### M26 — "Commit plan" is not a transaction and not idempotent; a retry duplicates trips

- **where:** `src/lib/actions/logistics.ts:285` (vehicles flipped at `:303` with the update's error
  discarded; early returns at `:330` / `:344`); `LogisticsClient.tsx:116`, `:355`
- **what:** the docstring says "one transaction"; it is a sequence. Trip 1 can commit and trip 2 fail and
  the action still returns `ok:false`. `handleCommit` keeps the stale proposal and re-enables the button,
  so the retry re-inserts trip 1 and its passengers — nothing dedupes on `travel_leg_id`.
- **repro:** four families on one vehicle, a transient failure on the third insert, Commit → error →
  Commit again.
- **expected:** all-or-nothing, and a retry that never duplicates a family.
- **actual:** trip 1 exists twice; those families are on two vehicles and the driver sheets carry two
  sheets for one car. A total failure still marks vehicles `assigned`, so the fleet reads "On a trip".
- **fix:** one RPC/transaction, reload the planner after the call, and check the vehicles update's error.

#### M27 — A failed travel/fleet read renders as "Nothing to plan" / "No vehicles in the fleet"

- **where:** `src/lib/actions/logistics.ts:81` and `:125`; `src/lib/actions/fleet.ts:44`
- **what:** these reads destructure only `data` and discard `error`; an error becomes `[]`, which the
  screens present as fact — `LogisticsClient` prints "No vehicles in the fleet…" with "Add vehicles to
  the fleet", and `FleetBoard.tsx:140` shows "No vehicles in the fleet / Add them here".
- **repro:** kill the link, open Travel → Trips or Travel → Fleet, refresh.
- **expected:** "Could not load the fleet. Try again."
- **actual:** an empty-state wall whose action invites **duplicate data entry**: a runner who believes it
  adds the same cars twice.
- **fix:** return the error (as `readDeliveryRun` does) and render the error branch; never hand an empty
  array to a screen whose empty state is an instruction to create rows.

#### M28 — The Travel board drops every leg when the **guest** read fails, and calls that "No arrivals on file"

- **where:** `src/app/(app)/v2/[eventCode]/logistics/_components/TravelBoard.tsx:154` (only `legErr` is
  checked, `:162`; `groupById` empty, `:183`; legs filtered away, `:185`); the empty state at `:363`
- **what:** four of the five reads (`guest_groups`, `room_assignments`, `rooms`, `hotels`) have errors
  discarded. If `guest_groups` fails while `travel_legs` succeeds, every leg is filtered out and
  `rows.length === 0` renders "No arrivals on file — Arrivals appear once the calling team has logged a
  flight or train."
- **expected:** an error state naming the failure (the `ErrorState` branch already exists at `:297`).
- **actual:** a confident claim that the event has no arrivals, on the board used to meet families.
- **fix:** check every result's `error` and throw, or show partial-failure copy when
  `legs.length > 0 && rows.length === 0`.

#### M29 — "Mark departed" fails silently on the v1 departures board

- **where:** `src/app/(staff)/[eventCode]/logistics/departures/DeparturesBoard.tsx:131`, failure branch
  at `:138` (`console.error(result.message)`)
- **what:** `markDeparted`'s error goes to a console nobody can open on a handset; `pendingGroup` clears,
  the button returns and the row stays undeparted. The tap appears to do nothing (R6).
- **repro:** mark a family with no departure leg — the RPC answers "No departure leg is on file for this
  family — add their travel details first".
- **expected:** that sentence on screen.
- **actual:** silence, and repeated taps.
- **fix:** render `result.message` in an alert paragraph (the v2 `TravelBoard` already does this via
  `mark.lastError`); reload only on success.

#### M30 — The walk-up departure form is unreachable once any departure exists

- **where:** `src/app/(app)/v2/[eventCode]/logistics/departures/page.tsx:372` — the "Record a walk-up"
  link is rendered **only** inside the `rows.length === 0` empty state.
- **what:** the page's own comment says a walk-up is "where a staff member who has just been told a
  flight time needs to be". The moment the event has one departure leg on file, that control does not
  exist anywhere: there is no other link to `/logistics/departures/new` in the app.
- **repro:** with one departure on file (the normal state from day one), open Travel → Departures and
  look for a way to add a departure.
- **expected:** a permanent, quiet entry point (the page's own argument against it — "a board that has
  rows on it is a board someone is working" — is not a reason to make the job unreachable).
- **actual:** the form can only be reached by typing the URL. A family at the desk telling staff they are
  leaving cannot be recorded.
- **fix:** put the control in the Departures board's filter row, or in the sheet of the family, or as a
  `BottomBar` secondary. Not only in the empty state.
- **spec:** `e2e/flows/e-travel.spec.ts` → `(e4)` drives the form by its own address and says why.

#### M31 — A walk-up search that finds nothing clears itself with no message

- **where:** `src/app/(staff)/[eventCode]/logistics/departures/DeparturesClient.tsx:73`, empty result at
  `:78`; the search bar only renders in `idle`, `:154`
- **what:** when `searchDepartureGroups` returns `[]` the phase resets to `idle`, re-rendering an empty
  search box and nothing else. `searchDepartureGroups` also discards every read error
  (`src/lib/actions/departures.ts:43`, `:54`, `:61`), so a genuine failure produces the same nothing.
- **repro:** Travel → Departures → Record walk-up, search "Sharma" when the row reads "Sharma family".
- **expected:** "No family matches '…' — try part of the name, or the room number."
- **actual:** it looks like Search did nothing, and staff tap it again.
- **spec:** `e2e/flows/e-travel.spec.ts` → `(e3)`, which asserts a no-match sentence appears.

#### M32 — "Remove from the fleet" is an irreversible hard delete with no confirmation and no undo

- **where:** `src/app/(app)/v2/[eventCode]/logistics/fleet/FleetBoard.tsx:243`;
  `src/app/(staff)/[eventCode]/logistics/fleet/FleetClient.tsx:271`;
  `src/lib/actions/fleet.ts:117`
- **what:** one tap runs `delete from vehicles`. The label reads as detaching, the button is not
  danger-styled, and nothing can restore the row or its odometer/assignment history. R5 permits a
  confirm precisely for the irreversible case.
- **repro:** Fleet → tap a vehicle → **Remove from the fleet**.
- **expected:** a confirm naming the vehicle and what goes with it, or the reversible route.
- **actual:** the record is gone, along with its history.
- **fix:** use the existing `vehicles.status = 'unavailable'` as the reversible action, and put the hard
  delete behind a confirmation naming the registration number.

### Guests, import, export and help

#### M33 — Excel **export** has no door at all in the v3 shell

- **where:** `src/lib/sections/v3.ts:53` (`V3_BAR` drops `guests`);
  `src/app/(staff)/[eventCode]/page.tsx:296` (the only inbound link to `/guests/export`)
- **what:** no v3 tab, no `SectionTabs` (the v2 shell renders none), no `AccountMenu` entry. Import is
  reachable only while the event is still empty (Today's admin-only empty-state card).
- **repro:** `NEXT_PUBLIC_UI=v2`, admin on an event with guests → there is no control that reaches
  export.
- **expected:** SPEC-V3 §4 keeps import/export reachable.
- **actual:** the export job cannot be started; the URL must be typed. On a handset inside the APK there
  is no URL bar.
- **fix:** add an entry where the reskin puts secondary jobs (Today, or the account menu), or keep
  `guests` in the management nav model.

#### M34 — The post-import summary never renders

- **where:** `.../guests/import/_components/PreviewStep.tsx:95` and
  `.../import/_components/ImportPreview.tsx:132`
- **what:** on success `setCommitSummary(res.summary)` is followed by `onCommitted()` (→
  `handleStartOver` → `setOutcome(null)`), unmounting `PreviewStep` in the same commit, so the
  `CommitSummary` branch at `:211` can never show.
- **repro:** confirm a real import — the screen returns to "Choose the calling list" with no counts.
- **expected:** inserted/updated/skipped counts and a next step.
- **actual:** staff cannot tell whether 238 families were written; the likely response is to upload
  again. (`T0.2` in the acceptance suite already works around this by asserting the database instead of
  the screen.)
- **fix:** leave the summary up (drop `onCommitted()` on success) or render it in `ImportPreview` after
  the reset.

#### M35 — The Help screen (which carries the "do not reload" line) is unreachable for every runner

- **where:** `src/app/(app)/v2/[eventCode]/page.tsx:112` (the department redirect) and `:294` (the only
  Help link, at the foot of Today)
- **what:** Help lives only at the foot of Today, and `v2DepartmentHome` redirects every `event_team`
  session **with** a department away from Today (logistics/hospitality/hamper/production). SPEC-V3 §3
  also removed Help from the header. The screen carries `V2_OFFLINE_NOTE` — CLAUDE.md §11b's
  operational mitigation, the one sentence staff are supposed to be told in these words.
- **repro:** a hospitality runner looks for "How this app works" — it does not exist on any screen they
  can reach.
- **fix:** put the link on the department homes, or restore it in `ScreenHeader`/`AccountMenu`.

### Messaging, hotels and admin

#### M36 — The message-status webhook writes nothing, answers 200, and verifies no signature

- **where:** `src/lib/actions/messages.ts:707`; `src/app/api/messages/webhook/route.ts:19`
- **what:** `handleWebhook` builds the client with `createClient()` — the cookie-based **anon** client —
  and every `messages` policy is `for update to authenticated`
  (`20260814140000_remove_staff_identity_gate.sql:58`), so PostgREST filters the row out, returns 204
  with `error: null`, and the handler returns 200. The route also has no HMAC/signature verification
  (the comment claims `parseWebhook` validates; `parseBspWebhook` only checks payload shape), and its
  `catch {}` returns 200 for an unparseable body.
- **repro:** POST any body that parses as a Meta status to `/api/messages/webhook`.
- **expected:** the status written with a service-role credential (or a definer RPC), signature
  verified, and a non-2xx when the write genuinely fails.
- **actual:** delivery/read status is never recorded anywhere, and forged callbacks are accepted
  silently.
- **fix:** move the update behind a service-role client (or a definer RPC), verify the signature header
  before parsing, and return the real status.

#### M37 — "Arriving today" / "Departing today" recipient filters send to **every confirmed family**

- **where:** `src/lib/actions/messages.ts:86`
- **what:** both cases reduce to `query.eq('rsvp_status', 'confirmed')` with a comment admitting it is
  "simplified"; no `travel_legs.travel_date` predicate exists. The UI labels them as today.
- **repro:** admin → Messages → filter "Arriving today" → Preview; the count equals all confirmed
  families.
- **expected:** only families with an arrival (departure) leg on the selected day.
- **actual:** (once B2 is fixed) the arrival-instructions message goes to every confirmed family,
  including those arriving in three days.
- **fix:** join `travel_legs` on `event_id` + `direction` + `travel_date = <IST today>` and intersect
  with the confirmed groups.

#### M38 — Manual "Prepare messages" copies templates with `{{placeholders}}` unresolved

- **where:** `src/lib/actions/messages.ts:419`
- **what:** the replacement map contains only `head_name`; any other key falls through to
  `` `{{${key}}}` `` and is written into `messages.body` and returned to the UI verbatim. The seeded
  templates use `{{event_name}}`, `{{hotel_name}}`, `{{room_number}}`, `{{arrival_date}}`, `{{pax}}`,
  `{{driver_name}}` (`20260731000700_seed.sql:26`).
- **repro:** admin → Messages → Prepare messages → `stay_confirmed` → Generate.
- **expected:** every placeholder resolved, or the template refused with the variables it needs.
- **actual:** the preview card and "Copy all" read literally
  `{{head_name}}, your stay is confirmed at {{hotel_name}}, Room {{room_number}}` — and the coordinator
  pastes that to the guest.
- **fix:** build the variable map from the group/template, and refuse to emit a body that still matches
  `/\{\{\w+\}\}/`.

#### M39 — Hotel import silently creates duplicate hotels

- **where:** `src/lib/actions/import-hotels.ts:130`
- **what:** the "does this hotel already exist" lookup destructures only `{ data: existing }` and ignores
  `error`, so a failed read looks like "does not exist" and inserts a new hotel. It also matches
  `.eq('name', hotelKey)` byte-exactly, so `"Grand Plaza "` from a sheet creates a second hotel — the
  exact trailing-space twin `createHotel` was written to catch (`src/lib/actions/hotels.ts:84`).
- **repro:** import a CSV whose Hotel Name cells have a trailing space.
- **expected:** a read failure refuses the import; duplicates are detected with the same
  `normaliseHotelName` comparison the manual path uses.
- **actual:** two rows with the same visible name, each with its own copy of the rooms, and the preview's
  "duplicate rows are skipped" promise is false.
- **fix:** check `error` on the lookup and abort; compare with a shared `normaliseHotelName` helper.

#### M40 — Hotel import discards the per-row failure reasons it computed

- **where:** `src/app/(admin)/admin/events/[eventCode]/HotelImporter.tsx:58`
- **what:** `commitHotelImport` returns `failures: { rowNumber, reason }[]` (`import-hotels.ts:207`), but
  the client keeps only `result.summary`, and `ok: true` is returned even when every row failed.
- **repro:** import a sheet that makes rows fail. The done card says "0 created, 0 skipped, 12 failed"
  with no rows, no reasons and no retry.
- **expected:** the failing row numbers and reasons, and a way to fix and re-import.
- **actual:** a dead end for a total failure.
- **fix:** keep `result.failures` in state and list them; treat `inserted === 0 && failed > 0` as a
  failed import rather than "Import complete".

#### M41 — Server actions called without `try/catch` leave submit controls disabled forever

- **where:** `.../hotels/[hotelId]/rooms/_components/RoomCreateForm.tsx:50`; the same shape in
  `RoomEditClient.tsx:30`, `HotelDetailClient.tsx:87`, `ArchiveEventCard.tsx:52`, `SendClient.tsx:87`,
  `LogClient.tsx:59`, `HotelImporter.tsx:56`
- **what:** each sets a pending flag, awaits the action with no `catch`, and clears the flag only on the
  normal path. A dropped connection makes the server action **reject** rather than return, so
  `disabled={submitting}` stays true.
- **repro:** drop the network mid-request on any of those screens. The button stays "Creating…" /
  "Sending…" forever, with no error and no way to retry — and the write may well have landed.
- **expected:** a rejection clears the pending state and says the write may have gone through (the
  pattern `HotelCreateForm.tsx:102-117` already implements).
- **actual:** a permanently dead form; the natural retry is a reload, which §11b forbids.

#### M42 — List reads ignore `{ error }` and render as "nothing here"

- **where:** `src/lib/actions/messages.ts:635`; `src/lib/actions/dashboard.ts:225`
- **what:** `readMessageLog` destructures only `{ data }` and returns `[]` on failure, which
  `LogClient.tsx:119` renders as the literal sentence "No messages yet." `readTodayLegs` does the same,
  rendered as "Nothing scheduled for Today." Both are assertions about the event, not about the request.
- **repro:** cause the `messages` read to fail on `/admin/events/<code>/messages/log`.
- **expected:** a distinguishable load-failure state with retry, as `readHotelList` already does.
- **actual:** a failed read is shown as a fact about the data; the admin concludes no messages were sent.

#### M43 — Harvest debug: every discovered folder is pinned at "Loading…" forever

- **where:** `src/app/(admin)/admin/harvest-debug/HarvestDebugClient.tsx:85`; the render branch at `:228`
- **what:** `handleDiscover` seeds `folderListings` with `loading: true` for each discovered folder and
  nothing ever calls `handleListFolder`.
- **repro:** admin → Harvest debug → Grant permission → Discover. Every row shows "Loading…"
  permanently; only a manual "List files" clears it.
- **expected:** the listing loads automatically, or the row shows "List files" without a false pending
  state.
- **actual:** a spinner that never resolves; the admin cannot tell "still working" from "found nothing".
- **fix:** seed with `loading: false`, or call `handleListFolder(folder)` for each discovered path.

### Cross-cutting

#### M44 — "Today" on the admin dashboard is computed in **UTC**, so before 05:30 IST it shows yesterday

- **where:** `src/app/(admin)/admin/events/[eventCode]/DashboardClient.tsx:41`
  (`new Date().toISOString().slice(0, 10)`), used at `:46` as the argument to `readTodayLegs`;
  `TodayPanel.tsx:44`
- **what:** the operator is in IST (UTC+5:30) but the string is the UTC calendar date. Between 00:00 and
  05:30 IST these differ by one day, and `todayStr` is the **query argument** — so the panel lists the
  wrong day's movements and the header shows a date that is not today.
- **repro:** at 01:00 IST on the event morning, open the event dashboard.
- **expected:** the IST calendar date, via the local-parts formatter `TravelBoard.tsx:600` and
  `DriverRoster.tsx:40` already use.
- **actual:** yesterday's legs under a "Today" heading for the first 5.5 hours of every day — exactly
  the window an event-morning desk is working.
- **fix:** replace both occurrences with `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`.

#### M45 — `arrivals_today` / `departures_today` use the **database's** UTC date

- **where:** `supabase/migrations/20260809120000_board_view.sql:42` (also `:81`; legacy
  `20260731000600_views_rpc.sql:151`)
- **what:** the views compare `travel_date = current_date`, which is the session date in the DB's
  TimeZone — UTC on Supabase. Same 00:00–05:30 IST window as M44, but this one also feeds the
  "N arrivals have no car" row and the home screen's counters.
- **repro:** read the code / query the view before 05:30 IST.
- **fix:** `(now() at time zone 'Asia/Kolkata')::date` in the view definitions.

#### M46 — `tel:` links dial the **raw stored number** instead of the shared normaliser

- **where:** `src/app/(app)/v2/[eventCode]/logistics/_components/TravelBoard.tsx:515`;
  `.../logistics/sheets/DriverSheetsBoard.tsx:199` and `:203`; `.../logistics/fleet/FleetBoard.tsx:232`
  and `:235`; `src/app/(staff)/[eventCode]/logistics/arrivals/ArrivalsClient.tsx:554`;
  `.../logistics/fleet/FleetClient.tsx:248`; `.../hospitality/rooms/RoomsGridClient.tsx:961`
- **what:** `href={`tel:${raw}`}` on `guest_groups.primary_mobile` / `vehicles.driver_mobile` verbatim.
  `src/lib/phone.ts` exists for exactly this (`telHref` → `tel:+91XXXXXXXXXX`; `dialTarget` refuses to
  guess), and `TravelBoard` even formats the **label** with `formatMobile` — so the screen can show
  "98765 43210" while the link carries spaces or a trunk zero. `driver_mobile` is free text; only
  `drivers.mobile` is normalised (`fleet.ts:315`).
- **repro:** save a driver as "+91 98765 43210", open the driver sheet, tap the number.
- **expected:** dials 9876543210; a number that will not reduce to a real one renders as no link.
- **actual:** a `tel:` URL some Android dialers reject or mis-parse, with no "no dialable number" state —
  and the rest of the app refuses to dial that same number.
- **fix:** build every href from `telHref()`/`dialTarget(...)`, every label from `formatMobile()`, and
  render the null case explicitly.

#### M47 — Raw Postgres and storage error text is rendered to staff

- **where:** `src/app/(staff)/[eventCode]/hospitality/deliveries/[deliverableId]/DeliveryDetail.tsx:145`
  (rendered at `:180`); `src/lib/actions/voice-note.ts:98` and `src/lib/voice-note/upload.ts:74`
  (rendered by `VoiceNoteRecorder.tsx:263`/`:502`); `src/lib/actions/campaigns.ts:188`/`:209`;
  `src/app/(app)/v2/[eventCode]/hospitality/rooms/RoomsBoard.tsx:429` (as the error heading);
  `src/lib/actions/import.ts:238`, `src/lib/actions/export.ts:53`,
  `.../hospitality/rooms/new/page.tsx:46`
- **what:** these paths interpolate `error.message` / `insertError.message` / `uploadError.message` into
  the user-facing string and render it verbatim. They are **returned** values or direct browser-client
  reads, not thrown server-action errors, so Next.js does not mask them.
- **repro:** open a delivery detail while RLS refuses the nested join → `permission denied for table …`.
  Record a voice note without a staff identity → `new row violates row-level security policy for table
  "call_recordings"`. Both land in a red box on a staff screen.
- **expected:** UX-RULES R6 — what happened, what to do now, who to tell. Never a SQLSTATE.
- **actual:** constraint names, table names and PostgREST text, on the screens whose whole purpose is to
  tell a runner their work is safe.
- **fix:** route all of them through `friendlyDbError`/`friendlyRpcError` (as the room and call paths
  already do) and keep the raw text for the `captureDiagnostic` payload only.

#### M48 — `SessionBridge` stops rehydrating the session after the first navigation

- **where:** `src/components/native/SessionBridge.tsx:82` (`if (!hydratedRef.current)`), `:87` (the
  cleanup removes the `appStateChange` listener), `:55`/`:58` (the `sessionStorage` marker)
- **what:** the effect is keyed on `[router, pathname]`. Every client-side navigation runs the cleanup,
  which removes the Capacitor listener; the body then early-returns because `hydratedRef.current` is
  already true, so the listener is never re-added. Separately, the `nuvent_session_restored` marker is
  set on the first successful restore and never cleared, so every later restore in that JS session
  returns early.
- **repro:** log in on a handset, navigate from the queue to a call screen (one client-side navigation),
  place a call so the WebView is backgrounded and remounted. Neither the resume listener nor the
  rehydrate path can run.
- **expected:** the resume path restores the code-auth cookie after any remount, for the whole session —
  the Tier-0 failure this module exists to close.
- **actual:** both mechanisms are one-shot. After the first navigation the only recovery from a lost
  cookie is re-entering the access code, mid-shift.
- **fix:** register the listener in its own effect with an empty dependency array (or drop the
  `hydratedRef` gate), and clear the `sessionStorage` marker on a confirmed cookie loss.

#### M49 — `queuedCount` is the **whole-queue** total, so screens overstate the backlog

- **where:** `src/lib/mutate/useOptimisticAction.ts:140` (and the interface doc at `:84`);
  `.../rooms/RoomsBoard.tsx:424`; `.../checkin/CheckInClient.tsx:234`
- **what:** `queuedCount` is set from `queuedWriteCount()`, which returns `db.writes.count()` — the
  entire queue, across every kind and every screen. `RoomsBoard` then adds four hooks' values together,
  and `CheckInClient` adds two.
- **repro:** with no signal, make one room change on Rooms. It renders "4 room changes are saved on this
  phone". Two check-ins render "(2 waiting)" for two writes.
- **expected:** the number of writes actually waiting.
- **actual:** exactly 4× on the rooms board and 2× on check-in, and it counts writes queued by other
  events and other screens too.
- **fix:** count only this hook's `kind`
  (`db.writes.where('kind').equals(kind).count()`), or expose one global count and render it once.

#### M50 — The offline banner counts only the **proof** queue, so it says "0 changes queued" while other writes wait

- **where:** `src/components/native/OfflineBanner.tsx:51`/`:57` (`queuedProofCount`), `:60`, `:68`
- **what:** the one global, non-dismissible status surface reads `queuedProofCount()` and
  `flushProofQueue()` only. The other three IndexedDB outboxes (`eventops-write-queue`,
  `eventflow-call-outbox`, `eventflow-voice-notes`) are invisible to it.
- **repro:** queue a call outcome with no signal, then look at the top of any screen: "Offline — 0
  changes queued" while the outcome is queued and nothing has been sent.
- **expected:** R8 — the sync status of every write is stated honestly; the number is the real total.
- **actual:** the banner actively denies that queued writes exist, during a calling shift.
- **fix:** sum the four counts (or publish one shared "pending writes" store) and flush all four from the
  same trigger.

### Screens that tell the truth badly

#### M51 — The check-in screen's primary button is labelled **"Checked in"** — a status, not an action

- **where:** `src/app/(staff)/[eventCode]/hospitality/checkin/CheckInClient.tsx:498`
- **what:** the sheet's only commit reads "Checked in", directly under a heading that already shows the
  same words. A first-day runner cannot tell whether the family is already checked in or whether tapping
  will check them in. UX-RULES R1/R2: the primary action must be the largest, most obvious tappable
  control and its words must name the action.
- **repro:** open any family's sheet on the check-in board.
- **expected:** "Check in".
- **actual:** a past-tense status in the button's place. The neighbouring branch's button ("Check out")
  is correctly imperative, so the screen is also internally inconsistent.
- **fix:** relabel to "Check in".
- **spec:** `e2e/flows/c-checkin.spec.ts` accepts either wording on purpose, so fixing the copy does not
  break the flow.

#### M52 — `DeliveryDetail`'s failed read leaves "Loading…" forever, and its error branch is dead code

- **where:** `src/app/(staff)/[eventCode]/hospitality/deliveries/[deliverableId]/DeliveryDetail.tsx:171`
  vs the error branch at `:174`
- **what:** line 171 returns the spinner whenever `phase.name === 'loading' || !detail`. `load()` sets
  `phase = { name: 'error' }` and leaves `detail` null (`:143`), so the condition stays true and the
  "Could not load this delivery" card with **Try again** is unreachable.
- **repro:** open any hamper proof on a dead link.
- **expected:** the error card with retry.
- **actual:** a permanent spinner with no message and no control. The only recovery is a reload, which
  §11b tells staff not to do.
- **fix:** test the error phase before the `!detail` check — and route the raw `err?.message` it would
  print (`:145`) through `friendlyDbError` at the same time (see M47).

#### M53 — A proof screen failure tells the truth nowhere: `Loading…` and a raw message are the only two options

- see M47 (raw text) and M52 (unreachable branch). Listed separately because the two fixes are
  independent and a reader fixing one may believe they fixed "the proof screen".

---

## Minor

| # | Where | What | Fix |
|---|---|---|---|
| m1 | `.../rsvp/queue/QueueRow.tsx:112`, `src/components/call/CallScreen.tsx:950`/`:951`/`:559`, `.../rsvp/review/[extractionId]/page.tsx:73`/`:87`, `.../rsvp/review/page.tsx:192`, `src/components/voice-note/VoiceNoteRecorder.tsx:338`, `.../logistics/sheets/DriverSheetsBoard.tsx:215`, `.../logistics/departures/DeparturesClient.tsx:105`/`:194`, `src/app/(staff)/[eventCode]/logistics/LogisticsClient.tsx:338`, `.../hospitality/rooms/allocate/AllocateClient.tsx:224`, `.../guests/import/_components/UploadStep.tsx:70` | "PAX"/"pax" still on staff screens, including as a validation message ("PAX must be positive.") and in the import screen's own prose. UX-RULES R2 bans the word by name and ships it as the example. | "guests"; keep `PAX` only in Excel export headers. |
| m2 | `.../rsvp/queue/QueueRow.tsx:104`, `.../rsvp/unmatched/UnmatchedTrayClient.tsx:145` | A phone number rendered raw while every other screen uses `formatMobile`. | wrap both. |
| m3 | `.../rsvp/queue/InlineCaptureStep.tsx:309` with `src/lib/rsvp-log.ts:163` | The departure caption reads "Event end · 2026-12-25" for an event ending 24 Dec (the default departure is `endsOn + 1 day`) and prints raw ISO. | label it "Leaving on" and use `formatDate`. |
| m4 | `src/components/ui/Chip.tsx:46` (40px), `src/components/ui/SyncChip.tsx:31` (36px) | Two shared chips sit below the 44px tap floor. The `.tap` utility only sets `touch-action`, not a minimum height. | `min-h-11`. |
| m5 | `src/components/ui/Button.tsx:64` (`disabled:opacity-55`), `src/components/ui/Stepper.tsx:56` (`opacity-40`), `src/components/ui/WhatsAppButton.tsx:47` (`text-muted/40`) | A disabled control composites to ~2:1 — legible enough to pass WCAG's inactive-control exemption, not legible in a bright lobby, where it reads as a rendering glitch. | neutral surface + `text-muted`, no opacity on the text. |
| m6 | `.../logistics/sheets/DriverSheetsBoard.tsx:75` (v1 twin `DriverSheetsClient.tsx:74`) | `void navigator.clipboard.writeText(...)` discards the promise and flips the label to "Copied" unconditionally. On an http origin or an unfocused WebView the write rejects and the runner pastes an empty clipboard into WhatsApp. | await in try/catch, set `copied` on success only. |
| m7 | `src/lib/actions/events.ts:222` | The first access codes an event ever gets are inserted directly and never written to `code_reveal_log`, while the RPC path always logs. The most important reveal of an event's life is the one with no record. | insert the two log rows in `createEvent`. |
| m8 | `.../hospitality/rooms/allocate/AllocateClient.tsx:224`, `:222`/`:266` | Prints "6 PAX" and raw enum values (`bride`, `groom`, `family`, `couple`, `friends`). | "6 guests" + a side/type label map. |
| m9 | `.../hospitality/rooms/_components/AllocateReview.tsx:275` | The footer summary says "12 guests now have a bed" while the card directly above says "Nothing is saved yet." | "12 guests would get a bed · nothing is saved until you confirm". |
| m10 | `.../deliveries/[deliverableId]/DeliveryDetail.tsx:446`/`:450`, `:424` | "Device claim" and "Storage" are internal vocabulary on a screen whose reader is a runner, and the stub id is set at 10px. | "Phone's clock (not trusted)" / drop the storage path, or move both behind the debug screen. |
| m11 | `src/app/(admin)/AdminSidebar.tsx:105` (`hidden … md:flex`) + `AdminMobileNav.tsx` (no switcher) | The event switcher does not exist below `md`, though the layout comment says "Every admin screen carries the current event's name and a switcher." The name is covered by the event-context bar, so the risk is friction, not the wrong event. | add the switcher to the mobile More sheet. |
| m12 | `src/app/(staff)/[eventCode]/guests/GuestsClient.tsx:110` | `setSearching(true)` is never called (only `false` at `:101`/`:163`), so from the second search on there is no spinner and no dimming while the previous term's rows remain under a different term. The rewritten `guests/list/GuestsClient.tsx:151` fixed it; `/guests` still renders the old copy. | key the spinner off a per-request signal, or converge `/guests` onto the `list/` component. |
| m13 | `.../rsvp/queue/ProgressAndFilters.tsx`, `.../rsvp/queue/FamilyQueueList.tsx`, `.../rsvp/status/[groupId]/RsvpLogForm.tsx`'s sibling `ReviewForm.tsx` | Dead files nothing imports. They still lint, still get read by the next session, and one of them (`ProgressAndFilters`) duplicates filters that now live in `FamilyQueueSheet`. | delete. |

---

## Too many steps

Every flow the brief names, the taps the job itself needs, and where the extra ones are. **No number in
this table is measured** — the browser could not be launched in this session (`spawn EPERM`), so each is
derived from the flow's own step list and asserted as a ceiling by the spec named beside it. Re-measure
with `$env:NEXT_PUBLIC_UI='v2'; npx playwright test --project=flows` and tighten the budgets in
`e2e/flows/_lib.ts` to the real numbers: slack is what lets a regression through.

| Flow | Job | Taps the job needs | Spec / budget | Where the taps go, and how to cut |
|---|---|---|---|---|
| a1 | Call the next family | **2** | `(a1)` / 2 | Calls tab → dial. At budget. |
| a2 | Log the outcome "No answer" | **2** | `(a5)` / 2 | Calls tab → outcome. At budget. V12's budget is the same. |
| a3 | Log "Coming", 4 adults, a date, a time, a train | **8** | `(a2)` / 9 | Calls tab · Coming · **2 stepper taps** · date chip · time chip · mode tile · Save. **Cut: the adults stepper starts at `family.adults_confirmed ?? expected_pax`, so 4 adults costs 0–4 taps depending on data nobody can see.** Prime the stepper from `expected_pax` and show "invited: 6" beside it, or add a one-tap "all of them" chip. The time chip is a second tap for information the mode/date already dominates — consider merging date+time into one 4-option row of *when*, since the event has a known start date. |
| a4 | Log "Call back" with a time | **4** | `(a4)` / 5 | Calls tab · open the sheet · a chip · Save. **Cut: the four chips (1 hour / tonight / tomorrow / custom) each need a round trip through a sheet; a one-tap default ("Call back in 1 hour") on the outcome row beside the three buttons would make the common case 2 taps.** |
| b1 | Auto-fill and confirm a room plan | **2** | `(b1)` / 3 | Auto-fill → Confirm. At budget. **But the rooms board opens on the Waiting tab and `Auto-fill N families` lives in the `BottomBar`, so the control is on screen — good.** |
| b2 | Move a guest to another room | **5** | `(b2)` / 4 † | By room · room card · occupant · Move · target room. **Cut: the occupant must be tapped to reveal "Move" (the sheet's own comment defends this, correctly). One tap could be saved by making the target list the FIRST thing shown when there is only one thing to do, or by long-press-to-move.** |
| b3 | Pair two singles in one room | **3** | `(b3)` / 3 † | By room · room card · "Share with another single" · partner. The offer only appears for an exactly-one-single room with a free bed, which is the right rule. |
| c | Check a family in | **2** | `(c)` / 3 | the family's row → the one commit. Typing in the search is not a tap. |
| d | Mark a hamper delivered with a photo | **3** | `(d)` / 4 | Take photo → Choose photo → Confirm delivery. **This is the shortest irreversible action in the app, which is correct: the photo IS the record.** |
| e1 | Mark an arrival met | **2** | `(e1)` / 3 | the Now card's "Mark arrived" opens the sheet; the sheet's commit. **Cut: the Now card's own button could commit directly when the row is unambiguous (room present, no warning), and keep the sheet for a row tap only.** |
| e2 | Record a walk-up departure | **2** | `(e4)` / 3 | Search → Save departure. The other six fields are typing/selecting. **But the screen is unreachable by tapping once one departure exists (M30) — that is worse than a tap count.** |
| f | Find a guest | **3** | `(f0)` / 3 | the header's search button → the field → the result row. At budget, and matches V12's job 3. |
| g | A client reads a profile | **3** | — | the field → the row → (the sheet opens). The client's screen has no other job. |
| h1 | Switch event | **1** | `(h1)` / 2 | the event row. **On a phone there is no switcher (m11), so this is the only path — and it costs 1 tap from the events list, 2 if you are inside an event and have to go back first.** |
| h2 | Import preview | **1** | `(h3)` / 2 | Choose file. The preview itself is free. |

† `(b2)`/`(b3)` reset the counter AFTER the room is open, so those budgets describe the sheet's own job
rather than the navigation that found it. That is stated in the spec.

**The two flows worth cutting, in order:**

1. **The "Coming" capture (a3) is the most-used path in the product and the longest.** A caller on the
   phone has already asked everything; the screen then charges a tap per fact. The single biggest saving
   is turning the four chips of *when* into one row, and priming Adults from `expected_pax` with an
   explicit "all 6" chip.
2. **The walk-up departure (e2) is not a tap-count problem at all** — it is unreachable (M30). Fix that
   before optimising it.

---

## Stale documentation (documentation that will mislead the next session)

| # | Where | What |
|---|---|---|
| D1 | `docs/INTERACTION-CONTRACT.md:32` | Claims "no `UndoBar` component exists yet under `src/`". It does — `src/components/ui/UndoBar.tsx`, mounted by the v2 shell layout — and it is the whole mechanism behind R5. A reader planning work from this paragraph would build a second one. |
| D2 | `docs/INTERACTION-CONTRACT.md:32` | Claims the proof screen "does not yet explicitly warn the user that the action is irreversible". It does: `DeliveryDetail.tsx:369-371` renders "Once confirmed, this proof cannot be changed or deleted — not even by an admin." |
| D3 | `docs/INTERACTION-CONTRACT.md:33`, `:43` | The T2/T3 "Wrong" examples both cite `RsvpLogForm.tsx`'s `saving` flag and `loading={saving}`. The v3 queue path (`CallNext.tsx`) replaced that with `useOptimisticAction` and `Promise.all`, so the doc's central example no longer describes the screen most callers use. The v1 form still exists; the doc should say which. |
| D4 | `docs/INTERACTION-CONTRACT.md:115` | "State 4 (Content-plus-pending write) has NO component yet in this repository." `useOptimisticAction` + `UndoBar` + the queued-write banner are exactly that state, and `tests/optimistic-write.test.ts` covers them. |
| D5 | `docs/UX-RULES.md:50` | R6's approved "Right" example instructs staff to "reload the page", which directly contradicts `CLAUDE.md` §11b ("Wi-Fi drops → wait. Do NOT reload."). The v2 screens have already dropped the instruction; the rule's own example has not. |

---

## What this document could not verify

Stated plainly so a reader does not read a clean `git log` as a green board:

1. **Nothing was run in a browser.** `chromium.launch` fails with `spawn EPERM` under this session's
   sandbox. Every finding above is a code read; several (a cache key, a zod field, a UTC date, an
   operator precedence) are arithmetic and need no runtime, but the visual ones (B10's occlusion, the
   44px chips, the disabled contrast) want a real run to confirm.
2. **The tap budgets are derived, not measured.** See the table above.
3. **`e2e/flows/` imports `e2e/v12-taps.mjs` and `e2e/v12-seed.mjs`**, which write real rows to the
   test event with the service-role key. `openSession` refuses to run against `SMOKE_EVENT_CODE` or
   `NEXT_PUBLIC_LIVE_EVENT_CODE`, and resolves the event from the **access codes** rather than from
   `E2E_EVENT_ID` (which names a different event — `.env.test`'s documented trap).
4. **Two spec assertions are expected to fail today**, on purpose, because they are the regression
   tests for blockers: `(b0)` (the Rooms tab 404, B1) and `(e3)` (the silent no-match, M31). `(h3)`
   asserts geometry and will fail if B10 is real.
5. **The v1 tree was read but not audited to the same depth.** The brief asked for the v2 screens; the
   v1 tree is what `NEXT_PUBLIC_UI` unset serves, and a v1-only defect (such as `M29`'s silent
   "Mark departed") is still a live defect for anyone running the default build.
6. **No database-level review.** The RLS policies, triggers and views were read only where a screen's
   behaviour depended on them. Two findings are migration-shaped (`M10`, `M45`) and are called out as
   such.
