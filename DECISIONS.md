# DECISIONS.md

Non-obvious decisions, newest first. Per CLAUDE.md §14: record it here as it is
made, so the next session does not re-litigate it.

---

## 7 August 2026 — Guest list: windowed rendering + server-side search

### `/guests` is now a windowed client list, not a server-rendered card wall

The old page rendered every `client_guest_profiles` row as a card — 26s at 543
guests, of which the DB was ~5ms. It is now a client component (`GuestsClient`)
that loads all rows once (cached in `useStableData`) and renders a **windowed**
list: a fixed-height 76px row per family, only the rows near the viewport
mounted (+overscan). The scroll container is the full list height, so every
row is reachable by scrolling — the DOM never mounts them all. First paint
dropped from 26s to ~3s at 645 families.

The row is compact (name, family, room, phone, chevron) and links to the
family's RSVP record — the operational "profile". The rich variable-height
card detail lives there, not in the list.

### The list reads a new RPC (`search_guest_profiles`), NOT the view

`client_guest_profiles` is the deliberate data-minimization boundary for the
client role and has no `group_id` (so no profile link) and no phone. The list
needed both. So a new staff-facing RPC reads `guest_groups` → `guests` under
the caller's own RLS (a client login still gets zero rows — no new exposure),
returns the view shape + `group_id` + `phone`, and serves BOTH the full list
(p_limit large) and capped search (p_limit 50). The view is untouched.

### Search is server-side, trgm-indexed, and starts from `guest_groups`

Partial-match (`ILIKE '%term%'`) on head name, guest name, and primary mobile,
backed by `pg_trgm` GIN indexes (1800). Devanagari needs no special handling —
ILIKE is case-insensitive for Latin; Devanagari has no case. **The query starts
from `guest_groups`, LEFT JOIN `guests`** — the first version started from
`guests` and silently dropped families whose head had no guest row ("arpit"
was unsearchable). A group with no guest row now emits one result (guest_name
= head_name).

### `resetTestData` protects the SEED-543 scale fixture

The seed (scripts/seed-543.mjs) adds ~543 deterministic families so the suite
runs at real scale — the 26s bug only existed at scale. The reset used to
delete them mid-run, dropping the suite to ~100 guests. The reset now pins
SEED-543 groups exactly like proof-pinned and call-attempt-pinned ones. The
suite passes twice back-to-back at 648+ families with the seed intact.

### T0.4's contract is the count, not the DOM

The old assertion "every imported family is visible in the DOM" is what forced
the 26s render. It is removed and documented: the new contract is (a) first
paint < 5s at 543+ families (3s is the venue target; the dev machine's cloud
RTT needs headroom), (b) the displayed count equals the real family count in
the DB (proving all data loaded without all rows in the DOM), (c) only a
window of rows is mounted, (d) search finds a guest NOT on the first page,
(e) that guest's profile opens. The `<5000` automated budget vs the 3s venue
target is a deliberate, documented difference.

### T0.7's throwaway families get a recognisable prefix

`createPendingDeliverable` now names its throwaway family `E2E-PROOF-<ts>`
(was `TMP-DELIVERY-`). The proofs stay insert-only and permanent — that
guarantee is correct — but the pinned families are identifiable and
excludable (`countProofPinnedFamilies`, `PROOF_PREFIX`), so they stop
polluting the working set the other tests count.

### Migration 1800's function is not itself re-runnable against the post-1803 DB

1800 `create or replace`s `search_guest_profiles(uuid, text)`; 1801/1802/1803
drop and re-create it with changed `returns table` columns (42P13 forces the
drop). The migration LEDGER is what makes re-pushing safe — an applied
migration is never re-executed, and `supabase db push` reports "Remote
database is up to date". Re-running 1800's body by hand against the live DB
(after 1803) would silently create a second `(uuid, text)` function with the
old shape. This is a known, documented limitation of the drop-then-create
pattern for return-type changes, not a live hazard — the ledger guards it.

---

## 3 August 2026 — Q1 design foundation (ledger system)

### Scope: the brief's route map did not exist yet

