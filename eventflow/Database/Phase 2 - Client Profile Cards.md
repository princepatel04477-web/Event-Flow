---
tags: [phase-2, rooms, clients]
updated: 2026-08-02
---

# Phase 2 — Client Profile Cards

Back to [[Nuvent]]. Current position within Phase 2.

## What's built

The client profile cards are done. `/[eventCode]/guests` renders `GuestCard`
components grouped by `family_head` via `FamilySection`. A `client`-role login
lands here and sees nothing else — it is their only screen.

Each card shows:
- Guest name
- Family head name
- Badges: side, group type, expected pax
- Arrival: date, time, mode, point
- Departure: date, time, mode, point (or blank if not recorded)
- Stay: hotel name + room number, or "Room not allocated yet"
- Hamper delivery status badge
- Return gift delivery status badge

The page is **deliberately ungated** — staff and admins can open it too. It is
genuinely useful as the "what does the client see?" view, especially for testing
the security boundary.

## How it works

`client_guest_profiles` is `security_invoker = false` — it runs as its owner
and **bypasses base-table RLS**. Its own `where app.is_member(g.event_id)` clause
is the only fence. This is the entire client security model:

```
Client → client_guest_profiles (owner, bypasses RLS, fenced by is_member)
       → cannot read guest_groups, call_attempts, or any base table (RLS returns 0 rows)
       → cannot discover other events exist (events RLS = is_member)
```

**Never join `client_guest_profiles` against a base table.** PostgREST reintroduces
that table's RLS, which for a client is zero rows — the result silently empties out.
The GuestsPage queries this view alone, in isolation.

## What's next

The cards render hotel + room from the view but say "Room not allocated yet"
because no `room_assignments` rows exist. The allocation backend is the next
Phase 2 task:

1. Staff-facing room management UI (hotels → rooms → assignments)
2. Allocation logic respecting `app.guard_room_capacity()`
3. Excel import commit path (`app.commit_guest_import()`) — Phase 1 leftover
   that must land before rooms, because room allocation needs guests to exist

The import parser already captures room and bed columns as `OPTIONAL_COLUMNS`
in `knownSheet.ts`. Once the commit RPC exists and allocations are written,
the existing `GuestCard` components light up with no frontend change.

## Related

[[Guests and RSVP]] · [[Rooms and Assignments]] · [[Views and RPCs]] · [[Excel Import]]
