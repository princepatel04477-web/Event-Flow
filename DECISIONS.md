# DECISIONS.md

Non-obvious decisions, newest first. Per CLAUDE.md §14: record it here as it
is made, so the next session does not re-litigate it.

---

## 21 September 2026 — One route per screen, and a bottom bar that fits

### Every field screen existed twice, and the copies had drifted

The section move (`logistics/`, `hospitality/`, `rsvp/`, `guests/`) copied
screens into their sections and **left the flat originals in place**. Thirteen
folders, ~5,600 lines, and by the time they were found the two copies were no
longer the same file:

| screen | flat copy | section copy |
|---|---|---|
| Arrivals | 540 | **627** |
| Departures | 433 | **821** |
| Fleet | 33 | **305** |
| Deliveries | 882 | **896** |
| Call list | 697 | **712** |

The section copy was ahead in every case. The board linked to the flat ones, so
tapping "Arrivals today" opened the older Arrivals while the tab bar opened the
newer one — the same screen, two versions, decided by which control you touched.
The flat copies are deleted.

**The flat URLs are 308 redirects in `next.config.ts`, not deleted outright.**
Staff have these paths in browser history and pinned in WhatsApp threads, and
in remote-shell mode the APK is a WebView over the deployed site, so a dead URL
is a dead screen on a handset mid-event. Permanent, so the handset caches the
hop instead of paying for it on venue Wi-Fi.

**`/:eventCode/rsvp/:groupId` is constrained to a UUID.** Redirects run before
filesystem routing, so a bare `:groupId` would also match `/EVENT/rsvp/queue`
and swallow the entire RSVP section. Verified against a running production
build: all six named RSVP children still resolve, and a real UUID redirects to
`/rsvp/status/<id>`.

### Two RSVP detail screens, and the writes revalidated the one nobody opened

`rsvp/[groupId]` and `rsvp/status/[groupId]` were both live. Guest lists, the
review screen and `rsvp/next` linked to the bare one; `CallScreen` used the
`status` one — and **both server actions called
`revalidatePath('/EVENT/rsvp/status/<id>')`**. So logging an RSVP invalidated a
path the user was not on, and the screen they were looking at kept serving the
pre-write cache. Canonicalised on `rsvp/status/[groupId]` (the fork that was
ahead, and the one the actions already named) and repointed every link.

Ten more links pointed at deleted routes, including three more `revalidatePath`
targets. **A `revalidatePath` on a path with no page behind it fails silently** —
it is not an error, it simply revalidates nothing, which is why this class of
bug survives a clean build and a green test run.

### Five tabs, because that is what the bar can lay out

An event lead had seven. The `truncate` on the tab label was already documented
as load-bearing at five. Hampers and Setup are now *borrowed children* of Rooms:
they keep their own routes (`/{event}/hamper`, `/{event}/production`) and appear
in the second-level strip, so nothing became unreachable and no URL churned.

That is only safe because `SectionTabs` exists. Before it, a non-default child
rendered nowhere and promoting Hamper to a section was the only way to reach it
— the workaround this removes. `SECTIONS.hamper.inTabBar = false` records that
it is still a real section, just not one holding a slot.

`resolveActive()` is what makes a borrowed child work: `/EVENT/hamper` starts
with a real section id, so without it the Rooms tab went dark and the strip that
leads back out rendered nothing — a screen you can reach and not leave.

### A runner's bottom bar is their own screens, not Home plus a dead tab

Four of five departments got `[Home] [Travel]`, and the board **redirects any
non-management staff to their department home** — so Home bounced straight back
off itself. A two-tab bar with one working tab, while their four real screens
sat one level down.

A single-department runner now gets their section's screens *as* the bar:
Arrivals · Departures · Fleet · Trips. A department whose section is one screen
(Hampers, Setup) gets **no bar at all** — one screen does not need navigation.

Two consequences worth stating, because both were bugs waiting:

- The layout asks `bottomTabsFor(...).length > 0` for its bottom clearance. It
  used to ask `access !== 'client'`, which was the bar's own rule before a
  runner could have no bar — so `pb-nav` would have reserved 56px under a page
  with nothing beneath it.
