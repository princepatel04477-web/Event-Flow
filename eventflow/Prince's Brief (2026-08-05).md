---
tags: [brief, context, reference]
updated: 2026-08-05
---

# Prince's Brief (2026-08-05) — plain-terms product requirements

Back to [[EventFlow]]. This is the product owner's own words, captured verbatim as a
reference. It is the *what*; the *how* lives in the schema and code notes linked below.
Where this note and a code note disagree, the code note wins — but flag it, because the
product owner is the source of truth.

---

## What this is

A multi-tenant event ops platform. The admin (Prince + one friend) can run **multiple
events at once**. Each event gets its own credentials for:

- **Event team** — sees that event's data only, can edit/add (middle access)
- **Client** — sees that event's guest profiles only, read-only, cannot see other events

No fourth role. See [[Roles and Access]].

---

## RSVP (Phase 1 — the foundation)

For each family, the calling team captures:

- **Arrival date** and **arrival time**
- **Arrival pax** — "packs" = how many of the family's own members are travelling
  (e.g. "came with x, y, z family members")
- **Arrival mode** — one of:
  - Train
  - Flight
  - Bus
  - By road / self ("coming by themselves on road")

The calling unit is the **group**, not the guest — one call confirms the whole family.

See [[Guests and RSVP]] · [[RSVP Capture Pipeline]].

---

## Messages (WhatsApp)

- We have **one number** that sends WhatsApp messages via the WhatsApp API.
- OR: build our own open WhatsApp API from GitHub. **Decision not yet made** — see
  [[Open Questions]].

---

## Room allocation (Phase 2)

- The client provides **room numbers and room capacity**.
- We build a **smart allocation algorithm** that assigns guests to rooms.
- **Four guest types** drive the algorithm:
  1. Family (e.g. 6 people)
  2. Single person
  3. Couple
  4. Friends
- The client can see, for every profile: **"this person is living in this room."**
- If **two single people decide to share a room**, that pairing must be updateable —
  the allocation is not fixed; it is a living assignment.

See [[Rooms and Assignments]] · [[Phase 2 - Client Profile Cards]].

---

## Hamper + return gift (Phase 3)

- Event team goes room-to-room delivering hampers.
- Event team has **middle-level access** (below admin, above client): they can **upload a
  photo**.
- Photos must carry a **server-side timestamp** — when the photo was uploaded. Never the
  phone's claim. (Schema already enforces this: `delivery_proofs` insert-only, server
  clock only.)
- **Return gifts are NOT for everyone** — only special/selected guests.

See [[Deliverables and Proofs]].

---

## Departure (Phase 4)

- Checkout details come from the guests via anything — a Google Form, or a surprise
  departure the team must enter manually.
- Event team enters: **guest pax** and all the same fields as arrival.
- **The invariant: arrival = departure** (LHS = RHS). Every arrival must reconcile with
  a departure.
- Departure captures: **date, time, mode** (air / train / bus / cab / on road).
- **If cab**: record the **cab expense in rupees**.

See [[Logistics]].

---

## Logistics algorithm (Phase 4)

The algorithm takes all trip info and assigns vehicles. Vehicle types (general —
the event team enters the exact vehicles they actually have):

| Vehicle | Capacity (with luggage) |
|---|---|
| Sedan | 3 |
| SUV (Ertiga, Innova) | 4 |
| Traveller 17-seater | 14 |
| Traveller 20-seater | 17 |
| Traveller 24-seater | 20 |
| Traveller 33-seater | 29 |
| Bus 34-seater | 30 (seed) |
| Bus 56-seater | 50 (seed) |

The **exact number** of each vehicle per event is entered by the event team — we only
provide the general types. The traveller/bus capacities are **luggage-adjusted** (the
sticker number lies). Vehicle suggestion is advisory; always human-overridable.

See [[Logistics]].

---

## Client profile view (read-only)

The client sees a **basic profile card** for each guest:

- Name, family head's name
- Family person count (pax — who came with them)
- Arrival: time, date, mode
- Departure: time, date, mode
- **Hamper status** — yes / no
- **Return gift status** — yes / no

See [[Phase 2 - Client Profile Cards]] · `/[eventCode]/guests`.

---

## Access model recap

| Role | Sees | Can do |
|---|---|---|
| Admin (Prince + friend) | **All events** | Everything |
| Event team | **One event only** (their credentials) | Read + add + edit that event |
| Client | **One event only** (their credentials) | Read profiles only. Cannot see other events, cannot edit |

Exactly three roles. See [[Roles and Access]].
