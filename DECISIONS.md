# DECISIONS.md

Non-obvious decisions, newest first. Per CLAUDE.md §14: record it here as it is
made, so the next session does not re-litigate it.

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