The brief named `/team/deliveries` as the reference screen and listed
`/admin/rooms`, `/client`. None of those routes exist — the app is built as
`/[eventCode]/…` and hamper delivery is Phase 3 (no screen yet). Q1's reference
screen is therefore the **calling queue** (`/[eventCode]/queue`), the app's real
one-handed-at-speed screen with a 238-family list. The delivery vocabulary is
defined in full now so the Q2 deliveries screen can be built without re-deciding
words or colours.

### The status vocabulary is one module, `src/lib/status.ts`

Previously `rsvp.ts` held only RSVP labels/tones; screens had drifted between
"Callback" and "Callback due". Now `status.ts` is the single source for all four
families (RSVP, delivery, ledger, room) with fixed wording and a four-tone
system (`neutral` / `active` ink-stamp / `attention` red / `done` green).
`rsvp.ts` is a thin re-export so existing consumers keep their imports.

### Red and green are locked to meaning

Ledger red = attention only (overdue, unbalanced, over-capacity, destructive).
Ledger green = completed only (delivered, confirmed, balanced). The focus ring
is ink in both themes, not red — a focus outline is not an attention state.
`Badge.tsx` (5 tones incl. indigo/blue/amber) still exists and is used across 21
screens; deleting it and migrating those usages is Q2, recorded, not done here.

### Two behaviour notes found during the visual pass — fixed separately, not here

1. **`/design-system` is a public route.** It is a static evidence page
   rendering every primitive in isolation. It ships as `○ /design-system`
   (static). It is dev tooling, harmless (no data, no auth), and documented as
   such; Q2 can delete it or gate it.
2. **The queue's attention rows are not sorted to the top.** Red (unreachable,
   declined) rows currently sit inside priority tiers; the default sort does not
   surface them. Surfacing attention first (or an attention count in the header)
   is a behaviour change and belongs in a logic pass, not this visual one.

---

## 31 July 2026 — p1d, role gating and event scoping

### Event scope lives in the URL, not in an `active_event` cookie

The p1d brief specified route groups `/(admin)` `/(team)` `/(client)` plus a
validated `active_event` cookie. The app was already built with the event in the
URL as `/[eventCode]/…`, and it stays that way.

Two reasons. Next.js cannot resolve two route groups onto the same path, so a
per-role group would have meant three copies of every event screen. And the
brief's own warning — "an unvalidated cookie leaks event names and ids into the
UI before RLS ever runs" — describes a hazard that simply does not exist when the
scope is a URL segment resolved through `getEventByCode()`, which runs under RLS
and returns null for an event you cannot reach. Nothing to tamper with. It also
lets an admin hold two weddings open in two tabs, which they will.

The consequence: the DoD line "editing the `active_event` cookie by hand does not
grant access" is now unfalsifiable rather than passing. There is no cookie.

### The dashboard was showing clients a fabricated zero

`v_event_dashboard` is `select … from public.events e` with every counter a
correlated subquery over `guest_groups` / `travel_legs` / `deliverables`. It is
`security_invoker = true`, so for a client-role account the outer `events` row
passes RLS (`app.is_member`) while every subquery fails it (`app.is_staff`) and
`count(*)` returns **0, not null**.

So a client got exactly ONE row, entirely zeros — and the page's `if (!stats)`
fallback never fired. A 238-family wedding rendered as "Total groups 0". This is
the failure mode CLAUDE.md §5.8 forbids on the review screen, arriving through
the dashboard instead. Fixed by `requireStaff` on the page; the remaining
`!stats` branch now means a genuine read failure and says so.

### Guards live in the pages, not the layout

A server layout cannot see the pathname, and `headers()` would opt the whole
subtree out of static rendering. So `requireStaff(eventId, eventCode)` and
`requireAdmin(…)` are called at the top of each page body, after the event
resolves. The layout resolves access once more for the nav. Two indexed
single-row reads per request, and correctness beats the saved round trip.

**These are UX affordances, not the security boundary.** RLS is the fence. What
the redirect buys is honesty: under RLS "you may not" and "there is no data" are
the same empty result, so a client left on a staff screen is shown confident
fiction. `/[eventCode]/guests` is deliberately ungated — guarding the page a
client is redirected *to* is an infinite loop.

