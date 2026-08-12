---
tags: [status]
updated: 2026-08-02
---

# Status

Back to [[Nuvent]]. As of **2 August 2026**.

## Done

**`p1a` — Database schema, RLS, audit triggers.**
7 migrations + 1 realtime migration. Covers all 19 SRS sections.
See [[Schema Overview]].

**`p1b` — `test_security.sql`, 8 tests.**
Cross-event insert blocked, client sees nothing in base tables, phone clock
overwritten, room capacity guard fires, lock collision prevented. See [[Security Tests]].

**`p1c` — Excel import PREVIEW (parse + warn + display).**
Full parse pipeline in `src/lib/import/` — 9 files: `parse.ts`, `knownSheet.ts`,
`layout.ts`, `families.ts`, `cells.ts`, `normalize.ts`, `mapper.ts`, `rows.ts`,
`hash.ts`. Mobile normalisation, idempotent re-import via `source_row_hash` +
head-name fallback matching. Preview page at `/import` shows `SummaryBar`,
`FamilyList`, and `WarningsList`. Guarantee #5 tracked in code.
**The database commit path does not exist yet.** `src/lib/actions/import.ts` is
read-only (counts existing families/guests only). The write is gated on a single
`app.commit_guest_import()` Postgres function — one transaction, one outcome. See
the "Why no commit path" header in [[Excel Import]].

**`p1d` — Auth, event switching, role routing.**
Supabase PKCE OAuth. Login form + callback route. Middleware refreshes sessions.
Three route groups: `(admin)`, `(staff)`, plus `(auth)` for login.
`requireStaff()` / `requireAdmin()` page guards. `BottomTabs` adapts to role
(4 admin / 3 event_team / none for client). `EventSwitcher` for admin.
`/admin/events` — event list + create form. Full [[DECISIONS.md]] record.
**Client guest profile cards are built here** — see `/[eventCode]/guests`.
See [[Roles and Access]].

**`p1e` — Calling queue.**
`v_rsvp_queue` + `claim_group()` rendered as `QueueBoard` with `QueueRow` and
`QueueFilters`. Realtime on `guest_groups` + `call_attempts` via migration 0800
(`replica identity full`). Filter by status, search by name, sort by priority.
See [[Guests and RSVP]].

**`p1f` — Call screen.**
`tel:` dial + outcome logging. Claim → dial → outcome. `sessionStorage`-backed
resume for Android page-state loss. Offline outbox via IndexedDB. Strict dial
(10-digit Indian numbers only, no silent truncation to wrong number).
See [[RSVP Capture Pipeline]].

**`p1h` extraction model + `p1i` review screen.**
`src/lib/review/` — `payload.ts`, `confidence.ts`. Review queue at `/review`,
detail form at `/review/[extractionId]`. `ReviewForm` with amber highlights
below 0.8 confidence. Payload translation (`special_requests` → `remarks`).
See [[Extraction Contract]].

## Still to do (Phase 1 leftovers)

| | |
|---|---|
| Import commit | Write `app.commit_guest_import()` — the one thing standing between preview and data |
| `p1g` | Native call-recording Capacitor module — see [[Open Questions]] |
| `p1j` | Excel export |

## Phase 2 — Rooms (current)

The client profile cards (`/[eventCode]/guests`) are built. `GuestCard` shows:
name, family head, side/type/pax badges, arrival leg, departure leg, hotel +
room number ("Room not allocated yet" if none), hamper + return gift status.

What remains: the **allocation backend**. The import parser captures room/bed
columns as `OPTIONAL_COLUMNS` but nothing writes them to `room_assignments`.
The `GuestCard` renders what the view returns — once rows exist, the cards
light up with no frontend change.

## Repo state

- 8 git commits on `master`, from scaffold through p1d
- ~97 TypeScript/TSX files
- Supabase project `xktxnkuzplhzxkevwrcj` (Varunya Technologies, ap-northeast-2)
- Postgres 17.6.1.155
- `CALLING_MASTER_LIST.xlsx` is **not in the repo**
- The realtime migration (0800) is written but **not applied** — live sync is inert until `supabase db push`

## Working rules

- Start each session by stating the task's goal and its **definition of done**
- End each session by committing to Git **and testing on a real Android phone**
- Record every non-obvious decision in `DECISIONS.md` as it is made
- If a task isn't finished, **simplify it on the spot** rather than borrowing from the next one
- After feature freeze, the answer to every "can we also add…" is "after the event"

## Related

[[Roadmap]] · [[Schema Overview]] · [[DECISIONS.md (vault note)|DECISIONS.md]]