- Borrowed children carry their own `departments` list. A Rooms runner is not a
  member of the `hamper` section, so a Hampers tab would render a control that
  bounces them to `?denied=section`.

`tests/nav-model.test.ts` asserts all of this. The bar is the only navigation
most of these users have and every rule in it is about *who someone is* rather
than where they are — that combination has already shipped two bugs.

### DeliveryDetail's way out was hardcoded to a section its users cannot open

`hamper/[deliverableId]` renders the hospitality `DeliveryDetail`, whose four
exits all pointed at `/{event}/hospitality/deliveries`. A hamper runner is not
in that section, so every way off the screen bounced them with a telling-off.
It now takes `backTo` / `backLabel`, the way `DeliveryList` already took
`detailBase` for the same reason in the other direction.

`BackRow` existed as byte-identical copies under `components/call/` and
`rsvp/status/[groupId]/`, both hardcoding `aria-label="Back to queue"`
regardless of destination. One copy in `components/ui/`, `backLabel` required.

### The empty board was on the copy nobody could reach

`docs/UX-RULES.md` cites the zero-guests empty state as the model for R3 — and
cites it at `dashboard/page.tsx`, which was a *third* fork of the board that the
tab bar never sent anyone to. The live board at `[eventCode]/page.tsx` did not
have it, so a real new event got a grid of zeros above a paragraph explaining
that zero means nothing recorded yet. Ported into the live board; the fork is
deleted.

The board now leads with "Needs eyes on it" instead of carrying it fourth, below
six counters. That panel renders nothing when nothing is wrong, so a calm day
still opens on the headline.

---

## 16 August 2026 — EventFlow identity: logo, launcher label, final-06 build

### The launcher label changed; the appId did not

`app_name` in `res/values/strings.xml` and `appName` in `capacitor.config.ts`
are now **EventFlow**. `applicationId` / `namespace` / `package_name` /
`custom_url_scheme` stay **com.nuvent.app**.

This is the same distinction CLAUDE.md §12 draws for the `nuvent_*` cookie and
storage keys, and it is worth restating because a rebrand is exactly when it
gets ignored. The label is copy — it is what a staff member reads under the
icon and in Settings → Apps. The applicationId is Android's identity for the
app: change it and the result is a *different* app with no upgrade path, so
every handset uninstalls, reinstalls and re-enters its access code. There is no
migration for it, and the cost lands mid-event.

`cap sync` does **not** rewrite `strings.xml`, so the label lives in two files
and both had to change. Changing only `capacitor.config.ts` looks like it
worked (the config JSON inside the APK says EventFlow) and the launcher still
says Nuvent.

### Every brand raster is generated, not hand-exported

`scripts/brand-assets.mjs` derives 33 files — five densities × three launcher
icons, eleven splash bitmaps, the Android 12 splash icon, three web icon
conventions, three PWA icons and the inlined marks in `install.html` /
`offline.html` — from one source, `assets/brand/eventflow-logo.png`.

Hand-exporting them means the next logo tweak updates the four you remember
and leaves twenty-nine stale, which surfaces as a launcher icon disagreeing
with the splash on the handsets nobody tested. Re-running the script is the
only step.

Three things in it are non-obvious and cost a cycle each:

- **The white ground is cut out by distance-to-white, with a deadband.** The
  source ground is 254-255, not a flat 255. Without `DEADBAND = 3` every ground
  pixel came out at alpha 1/24 and — after un-premultiplying, which divides by
  that alpha — pure white. Invisible against a white icon ground and glaring on
  the splash, where the lockup sat inside a white rectangle on the paper. The
  first splash render showed it plainly.
- **`palette: true` everywhere except the favicon frames.** Palette encoding
  takes the eleven splash bitmaps from ~4MB to ~950KB, which is real money in a
  6.5MB APK. But Next's build-time ICO reader accepts RGBA frames only, so a
  palettised `favicon.ico` fails `next build` with *"The PNG is not in RGBA
  format!"* — which reads like a corrupt file, not a compression setting.
- **The launcher art sits at 0.58 of the adaptive foreground canvas**, versus
  0.74 for the legacy square. Only the central 66dp of the 108dp canvas is
  guaranteed visible once a launcher applies its own mask, and the calendar
  badge is the first thing a circular crop eats.