### Import is admin-only by product decision, not by RLS

Nothing in migration 0500 stops an `event_team` member inserting
`import_batches`, `import_rows` or `guest_groups`. The restriction is one
`requireAdmin` call in `import/page.tsx` plus one entry in `TABS_BY_ACCESS`.
Relaxing it is two edits and no migration. An `event_team` member who follows a
link there is bounced to the dashboard with `?denied=import`, and the sentence is
looked up from a table — the query string only ever selects a key, so a crafted
URL cannot put words in the app's mouth.

### `app.is_admin()` is `global_role = 'admin' AND is_active`

`getViewer()` and `getEventAccess()` read `global_role` alone, which made the app
disagree with the database. A deactivated admin would be shown the admin shell,
then handed zero rows from `events` (RLS calls `app.is_admin()`, now false) and
told "no events exist" on a database holding live weddings. Both halves are read
now. Deactivating is the only offboarding the schema offers.

### `claim_group()` fences on the group's event, never the URL's

`claim_group(p_group_id, p_minutes)` takes no event id. It is `security definer`
and checks `app.is_staff(g.event_id)` — the group's *own* event. For an admin,
who is staff everywhere, a group id pasted from another wedding **succeeded** and
wrote a 15-minute lock there; the app's `event_id` mismatch check then 404'd,
after the damage. Admins are expected to hold two events open in two tabs, so
this is a normal accident. `claimGroupForCall` now proves the group belongs to
the event in the URL before it claims.

### `Membership.role` is fabricated for admins

Admins hold no `event_members` rows, so `getViewer()` lists every event and
reports `role: 'event_team'` for all of them. `app.event_role` has no `'admin'`
value and inventing one would misrepresent the database. The trap is documented
on the field, and the only correct way to consume it is centralised in
`eventHomePath()`, which checks `isAdmin` first. `eventHomePath` lives in
`src/lib/events/paths.ts` rather than `queries.ts` because the latter is
`server-only` and the event switcher is a client component.

### A client gets no tab bar at all

One tab pointing at the page you are standing on is decoration, and it costs
4.75rem of a 360px screen. Admin gets 4 tabs, `event_team` 3 (no Import), client
none — the layout drops `pb-nav` for `pb-8` so there is no dead space.

### Still outstanding after this slice

- **`/admin/events` is now the only way to create an event, and `starts_on` is
  required in the form** even though the column is nullable — the Excel import
  resolves `"4th"` against the event's month and cannot run without it. The reason
  is in the field's help text, not just a comment.
- Nothing here has been tested on a real Android phone, and no automated tests
  exist yet. Both still pending from the previous slice.

---

## 31 July 2026 — Phase 1 application build

### Realtime was never actually on

Migrations 0100–0700 never add any table to the `supabase_realtime` publication.
Supabase ships that publication empty, so `postgres_changes` subscribes, reports
`SUBSCRIBED`, and then delivers **zero events forever**. The calling queue's live
sync was inert from the moment it was written.

`20260731000800_realtime.sql` publishes `guest_groups` **and** `call_attempts`.
Two tables, not one: `attempt_count`, `last_attempt_at`, `last_outcome` and
`next_callback_at` in `v_rsvp_queue` are computed entirely from `call_attempts`,
and migration 0200 states outright that nothing in that chain writes to
`guest_groups`. Publishing only `guest_groups` would leave exactly the four
numbers a caller needs stale on every other phone.

Both tables get `replica identity full`. The client subscribes with
`filter: event_id=eq.<uuid>`, evaluated against the record in the payload; under
the default replica identity a DELETE carries only the primary key, so `event_id`
is absent and the event is dropped rather than delivered.

**The migration is written but NOT applied.** Live sync stays inert until someone
runs `supabase db push`. The file is idempotent, so re-running is safe.

### Dialing is now strict, and some families may show as un-dialable

`dialTarget()` returns a `tel:` link only for a number that reduces to 10 Indian
digits, or one explicitly stored with a leading `+`. Anything else returns null
and the call screen says "No dialable number on file".

