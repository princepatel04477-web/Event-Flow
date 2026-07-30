---
tags: [database, phase-4]
updated: 2026-07-31
---

# Logistics

Back to [[Schema Overview]]. Migration `0400`. Phase 4.

## `vehicle_types` — capacities that tell the truth

`default_capacity` is **people carried with luggage**, not the sticker seat count. A
20-seater traveller is 17 in real life.

`event_id is null` means a global template, seeded in migration `0700`. `event_id` set
means this event's own type. Two partial unique indexes keep both namespaces clean.

| Type | Sticker | With luggage |
|---|---|---|
| Sedan | 4 | 3 |
| SUV (Ertiga / Innova) | 7 | 4 |
| Tempo Traveller | 17 | 14 |
| Tempo Traveller | 20 | 17 |
| Tempo Traveller | 24 | 20 |
| Tempo Traveller | 33 | 29 |
| Bus | 34 | **30 — unconfirmed** |
| Bus | 56 | **50 — unconfirmed** |

> [!warning] Bus numbers are guesses
> Confirm both with the transport vendor and update before the first dispatch. See
> [[Open Questions]].

## `vehicles` — the actual fleet

Entered by the event team, never hardcoded: every event has a different set of cars.
`capacity` is seeded from the type but editable per vehicle. Carries driver name and
mobile, vendor, rate note, and a `status` (`available` / `assigned` / `unavailable`).

## `trips` and `trip_passengers`

A trip has a direction, a schedule, pickup and drop points, a driver, a status
(`planned` → `dispatched` → `completed` / `cancelled`), and expense fields
(`expense_amount` in rupees, `expense_mode` — cash / upi / vendor bill).

`trip_passengers` links a trip to a group, optionally to a specific `travel_leg_id`. At
most one passenger row per leg, so a leg cannot be double-assigned to two trips.

> [!note] `seats_used` maintains itself
> `app.recount_trip_seats()` fires after any change to `trip_passengers` and recomputes
> `trips.seats_used` as `sum(pax)`. **Never write it from application code.**

## Vehicle suggestion is advisory

Greedy PAX fit, always human-overridable. The *recommendation* is
[[Scope Cuts|last on the cut list]]; the *assignment* is a must-have. A guest standing at
the airport with no car is a real failure; a slightly suboptimal seat allocation is not.

## Related

[[Guests and RSVP]] · [[Views and RPCs]] · [[Open Questions]]