### The splash and status bar were still the retired dark-teal design

`colors.xml`, `styles.xml` and the Capacitor `StatusBar` / `SplashScreen`
blocks all specified `#071a1d` with cream. The app ground has been light paper
(`#f8f9fa`) for some time. Left alone, launch was a dark flash that swapped to
light one frame in — and `StatusBar.style: 'DARK'`, which in Capacitor's
inverted naming means *light icons*, drew a white-on-white status bar.

`offline.html` was the same shape and mattered more: a dark screen appearing
mid-session in a light app reads as some other app having taken over, at the
exact moment staff are least able to reason about it.

**aapt rejects `--` inside an XML comment.** Documenting the CSS custom
properties this mirrors (`--ef-paper` and friends) by name failed the build at
`mergeReleaseResources` with *"The string is not permitted within comments"*.
The comments in `colors.xml` spell those tokens without their leading hyphens
and say why.

### `manifest.webmanifest` had to be excluded from the auth proxy

`src/app/manifest.ts` is generated, so it does not look like a static file and
was matched by `src/proxy.ts` — 307 to `/login?next=%2Fmanifest.webmanifest`,
measured. The browser fetches the manifest on the **first** visit, before any
session exists; gated, the fetch returns HTML, the manifest is discarded, and
an "add to home screen" installs a shortcut named after the page title with a
screenshot for an icon. Same reasoning that already excludes `install.html`.
It holds a name, two colours and three icon paths — nothing private.

### Found in passing: the root layout could not be built

Not part of the rebrand, but it blocked producing a deployable build, so it is
recorded here. Uncommitted work on this branch put
`<QueryClientProvider client={queryClient}>` directly in `src/app/layout.tsx`,
which is a **server** component. A `QueryClient` is a class instance and cannot
cross the RSC boundary as a prop:

> Only plain objects, and a few built-ins, can be passed to Client Components
> from Server Components. Classes or null prototypes are not supported.

It fails at prerender, not at compile, so `next dev` is perfectly happy and it
only appears when someone runs `next build` — i.e. at deploy time. Moved to
`src/components/providers/QueryProvider.tsx` (`'use client'`), with the client
built in `useState(() => …)` rather than at module scope: a module-scope client
is shared by every request the server process handles, so one user's cached
guest data could be served into another user's render.

### The build

`versionCode 6` / `versionName "final-06"`, signed with the existing keystore
(`SHA-256 e865d4c1…`), so it upgrades installed handsets in place rather than
forcing an uninstall. Full record in CLAUDE.md §11c.

---

## 15 August 2026 — Fleet module, reform runbook, consent gate

### Fleet tables follow the CURRENT RLS shape, not `apply_staff_policies()`

`20260814140000` removed the `has_staff_identity` gate from the 17 existing
tables by creating new policies INLINE — it never edited
`app.apply_staff_policies()`, whose 1901 body still carries the conjunct.
The fleet migration (20260815120000) initially called the helper and the
new tables ended up gated: a team session could read but not write them.
Fixed in 20260815130000 by creating the fleet tables' policies explicitly
in the current shape (`app.is_staff(event_id)` only). Rule for future
tables: match the LIVE shape, not the helper.

### `trips.driver_id` is optional; driver identity lives in `vehicle_assignments`

A trip is planned before it is assigned, so the unassigned state must be
representable. `commitTrips` does not resolve `driver_id` — driver identity
is read from `vehicle_assignments` (driver ↔ vehicle per day) at query time.

### Hampers are per-GROUP, and §5.4 surfaces the multi-room edge case

One `deliverables` row per group (guest_id null). A group with multiple
rooms therefore has ONE hamper; per-room red/green is ambiguous. The rooms
grid's hamper dot has an explicit 'mixed' state (brand-coloured) for a room
holding part of a family whose hamper status differs — surfaced, never
silently resolved. The event team should confirm the real per-room rule.

### §6.1 consent: application gate now, CHECK proposed, not applied