The old code truncated with `slice(-10)`, which meant `+1 415 555 1234` dialed the
unrelated Indian number `4155551234`. Refusing to dial is the correct trade — but
if the source sheet is messy, some families will be un-dialable until the sheet is
fixed. The import preview already warns on exactly those cells.

### Row identity survives a corrected mobile

`source_row_hash` covers head name + primary mobile + group code. That alone meant
correcting a mobile the preview had *warned about* changed the row's identity and
created a duplicate family — i.e. following the tool's own advice broke CLAUDE.md
guarantee #6.

`classifyRows` gained a second pass matching on normalised head name, accepting an
existing family only when every identifying field present on both sides agrees and
exactly one candidate is compatible. Two existing families sharing a head name are
treated as no-match rather than merged into one of them: a duplicate is recoverable,
a wrong merge is not.

### "Callbacks due now" was impossible as specified

`v_rsvp_queue.next_callback_at` is `min(callback_at) filter (where callback_at > now())`
— it can only ever hold a **future** value, so `lte(next_callback_at, now)` matched
essentially nothing regardless of whose clock was used. The phone-clock complaint was
real but not the actual defect.

Relabelled **"Callback booked"**: filters non-null, sorts soonest-first, shows the time
on the row. A true *overdue callbacks* filter needs a view change — deferred to p1e
follow-ups.

### `getEventAccess()` is for honesty, not authorisation

A client-role account can reach `/[eventCode]/import` (RLS `app.is_member()` lets them
read their own event), and base-table reads return **zero rows with no error**. The
preview therefore reported a confident "238 New" against a database already holding all
238 — the one screen CLAUDE.md forbids cutting, lying.

`getEventAccess()` in `src/lib/supabase/queries.ts` computes admin / event_team / client /
none from the same two inputs `app.is_staff()` uses. It exists to tell the user the truth
where a zero-row read would otherwise be presented as fact. **RLS remains the fence** —
do not turn this into the authorisation gate.

### A cancelled dialer is not an outcome

`call_attempts` freezes permanently the instant `outcome` goes non-null. The original
screen offered "Abandon", which forced a caller who backed out of the dialer to either
invent an outcome or strand a null-outcome row holding the family's lock.

Replaced with two honest exits: **"Dial again"** re-fires `tel:` against the *same*
attempt row (backing out of the dialer is one attempt, not two), and **"No call
happened"** finalises as `other` with an explanatory note.

### Deliberately deferred

- **No automated tests.** No test runner in `package.json`, which the build agents were
  told not to edit. Every fix is verified by `tsc` / `eslint` / `build` and by reading,
  not by execution. `classifyRows` pass 2 and `describeCallbackProblem` are pure functions
  and the two things most worth covering first once a runner exists.
- **Nothing tested on a real Android phone** (CLAUDE.md §14 requires this). The call
  screen's `visibilitychange` duration, resume-at-mount stamping and `tel:` re-fire all
  depend on real Android page-lifecycle behaviour a laptop browser will not reproduce.
- `import_batches.status` can now be `'completed_with_errors'`. The column is free-form
  and nothing reads it yet — flag it if an admin screen ever enumerates statuses.

---

## NuventPhone design pass

Imported from the Claude Design project `NuventPhone.dc.html` and applied across the
app. The mockup is the source of truth for the visual system; where it and the built
app disagreed on *behaviour*, the app won.

### The app no longer follows the OS colour scheme

Two grounds, and the skin is a property of **who is looking**, not of a system setting:

- **Staff** — a fixed dark teal (`#071A1D`) with a brass accent. Staff work corridors,
  car parks and banquet halls after dark; a cream screen at full brightness is a torch
  in the face. Fixed rather than OS-following so one caller's screen looks like the
  next caller's when they compare a row over someone's shoulder.
- **Client** — warm paper (`#F4EFE4`), scoped by `[data-theme='client']`, set in
  `(staff)/[eventCode]/layout.tsx` from the already-resolved `access`.

Both grounds define the **same token names**, so no component branches on role to get
its colours right. This replaced the previous OS-following light/dark pair from the
bahi-khata pass.

