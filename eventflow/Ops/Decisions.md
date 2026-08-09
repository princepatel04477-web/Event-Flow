---
tags: [decisions, architecture, important]
updated: 2026-08-02
---

# Decisions

Back to [[Nuvent]]. Non-obvious decisions, newest first. Mirrors the root
`DECISIONS.md` and is kept in sync manually. The root file is the source of
truth for git history; this note is for vault search and cross-linking.

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
scope is a URL segment resolved through `getEventByCode()`. It also lets an admin
hold two weddings open in two tabs, which they will.

### The dashboard was showing clients a fabricated zero

`v_event_dashboard` is `security_invoker = true`, so for a client-role account
the outer `events` row passes RLS (`app.is_member`) while every subquery fails
it (`app.is_staff`) and `count(*)` returns **0, not null**. Fixed by
`requireStaff` on the page.

### Guards live in the pages, not the layout

`requireStaff()` and `requireAdmin()` are called at the top of each page body.
These are UX affordances — RLS is the security fence. What the redirect buys is
honesty: under RLS "you may not" and "there is no data" are the same empty result.
`/[eventCode]/guests` is deliberately ungated.

### Import is admin-only by product decision, not by RLS

One `requireAdmin` call in `import/page.tsx`. Relaxing it is two edits, no
migration.

### `app.is_admin()` is `global_role = 'admin' AND is_active`

`getViewer()` and `getEventAccess()` now read both. A deactivated admin is no
longer shown the admin shell then handed zero rows from `events`.

### `claim_group()` fences on the group's event, never the URL's

`claimGroupForCall` now proves the group belongs to the event in the URL before
it claims. An admin pasting a group id from another wedding no longer silently
locks a row there.

### `Membership.role` is fabricated for admins

Admins hold no `event_members` rows, so `getViewer()` lists every event and
reports `role: 'event_team'` for all of them. The only correct way to consume
it is centralised in `eventHomePath()`.

### A client gets no tab bar at all

Admin: 4 tabs, `event_team`: 3 (no Import), client: none — the layout drops
`pb-nav` for `pb-8` so there is no dead space.

---

## 31 July 2026 — Phase 1 application build

### Realtime was never actually on

Migrations 0100–0700 never add any table to the `supabase_realtime` publication.
Migration 0800 publishes `guest_groups` **and** `call_attempts` — both needed
because `v_rsvp_queue`'s attempt counters are computed from `call_attempts`.
Both get `replica identity full`. **Not yet applied** — needs `supabase db push`.

### Dialing is now strict

`dialTarget()` returns a `tel:` link only for a number that reduces to 10 Indian
digits, or one explicitly stored with a leading `+`. No silent truncation.

### Row identity survives a corrected mobile

`classifyRows` has a second pass matching on normalised head name. Two existing
families sharing a head name are treated as no-match rather than merged.

### "Callbacks due now" was impossible as specified

`v_rsvp_queue.next_callback_at` is `min(callback_at) filter (where callback_at > now())`
— it can only ever hold a future value. Relabelled **"Callback booked"**.

### `getEventAccess()` is for honesty, not authorisation

RLS remains the fence. This function exists to tell the user the truth where a
zero-row read would otherwise be presented as fact.

### A cancelled dialer is not an outcome

Replaced "Abandon" with two honest exits: **"Dial again"** re-fires `tel:` against
the same attempt row, and **"No call happened"** finalises as `other`.

### The import commit path was removed deliberately

An earlier supabase-js commit path existed — it was removed because it could not
be atomic (PostgREST has no multi-statement transaction) and had no protection
against overwriting RSVP status the calling team had already set. The replacement
is `app.commit_guest_import()`, a single Postgres function — not yet written.

## Related

[[Status]] · [[Roadmap]] · [[Known Traps]] · [[Schema Reality Check]]