All 10 live `call_recordings` rows have `consent_given = false` (synthetic
test rows, sample event). A strict `consent_given = true` CHECK would
break the table. The real protection is layered: capture requires consent
(harvest-upload / voice-note), and transcribe-recording now refuses
non-consented audio BEFORE any ₹0.75 spend (2026-08-15). The CHECK
constraint remains proposed; the 10 rows' fate is Prince's data decision.

### Extract-rsvp confirmed NOT deployed (2026-08-15)

`functions list` shows only verify-access-code, bind-staff-member,
transcribe-recording. extract-rsvp source exists; deploy + Vault secrets
are Prince's to run (runbook §6.2).

### Runbook §6.4 (`generateStaticParams`) is closed as not-applicable

Zero occurrences in `src/` on this branch; `git log -S` puts every one on
`feat/m2-static-export-bundle` (`fd60e01`, `10ffd94`). The runbook item was
written against the static-export branch's shape. It becomes live again only
if §11a is re-decided and that branch resumes — at which point it is part of
the export decision, not a separate cleanup. Do not go looking for the
pattern here.

### §6.3: the abandon path is deliberately NOT fixed with `visibilitychange`

`releaseGroupAfterCall` is wired (`RsvpLogForm.tsx:204`) and the happy path
releases. Three paths still hold a lock to expiry: abandon without saving,
force-kill, and a save that fails offline. The obvious fix — release on
`pagehide`/`visibilitychange` — is a trap: `tel:` backgrounds the WebView on
every call, so the listener fires mid-dial and drops the lock exactly when
the caller needs it. The recommended change is CLAUDE.md §11b's shape
instead: a new, explicitly named `force_release_lock` RPC with an admin-only
UI, plus the locked-families list that does not exist today. Proposed only —
see `docs/reform-remaining.md`.

Coverage note found while writing it up: `l4_lock_release.sql` and
`e2e/tier1.spec.ts` T1.1 both test *taking* the lock and refusing to steal
it. **No test at any layer asserts the lock is released after a save** — the
exact behaviour W3 was about.

---

## 10 August 2026 — The client view, and the app icon

### `/[eventCode]/guests` serves two screens off one URL

The 7 August rewrite below turned this route into the staff list and put
`requireStaff` on it. `requireStaff` sends a client to `/{eventCode}/guests` —
which *is* this page. The client's only permitted screen bounced them at
itself, and the loop surfaced through the event error boundary as "This screen
did not load". The client view was not broken so much as deleted: the commit
kept `GuestCard`, `FamilySection` and `format.ts` and dropped the page that
used them.

The page now branches on `getEventAccess` (memoised per request, so resolving
it after the layout already did is free) instead of gating. Staff get the
windowed list; a client gets `ClientGuestList`.