Brass (`#C9A96B`) is the accent, not a status. Verdigris (`#4FC1A0`) still means
COMPLETED and signal (`#F2705F`) still means ATTENTION — that rule is unchanged and
still absolute. Every text-on-surface pair is annotated with its measured ratio in
`globals.css`; all pass WCAG AA, most AAA. The client ground needs *different* hexes
for red/green/brass because the dark-ground values sit at 1.7:1 on cream.

### Fonts are self-hosted, not linked

The mockup links four Google fonts. `next/font/google` in `app/layout.tsx` downloads and
fingerprints them at build time and serves them from our own origin, so venue Wi-Fi is
never in the critical path and there is no layout shift when they land. The previous
"no webfont at all" rule was solving the same problem with a bigger hammer.

`IBM_Plex_Sans_Devanagari` is loaded on purpose and sits immediately after
`IBM_Plex_Sans` in the stack: family names arrive off the sheet in Devanagari and sit
inline with Latin on the same row. Without it, half the register renders in whatever the
Android WebView happens to ship.

### Shape carries meaning

A **rounded rectangle commits** (buttons, fields, cards — radius 12/14/16px). A **full
pill filters or labels** (`Chip`, `StatusPill`, `Badge`). Keeping the shapes apart means
a caller can tell what a control does before reading it. This reverses the previous
"Organic overlay", which made `rounded-xl` a 999px pill and put buttons and chips in the
same shape. Radii are set as Tailwind `--radius-*` theme variables, **not** as
`@utility` overrides of the built-in names.

Cormorant Garamond is allowed in exactly three places: screen titles (`PageTitle`,
`StickyHeader variant="screen"`), the couple's names, and the seal. It is never used for
a figure (no tabular set) and never for a family name (no Devanagari cut). `EmptyState`
and `ErrorState` were moved *off* it — untracked at 20px on the night ground its
hairlines vanish on a cheap LCD, and those are the sentences someone reads when
something has broken.

### Sealed is still; queued breathes

The delivery run draws its two states to differ in more than colour: sealed is filled,
solid-bordered, motionless and carries **no** action; queued is unfilled, dashed,
breathing and carries the only button. A hamper is delivered because a photo exists, so
"done" has to look like a record and "not done" like a blank waiting to be filled.

`breathe` is the only infinite animation in the app and it carries meaning. Everything
collapses under `prefers-reduced-motion`, and nothing depends on motion to convey state.

### Rooms became a tile grid

168 rooms as a vertical list of cards is not a phone screen. Now: hotel tabs → a
4-column grid of tiles (room number + one occupancy dot per bed) → a bottom sheet for
detail, assignment and release. The two-tap move (select guest, tap room) and the
capacity-override and release flows are unchanged; only the surface changed. Tile states
differ in **hatching, border weight and dot pattern** as well as hue — a grid of 168
tiles separated by colour alone is unreadable to a colour-blind coordinator.

### The tab bar is text-only

Six slots, mono labels under a state dot, no glyphs: Board · Queue · Rooms · Runs ·
Arrivals · More. Six icons on a 360px bar are six icons nobody can tell apart at arm's
length, and every one of these sections is a noun a caller already says out loud. The
More sheet keeps its glyphs — a full row has space for both. Board leads because that is
where a shift starts.

### Fixed on the way through

- `DeliveryList`'s delivered badge used `bg-tint-ok text-ok`, tokens that have never
  existed — it was rendering unstyled. Now `StampPill`.
- The queue's contacted-progress bar is **suppressed while a filter is on**: the
  denominator would otherwise be "families matching this filter", and a bar whose
  denominator moves when you tap a chip is a bar that lies.
- `AttentionPanel` moved to `components/dashboard/` and is now shared by the staff board
  and the admin dashboard instead of existing only on the latter.

### Not done in this pass

- **The mockup's fleet manifest expander.** It shows a per-vehicle passenger manifest and
  a PLANNED → DISPATCHED → COMPLETED tracker; `readFleet` loads vehicle inventory only,
  with no trip join. That is a data feature, not a design one.
