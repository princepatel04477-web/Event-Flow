---
tags: [database, phase-2]
updated: 2026-07-31
---

# Rooms and Assignments

Back to [[Schema Overview]]. Migration `0300`. Phase 2.

## `hotels` and `rooms`

`hotels` is unique per `(event_id, name)`. `rooms` is unique per `(hotel_id, room_number)` —
which is safe without `event_id` in the key, because `hotel_id` is already event-fenced.

`rooms.capacity` is required and `> 0`. The client supplies it. `is_blocked` marks a room
out of service.

## `room_assignments`

One row per guest per stay. **Released rows stay** — `released_at` plus `release_reason`,
never a delete — so a room swap on the day is fully traceable.

Two singles deciding to share is just two rows pointing at one `room_id`, within capacity.
Nothing special needed.

A partial unique index enforces one active room per guest:

```sql
room_assignments_one_active_per_guest on (guest_id) where released_at is null
```

## The capacity guard

`app.guard_room_capacity()` fires before insert or update. It counts active assignments for
the room, and raises `23514` if adding one more would exceed `rooms.capacity`.

Override is explicit and requires a reason — a table-level check enforces it:

```sql
check (not is_override or override_reason is not null)
```

So "family insisted on staying together" is recorded, not silently allowed.
Auto-allocate first, manual always wins.

Rows with `released_at` set skip the guard entirely.

## What the guard does *not* do

> [!warning] Dates are never checked
> There is **no** `EXCLUDE` constraint, no `btree_gist`, no `stay_range` column. Any doc
> claiming date-range exclusion is wrong — see [[Schema Reality Check]].
>
> `check_in_date` / `check_out_date` / `check_in_time` / `check_out_time` are
> **informational only**. Two guests in the same room on non-overlapping dates still both
> count against capacity, and will be refused at the limit.

For a 3-day wedding where everyone stays the whole time, this is fine. If staggered stays
with room reuse become a requirement, true date-range exclusion is **new work**: add
`btree_gist`, a `daterange` column, and an `EXCLUDE USING gist (room_id WITH =, stay_range
WITH &&) WHERE (released_at IS NULL)`.

## Feeding the client view

`client_guest_profiles` joins the guest's active assignment to get hotel name and room
number. A guest with no active assignment shows nulls there, not a missing card.

## Related

[[Deliverables and Proofs]] · [[Views and RPCs]] · [[Schema Reality Check]]