**The two data sources are not interchangeable.** `search_guest_profiles` is
`language sql stable` with no `security definer`, so it runs as the invoker and
`guest_groups` RLS applies — a client reads **zero rows** through it. Pointing
the client screen at the staff source does not error; it renders a confident
"No guest details yet" on a wedding with 238 families. The client reads
`client_guest_profiles`, never joined (`security_invoker = false`; a join
against any base table reintroduces that table's RLS and empties the result).

### The client list pages instead of virtualising

Same 26-second lesson as below, different fix. Virtualising needs a fixed row
height, and a `GuestCard`'s height depends on how much of that family's travel
is known. So the list renders 15 families and grows on demand, with in-memory
search over the one cached read. First card visible in ~3.6s against a
765-guest event; every guest still reachable.

Cards carry no links. The RSVP record they would link to is a staff screen
that would bounce a client straight back here.

Guarded by `e2e/client-view.spec.ts` (its own Playwright project — the tier
suites are a serial chain that mutates shared rows, and this one only reads).
Both routing tests fail against the previous page, which is the point.

### App icon comes from `nuvent_logo.png`

Legacy mipmaps take the full tile. The adaptive foreground draws it at 68 of
the 108dp canvas rather than full-bleed: at full-bleed the "EVENT OPERATIONS"
line and the outer arcs of the N fall outside the 66dp guaranteed-visible
circle and a round launcher slices them off. `ic_launcher_background` is
`#0E2523`, sampled from the tile's own edge, so the corners the mask does eat
blend rather than show a seam.

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

---

## 15 September 2026 — Prompt 0: Establish UX Rules and Plain Language Glossary

### Established docs/UX-RULES.md and docs/GLOSSARY.md
Created the UX foundation for the "A 14-Year-Old Can Use It" overhaul:
- `docs/UX-RULES.md` formalises the eight cardinal UX rules (One job per screen, Plain words only, Never a dead end, Every number is a door, Undo don't confirm, Tell the truth about failure, Thumb-sized and daylight-legible, It works when the Wi-Fi doesn't) with real good/bad examples drawn directly from this codebase.
- `docs/GLOSSARY.md` maps internal/trade terminology (`pax`, `guest_group`, `deliverable`, `extraction`, `unmatched`, `harvest`, `travel leg`, `roomed`, `Board`, `Stay`, `Prep`, `access code`, etc.) to guest-friendly, plain words, documenting both where code identifiers must stay (DB schemas, Excel export headers) and the exact files where user-facing text is found.
- Zero source code changes under `src/` were made in this prompt session to ensure a clean boundary before executing downstream refactors.

---

## 21 September 2026 — Created docs/INTERACTION-CONTRACT.md (Timing & Interaction Contract)

### Formalised the Interaction and Latency Contract
Created `docs/INTERACTION-CONTRACT.md` to define strict, checkable latency and interaction rules for EventFlow, completing the counterpart to `docs/UX-RULES.md`:
- Defined seven core time and responsiveness rules (T1–T7):
  - **T1: The tap owns the first 100ms** (instant local visual feedback; no control's first visual response behind an `await`).
  - **T2: A write shows its result before the server confirms it** (optimistic UI updates for all reversible writes with rollback on failure; only irreversible commits like insert-only proof sealing wait).
  - **T3: A disabled button is a bug unless the input is invalid** (ban on `<Button loading>` with spinners for reversible writes, preserving user agency on high-latency networks).
  - **T4: Navigation is instant or it is not navigation** (destination shell and cached rows paint within 100ms; no full-screen loading spinners for known client state).
  - **T5: One tap is one round trip, at most** (prohibition of sequential awaited network calls in a single action; combine into atomic RPCs, run in parallel, or defer cleanup).
  - **T6: Motion is confirmation, never transition** (motion reserved for irreversible physical confirmation like proof sealing or queued state; press path locked to 100ms; eliminating layout jumps).
  - **T7: Offline is a state, not an error** (three honest write outcomes: saved, saved on this phone, or not saved; no silent successes or hanging spinners).
- Each rule provides a clear operational rationale for cheap Android handsets operating on poor venue Wi-Fi connected to Seoul (`icn1` / `ap-northeast-2`), a concrete pass condition, and real Right/Wrong code examples citing existing repo files (such as `RsvpLogForm.tsx`, `Button.tsx`, `DeliveryDetail.tsx`, and `globals.css`).
- Added proposed latency budgets table for V1 instrumentation (`src/lib/perf.ts` `traceFetch`) and V12 enforcement: tap-to-visual-feedback (≤ 100ms), tap-to-destination-frame (≤ 100ms), tap-to-content cached (≤ 150ms), tap-to-content uncached (≤ 1500ms), and one action's total server time (≤ 500ms).
- Audited the six mandatory screen states against existing UI components, explicitly identifying that **Content-plus-pending write** currently has NO component in the codebase.
- Zero source code changes under `src/` were made in this session.

---

## 21 September 2026 — Correction pass on docs/INTERACTION-CONTRACT.md

### Corrected 11 citation defects from independent audit
An independent review checked every citation in `docs/INTERACTION-CONTRACT.md` against the repository and database migrations. All 11 defects were resolved while preserving the seven-rule structure, latency budgets, and six-states framework:
- **T1:** Replaced false headline claiming `RsvpLogForm.tsx` violated T1's first-response rule (since `setSaving(true)` runs synchronously before `await` and `Button` provides instant CSS touch feedback). Cited `src/app/(staff)/[eventCode]/rsvp/unmatched/UnmatchedTrayClient.tsx` lines 64–96, 188–195 ("Retry auto-match" triggers `matchRecording` without setting any loading/pending indicator) as a genuine failure of T1, while retaining the true narrower finding that `RsvpLogForm`'s layout change (`SavedState`) is gated behind sequential awaits.
- **T2:** Corrected the citation of `UndoBar` to reflect that it is not yet built under `src/` (aligning with §The Six States). Corrected description of `src/app/(staff)/[eventCode]/hospitality/deliveries/[deliverableId]/DeliveryDetail.tsx`: replaced the invented confirmation modal with what the code actually does (a plain `<Button loading={phase.name === 'uploading'}>Confirm delivery</Button>` at line 365, with no dialog, where line 397 confirms "What follows it is a stub, not a confirmation dialog", and line 392's "can never be undone" is an internal source comment rather than UI copy). Tightened `Phase` union line citation to lines 71–79.
- **T3:** Fixed description of `Button.tsx` behavior under `loading={true}` (lines 93–105): `loading` sets `disabled`, replaces `leadingIcon` with `<Spinner>`, and suppresses `trailingIcon`, while `{children}` (action label) continues to render unconditionally. Qualified `DeliveryDetail.tsx` as an example: while it uses `loading` on the irreversible proof commit at line 365, it also sets `loading` on the camera-capture button at line 331, which is not an irreversible commit. Tightened `RsvpLogForm.tsx` button citation to lines 374–382 (line 377 is `loading={saving}`).
- **T4:** Replaced non-existent route `rsvp/status/[groupId]/loading.tsx` with real loading component `src/app/(staff)/[eventCode]/rsvp/call/[groupId]/loading.tsx`.
- **T5 (Right):** Replaced non-existent `src/lib/actions/extraction.ts` and non-RPC caller `rsvp/review/[extractionId]/page.tsx` with `src/lib/actions/review.ts:24` (and `src/lib/actions/review-audit.ts:70`), which directly invoke `apply_rsvp_extraction()`.
- **T5 (Wrong — Central finding corrected):** Corrected false claim that `save_rsvp_log` makes the second `releaseGroupAfterCall` round trip "completely redundant". Verified against database migrations: `save_rsvp_log` (`20260807000502_code_auth_attribution.sql:133`, lines 194–195) nulls `locked_by` and `locked_until`, but does not clear `locked_by_staff` (which was introduced later in `20260808100000_attribution_split.sql`). In field/team sessions, `claim_group` sets `locked_by_staff = <staff id>` (`20260814140000_remove_staff_identity_gate.sql:121–124`). Nulling `locked_until` ends the lock's blocking effect, but the second call to `release_group` (`:154–155`) is necessary to clear `locked_by_staff`, which is an `ON DELETE RESTRICT` foreign key reference to `staff_members` (CLAUDE.md §5.9). Noted that code comments at `RsvpLogForm.tsx:189–191` and `src/lib/actions/rsvp.ts:26–27` ("belt to that braces") are themselves imprecise, and the second call cannot simply be deleted without updating the database RPC.
- **T7:** Corrected overstatements in `RsvpLogForm.tsx`: line 182 calls `setSaving(false)` unconditionally and errors are sanitized through `friendlyDbError()` (`src/lib/actions/rsvp.ts:99`). Clarified that the real defect is the lack of a `try/catch` around lines 176–181, which would leave `saving` permanently true on unhandled promise rejections, alongside the absence of an offline outbox queue.
- Verified all 22 cited file paths exist on disk via `test-results/ui2/check-paths.mjs`.

---

## 21 September 2026 — UI2 V0b: Finish the Royal Ivory & Gold Re-Skin (Elevation & Stale Palette)

### Completed the Re-Skin across Shadows, Inline Hexes, and Code Comments
Following the Royal Ivory & Gold redesign (DESIGN.md), colour tokens had re-skinned while shadows, inline styles, and code comments retained remnants of the legacy dark teal (#071A1D) and brass palette. This session completed the re-skin:

1. **Tokenised elevation (`--shadow-e1`, `--shadow-e2`, `--shadow-e3`):**
   - Added two-layer elevation tokens in `src/app/globals.css` across `:root` (tinted with staff charcoal `--ef-ink` #191c1d) and `[data-theme='client']` (tinted with client charcoal `--ef-ink` #1b2426). Exposed them via `@theme inline`.
   - Each layer stays strictly within the DESIGN.md 2%–4% opacity band (tight contact layer at 0.03/0.04, diffuse ambient layer at 0.03/0.04).
   - `--shadow-e1` provides hairline lift for resting cards and list rows.
   - `--shadow-e2` provides lift for raised surfaces like headline panels.
   - `--shadow-e3` provides directional lift for bottom sheets (negative vertical offsets rising from bottom edge).

2. **Replaced all 7 arbitrary `shadow-[...]` definitions:**
   - `src/components/ui/Card.tsx:37`: `shadow-[0_16px_40px_-22px_rgba(0,0,0,0.85)]` -> `shadow-e1`.
   - `src/app/(staff)/[eventCode]/page.tsx:198`: `shadow-[0_16px_40px_-22px_rgba(0,0,0,0.85)]` -> `shadow-e2`.
   - `src/components/ui/BottomSheet.tsx:75`: `shadow-[0_-20px_50px_-12px_rgba(0,0,0,0.8)]` -> `shadow-e3`.
   - `src/components/ui/Button.tsx:39`: removed `shadow-[0_10px_30px_-12px] shadow-brand/70` dark-UI brass glow -> `shadow-e1`. Rewrote comment to document white text on gold fill (`text-brand-fg` on `bg-brand`) and light ground, preserving the rule that it remains the only solid gold fill.
   - `src/app/(staff)/[eventCode]/hospitality/deliveries/[deliverableId]/DeliveryDetail.tsx:406`: replaced `shadow-[0_0_46px_-10px] shadow-brand/60` and `var(--ef-brand-tint)` with `bg-[radial-gradient(circle,var(--ef-green-tint),transparent)] shadow-e2`, shifting from a dark-plane light bloom to the emerald COMPLETED tint while preserving the `seal-in` flourish.
   - Both `GuestCard.tsx` files (`guests/list/_components/GuestCard.tsx:77` and `guests/_components/GuestCard.tsx:73`): `shadow-[0_2px_10px_-6px_rgba(27,36,38,0.28)]` -> `shadow-e1`.

3. **Enforced zero arbitrary shadows via regression test:**
   - Created `tests/no-arbitrary-shadows.test.ts`, scanning all `.tsx` files in `src/` to ensure no `shadow-[` class names can re-enter the tree.

4. **Repainted `src/app/global-error.tsx` in the light palette:**
   - Eliminated the only dark screen remaining in the app.
   - Applied inline hex values matching `:root` tokens: ground `#f8f9fa`, text `#191c1d`, muted `#4d4635`, button `#735c00` with text `#ffffff`.
   - Annotated WCAG contrast ratios in code comments (#191c1d on #f8f9fa is 16.8:1, #4d4635 on #f8f9fa is 8.9:1, #ffffff on #735c00 is 7.4:1). Added explanatory comment why inline hexes are required (root layout replacement without CSS bundle).

5. **Re-expressed sign-in wash (`src/app/(auth)/layout.tsx`):**
   - Removed legacy brass (17%) + verdigris (7%) two-wash gradient. Replaced with single soft gold wash using `var(--ef-brand-tint)` over `bg-paper`.

6. **Corrected stale dark-ground comments across 9 files:**
   - `(staff)/[eventCode]/layout.tsx:82`: warm ivory staff ground vs warm cream client paper.
   - `Card.tsx:9`: ivory paper ground.
   - `Field.tsx:73`: light ground and gold focus ring.
   - `PageTitle.tsx:28`: light ground LCD contrast.
   - `ErrorState.tsx:47`: light ground.
   - `(auth)/layout.tsx:7`: warm ivory ground with single gold wash.
   - Both `GuestCard.tsx` files: cream paper client view vs ivory staff ground.
   - `globals.css:302`: overscroll revealing warm ivory paper.
   - Noted known remaining comment in `src/app/layout.tsx:121` ("teal ground"), intentionally untouched due to strict session file modification boundaries.

---

## 21 September 2026 — UI2 V0b Correction Pass: Contrast Ratios, Seal Coherence, and Terminology

### Corrections Applied:
1. **Measured WCAG Contrast Ratios in `src/app/global-error.tsx`:**
   - Corrected the measured contrast values:
     - Text: `#191c1d` on `#f8f9fa` = 16.26:1 (AAA) (previously overstated as 16.8:1).
     - Muted: `#4d4635` on `#f8f9fa` = 8.88:1 (AAA) (previously rounded as 8.9:1).
     - Button: `#ffffff` on `#735c00` = 6.44:1 (AA) (previously claimed 7.4:1 AAA; correctly labelled AA since 6.44:1 is below the 7.0:1 threshold for normal text).
   - Root cause: The 7.4:1 figure was copied from a pre-existing comment in `src/app/globals.css` (lines 97–98 in the `--ef-brand` block, which claims `#735c00 carries white text at 7.4:1 as a fill`). That pre-existing comment in `globals.css` is also inaccurate and is reported here rather than silently changed.

2. **Visual Coherence of the Seal in `DeliveryDetail.tsx`:**
   - Restored the radial fill to `var(--ef-brand-tint)` (`bg-[radial-gradient(circle,var(--ef-brand-tint),transparent)]`), matching the gold outer ring (`border-brand`), inner ring (`border-brand/45`), text ("SEALED" `text-brand`), and divider (`bg-brand/50`).
   - Satisfied the "emerald COMPLETED tint rather than a light bloom" requirement by tinting the tokenised elevation using Tailwind's shadow-colour utility: `shadow-e2 shadow-ledger-green/40`.
   - `shadow-<colour>` is the correct architectural pattern because it colours the tokenised blur without introducing arbitrary `shadow-[...]` rules or placing an incoherent green fill inside a gold stamp.
   - Preserved `seal-in` animation, proof capture logic, and all existing classes.

3. **Terminology Consistency in `src/app/globals.css`:**
   - Aligned the comment at line 233 from `/* Brass — the accent. */` to `/* Gold — the accent. */` in accordance with the "Royal Ivory & Gold" design system.
   - Noted that `src/components/ui/Chip.tsx`, `src/components/ui/StatusPill.tsx`, and `src/app/(staff)/[eventCode]/logistics/fleet/FleetClient.tsx` also contain legacy references to "brass", left untouched because they fall outside the allowed file modification list for this session.

---

## 21 September 2026 — V1 (feel baseline) BLOCKED: the Playwright runner cannot start here

V1 was meant to measure what a runner actually waits for and replace the PROPOSED budgets in
`docs/INTERACTION-CONTRACT.md` with real numbers. **It produced no measurements.** The harness
is committed; the baseline is not.

**Built:** a `feel` Playwright project (its own project, not folded into `phone`, for the same
reason `perf` has one), `npm run test:feel`, and `e2e/feel.spec.ts` implementing M1–M5 across
the five named routes with CDP throttling at venue-Wi-Fi and 4G, 5 iterations each. The test
event is seeded to 543 guests at full family scale.

**Blocker:** the Playwright test runner hangs before it evaluates any spec module. Confirmed
three ways, and the third is the one that decides it — the repo's OWN pre-existing `phone`
suite (`e2e/tier0.spec.ts`) hangs identically. This is not a defect in the new harness; the
runner cannot run in this environment for any project.

**Ruled out, each tested directly:** the browser (standalone Chromium launch succeeded in
434 ms and rendered a page); missing browser revisions (all present, executablePath resolves);
stdio pipes (execSync and spawn both round-trip); named-pipe IPC, which is how the runner
reaches its workers on Windows (child_process.fork round-trips a message); orphaned workers
(none survived the killed runs); test discovery (`--list` lists the test correctly, so config
and spec load fine in-process — only worker spawn hangs).

**Consequences.** The Budgets table keeps its `[PROPOSED]` markers; they are unvalidated. V12
depends on the same runner and is blocked for the same reason. V2–V11 do not need a browser
and are unaffected. `docs/FEEL-BASELINE.md` records the evidence and the exact steps to
produce the real baseline elsewhere.

**Honesty note.** `e2e/feel.spec.ts` has never executed successfully. It is committed so the
work is not lost, NOT because it is known good — the first real run should be treated as a
smoke test of the spec, and selectors will likely need fixing before any number is trusted.