- **The mockup's in-app camera screen** (viewfinder, corner brackets, shutter). The built
  capture path hands off to the native rear camera via the Capacitor plugin, which is the
  correct behaviour and cannot be skinned — only the surrounding confirm/seal screens
  were restyled.
- **Nothing verified on a real Android phone**, and only `/login` and `/design-system`
  were viewed in a browser — the rest are behind auth and were verified by `tsc`,
  `eslint` and `next build` only.

---

## 2026-08-09 — The APK ran as a browser tab, and the dial button did nothing

Two symptoms reported: the app "opens like a site in a browser" when the dev server is
running, and calls could not be made. They turned out to share a root cause plus a set of
latent bugs that would have bitten on event day.

### Root cause: the app was never launched

The APK was correctly built, installed, and pointed at the right LAN IP the whole time.
Nobody was launching it — the LAN URL was being opened in Chrome by hand. A browser tab
renders the identical site (remote-shell mode) but has **no native bridge**, so the `Call`
plugin does not exist and every native path silently degrades.

The reason nobody launched it: `"mobile:dev": "next dev & npx cap run android --livereload"`.
npm runs scripts through cmd.exe on Windows, where `&` is a **sequential** separator, not
POSIX backgrounding. `next dev` never exits, so the Capacitor launch step was unreachable
dead text. The script started a server and launched nothing, every time.

**Decision:** `mobile:dev` is now `scripts/mobile-dev.mjs` — a Node script, because shell
backgrounding is not portable and this repo has to work on Windows. It auto-detects the LAN
IP (skipping Hyper-V/WSL virtual adapters, which are not routable from the phone), waits for
the server to actually answer before syncing, and **only rebuilds when the baked server URL
changed**. A Gradle build is ~2.5 minutes; a loop that pays that on every run is a loop
nobody uses.

### Why the dial did nothing

`openExternalUrl()` used `window.open(url, '_system')`. Two independent faults:

1. `'_system'` is a **Cordova** target. Capacitor 8 does not implement it.
2. The dial fires *after* `await startCallAttempt(...)`. That round-trip expires the
   transient user activation, so the browser treats the `window.open` as an unsolicited
   popup and blocks it. **A blocked popup returns `null` — it does not throw.** The
   `try/catch` fallback to `location.assign` therefore never ran. The tap did nothing,
   logged nothing, and showed no error.

**Decision:** `@capacitor/app-launcher` on native (Android resolves the tel: intent without
touching the WebView, so the cookie session survives), plain `location.href` on web (a
navigation is not a popup, so it needs no user activation). Never `window.open` for a
system scheme.

### The other things that were wrong

- **No `<queries>` block.** Targeting SDK 36, package-visibility filtering makes
  `resolveActivity()` return null for `tel:` even with a dialer installed. Added DIAL/CALL/VIEW
  + `tel` scheme.
- **`CALL_PHONE` was declared but never requested.** `dial()` only *checked* the permission,
  so direct dial was unreachable and every call was permanently downgraded to the
  confirm-screen dialer. Now requested on first use.
- **The `ACTION_DIAL` fallback had no try/catch** — an `ActivityNotFoundException` escaped,
  the `PluginCall` was never resolved, and the JS promise hung forever.
- **`Boolean(window.Capacitor)` is not a native check.** `@capacitor/core` installs that
  global in browsers too, so all five call sites believed Chrome was native. Replaced with
  `isNativePlatform()` in `src/lib/native/platform.ts`. This also means
  `capacitor-storage.ts` had been routing browser sessions through the Preferences web shim
  rather than the localStorage branch written for them — native behaviour is unchanged,
  browsers re-login once.
- **`allowNavigation` was documented backwards.** It is the allowlist of hosts the WebView
  may navigate to *itself*; `tel:*`/`mailto:*` entries were inert (it matches on host, and a
  tel: URI has none) but taught the mechanism wrong. Removed.
- **A trailing space in `CAP_SERVER_URL`** (`set VAR=value ` in cmd keeps it) was baked into
  `capacitor.config.json` as `"http://192.168.29.44:3000 "` and passed to `Uri.parse()`
  unmodified. The config now trims. The default port was also 8000 against a dev server on
  3000, so any sync without the env var baked a dead URL.
- **`capacitor.config.dev.ts` was orphaned** — no script, no CLI flag, no gradle file read it
  (the Capacitor CLI only reads `capacitor.config.ts`), its default IP was stale, and its
  `allowNavigation` list was narrower than the base config. Deleted.
- **The `CapacitorUpdater` config block shipped into the APK with the package uninstalled.**
  Inert, but it reads as "OTA is wired" to anyone inspecting the build. Removed until the
  dependency comes back.

### Why it also *looked* like a website

Some of this is architectural — M2-ALT remote shell means the WebView loads the live site.
But the avoidable tells were fixed:

- StatusBar was `style: 'LIGHT'` on cream `#f5ead8`. Capacitor's `'LIGHT'` means **dark
  text**, so the icons were dark-on-dark over the app's dark teal `#071a1d`. Now `'DARK'`
  (light icons) with matching colours.
- The splash was cream and the app is dark teal, so launch flashed pale then swapped —
  the most "web page loading" moment in the product. Splash is now the same colour, set via
  the core-splashscreen `windowSplashScreenBackground` attribute rather than the
  pre-core-splashscreen `android:background` the template used.
- The theme inherited Capacitor's library defaults (Material indigo `#3F51B5`). Added
  `android/app/src/main/res/values/colors.xml` with the brand palette.
- With no local bundle, an unreachable server showed Chromium's own grey error page. Added
  `public/offline.html` wired via `server.errorPath`.

### Verified on the handset

Built, installed, and launched on the real phone. The app comes up in the WebView loading
`http://192.168.29.44:3000/_next/...` — no address bar, edge-to-edge dark teal, white
status-bar icons. `adb shell cmd package resolve-activity` confirms `tel:` resolves to
Google Dialer. **The dial itself still needs a manual test with a SIM and a logged-in
staff account** — that cannot be driven from adb.

### Known, not fixed

- `Capacitor/Console: Uncaught TypeError: Cannot read properties of undefined (reading
  'triggerEvent')` on every launch. Native `notifyListeners(..., retainUntilConsumed=true)`
  calls a JS API Capacitor 8 removed; most likely `@sentry/capacitor` 4.2.0. It does not
  blank the WebView and the app loads past it, but it may suppress some native→JS events.
- `Call.startListening()` is invoked but nothing registers `addListener('callStarted' |
  'callEnded')`, so the call-state/duration pipeline is still dead. Duration comes from the
  `dialedAt`/`returnedAt` wall clock.
- A stranded `call_attempts` row with `outcome IS NULL` still hides the Call button for that
  caller; the escape hatches are "Dial again" and "No call happened".

---

## 2026-08-09 — Supabase round-trip work (Phases 1-5)

### Phase 1 was based on a premise that is not true in this repo

The brief said Cloudflare Pages runs in Mumbai and asked for Smart Placement.
**There is no Cloudflare deployment.** No `wrangler.toml`, no
`@cloudflare/next-on-pages`, no `@opennextjs/cloudflare`, no `pages.dev`, no
deploy config of any kind; `capacitor.config.ts` still carries
`<DEPLOYED_APP_URL>` as a placeholder. Without one of those adapters a Pages
build could not serve this app's SSR at all. Confirmed with the user: nothing
is deployed yet, and the ~150ms Mumbai figure was projected rather than
measured. No Workers exist, so there is no execution region to report or move.

### Measuring this correctly took three attempts, and the first two lied

1. **Wrong event.** The perf harness resolved the event code from
   `E2E_EVENT_ID` and pointed BOTH sessions at it. The admin credentials and
   the team access code belong to different events (`SHARMA26` vs
   `SAMPLE2026`), so the team session was measured rendering a not-found for
   an event it cannot see: 17ms, which read as "team is already fast". The
   real figure was ~240ms. The harness now derives the event from where each
   login lands, and asserts the route rendered rather than redirected.
2. **Wrong metric (TTFB).** This app has 11 `loading.tsx` files, so every
   route streams. `responseStart - requestStart` measures the shell flush, and
   stayed flat at ~17-25ms on routes whose data took 240ms.
3. **Wrong metric again (browser load).** Wall-clock to the `load` event on an
   emulated Pixel 5 is ~600ms of JS parse and hydration on top of the server
   render — removing a 175ms round trip moved it by less than run-to-run
   noise.

The metric that actually answers the question is the **HTML document fetch**
(`e2e/measure-routes.mjs`): the stream does not end until every server await
has resolved, and no browser work is in the number.

### Two bugs found in my own change before it shipped

- **PostgREST does not say "does not exist".** The fallback for "the merged
  view has not been created yet" tested for `42P01` / `/does not exist/`.
  PostgREST answers an unknown relation with **`PGRST205`** and the wording
  "Could not find the table 'public.v_event_board' in the schema cache". That
  fell through to the failure branch, `readDashboard` returned null, and the
  board rendered its "Could not load the numbers" card on every load. Both
  codes are now accepted; any other error is still reported as a real failure.
- **The event cache was a tenancy leak.** `getEventByCode` runs under RLS, so
  a row means "visible to YOU" and null means "not visible to YOU" — both are
  facts about the viewer. A cache keyed on the event code alone would hand one
  viewer's row to another and let a non-member render a header for an event
  they cannot see (CLAUDE.md §5.1). The key now carries an opaque per-session
  fingerprint derived from the session cookies, so two sessions can never
  share an entry. The fingerprint is never trusted as a claim — it only picks
  a cache bucket, and RLS still fences the read behind it.

### What changed

- **`lib/request-cache.ts`** — per-request memo via React `cache()`, storing
  successes only. Nullish results are passed through uncached, because a
  memoised null is exactly what got the previous `cache()` attempt reverted.
  **Measured caveat: it does not dedupe across the layout/page boundary** —
  those render from separate route-segment chunks and hold separate module
  instances, so `perRequest` alone still left 2 reads per request. It is kept
  because it is correct and cheap, but it is not what produced the win.
- **`getEventByCode` TTL cache (30s, per session)** — the layout and the page
  each resolve the event, at ~175ms apiece. Warm across requests, so the
  steady state is zero round trips for the lookup.
- **Middleware checks the code JWT first** — `auth.getUser()` can only ever
  answer null for a team/client session, and all 10-20 staff are code
  sessions. The JWT is verified locally, so that branch now costs no network.
  An admin still falls through to `getUser()`, which must keep revalidating.
- **`v_event_board`** (migration `20260809120000`) merges `v_event_dashboard`
  and `v_event_attention` into one row. Both scanned `events` and both
  computed `hampers_pending`. `security_invoker = true`, matching both source
  views; no policy, grant or RPC touched; the old views are left in place.
  **NOT YET APPLIED** — the Supabase MCP server disconnected mid-session and
  the CLI needs an interactive DB password. The read path falls back to the
  two legacy views (in parallel) until it lands, so deploy order is free.
- **The dashboard page reads the board once** rather than calling
  `readDashboard` + `readAttention`, which issued the underlying read twice.

### Verified

Acceptance 100/100, EVENT-READY YES. Unit 95/95. Two new identity tests pass:
twelve rounds of overlapping admin+team requests to the same route, asserting
neither ever renders the other's identity, plus an anonymous/authenticated
interleave proving "no session" never becomes sticky.

Document-fetch timings, caches on, dev machine → Supabase Seoul: team routes
~208-236ms, admin routes ~780-863ms. The admin path is still ~4 round trips —
`auth.getUser()` plus `profiles`/`event_members`, resolved twice per request —
and is the obvious next target. It was left alone because caching an identity
across requests is the one change here that could weaken a guard, and the
brief forbids that.

**No honest before/after timing table exists for the same metric.** The
`NUVENT_PERF_BASELINE=1` switch disables the caches this work added, but it
also disables the 30s dashboard TTL cache that predates it, so it measures
"no caching at all" rather than the original state. Reconstructing the true
baseline would mean reverting onto a working tree with heavy uncommitted work,
which was attempted once via `git stash` and immediately rolled back after it
reverted `middleware.ts` to a pre-code-auth commit.
