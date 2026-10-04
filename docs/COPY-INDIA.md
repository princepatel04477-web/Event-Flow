# COPY-INDIA.md — the wording authority for EventFlow

This file is the single authority for every string a person reads in EventFlow.
Where the older `docs/GLOSSARY.md` disagrees with this file, **this file wins**.

The app is used by event staff in Gujarat and across India on cheap Android
phones, and by the bride's/groom's family in a read-only client view. The wording
must read the way an experienced Indian event coordinator speaks.

---

## 1. Who reads this app

- **Staff:** coordinators and runners of an Indian event company. They know trade
  words (PAX, room allotment, rooming list, pickup, drop). They are busy, often
  on a call, one hand on the phone.
- **Client:** the bride's or groom's family. Respectful, simple, no trade jargon
  except words every Indian family already uses at weddings (room, pickup,
  hamper, return gift).

---

## 2. Voice rules

V1. Write how a senior Indian event coordinator talks to a junior: short, clear,
    polite, no drama.
V2. Use Indian event-industry words. PAX, allot/allotted, rooming list, pickup,
    drop, reporting time, PNR, family head, bride side, groom side, return gift,
    hamper, check-in, check-out.
V3. Status words come after the thing: "Hampers pending", "Rooms allotted",
    "Calls done".
V4. Numbers first, digits always: "6 hampers pending", never "six hampers".
V5. No American idioms: never "all set", "you're good to go", "heads up",
    "folks", "swing by", "with a bed", "still to", "right now", "no worries",
    "awesome", "oops".
V6. No old clerical Indian English either: never "kindly", "do the needful",
    "revert back", "prepone", "intimate (to inform)", "the same" (as a pronoun).
    Professional, not bureaucratic.
V7. No literary or cute words: no "journey", "magic", "let's", "yay",
    exclamation marks in status text.
V8. Buttons are verb + object and make sense alone: "Allot room", "Start
    calling", "Mark delivered", "Assign vehicle", "Add PAX". Never "Submit",
    "OK", "Next", "Go".
V9. Errors say: what happened, what to do, who to ask. "Could not save. Check
    your internet and try again. If it keeps failing, call your event manager."
    Error codes stay small and last.
V10. Empty states say why it is empty and what to do: "No rooms allotted yet.
     Allot rooms from the rooming list." plus one button.
V11. Staff screens say PAX. Client screens say guests.
V12. Title Case for nav and screen titles ("Room Allotment"); sentence case for
     everything else.

---

## 3. Formats (en-IN)

- Date: `20 Dec (Sat)`. With year only when not this year: `20 Dec 2027`.
- Time: `10:30 AM` (12-hour, capital AM/PM, no seconds).
- Date + time: `20 Dec, 10:30 AM`.
- Money: `₹1,25,000` (Indian lakh grouping, `Intl.NumberFormat('en-IN')`). No
  decimals unless paise.
- Phone: `+91 98765 43210` (space after 5 digits).
- Counts: "12/15 PAX", "3 of 5 families".

---

## 4. Word list

`term in code -> staff screen -> client screen -> short form if space is tight`

| In code / old screen text | Staff screen | Client screen | Short form |
|---|---|---|---|
| pax / guests (count) | PAX | Guests | PAX |
| Guests expected | Total PAX | Total guests | Total PAX |
| group / guest_group / family | Family | Family | Family |
| family head | Family head | Family head | Head |
| Guests with a bed / roomed | Rooms allotted | Room given | Allotted |
| no room yet | Room not allotted | Room pending | Not allotted |
| allocate (room) | Allot | — | Allot |
| Rooms (screen) | Room Allotment | Rooms | Rooms |
| rooming list | Rooming List | — | Rooming |
| Setup (rooms) | Hotel & Room Setup | — | Setup |
| Check in / out | Check-in / Check-out | — | Check-in |
| Call list / queue | Calling List | — | Calling |
| Call notes / extraction | Call Records | — | Records |
| Auto-call | Auto Dialer | — | Dialer |
| unmatched / unknown numbers | Unknown Numbers | — | Unknown |
| Families called | Calls done | — | Called |
| still to call | calls pending | — | pending |
| Fleet | Vehicles | — | Vehicles |
| Trips / travel leg | Pickup & Drop | Pickup & drop | Pickup |
| driver arrival time | Reporting time | — | Reporting |
| pickup location | Pickup point | Pickup point | Pickup |
| drop location | Drop point | Drop point | Drop |
| train number | Train no. & PNR | Train no. | Train |
| flight number | Flight no. | Flight no. | Flight |
| deliverable (hamper) | Hamper | Hamper | Hamper |
| deliverable (gift) | Return gift | Return gift | Gift |
| to deliver | pending delivery | on the way | pending |
| proof photo | Delivery photo | — | Photo |
| Right now | Pending Work | — | Pending |
| Today (home title) | Today's Status | Today | Today |
| How this app works | How to use | How to use | Help |
| side: bride / groom | Bride side / Groom side | Bride side / Groom side | Bride / Groom |
| access code | Login code | Login code | Code |

### Proposed additions (proposed — check)

Found by sweeping the v2 screens and `src/components` for user-visible strings
that section 4 did not already cover. Each row names the file it was found in.
Nothing here is authoritative yet — confirm before it is applied.

| Found in (file) | Old screen text | Proposed staff wording |
|---|---|---|
| `src/app/(app)/v2/[eventCode]/families/[groupId]/page.tsx` | Travel (section title) | Pickup & Drop |
| `src/app/(app)/v2/[eventCode]/families/[groupId]/page.tsx` | Stay (section title) | Rooms |
| `src/app/(app)/v2/[eventCode]/families/[groupId]/page.tsx` | Answer (section title) | RSVP |
| `src/app/(app)/v2/[eventCode]/families/[groupId]/page.tsx` | People (section title) | Family members |
| `src/app/(app)/v2/[eventCode]/logistics/fleet/FleetBoard.tsx` | Fleet / Fleet set-up / No vehicles in the fleet | Vehicles / Vehicle set-up / No vehicles added yet |
| `src/app/(app)/v2/[eventCode]/logistics/_components/TravelBoard.tsx` | Travel direction | Arrival or departure |
| `src/app/(app)/v2/[eventCode]/logistics/_components/TravelBoard.tsx` | Pickup needed | Pickup required |
| `src/app/(app)/v2/[eventCode]/hospitality/rooms/_components/PlaceFamilySheet.tsx` | How many go in one room? | Guests per room |
| `src/app/(app)/v2/[eventCode]/hospitality/rooms/_components/AllocateReview.tsx` | Families the plan can place | Families this plan can allot |
| `src/app/(app)/v2/[eventCode]/guests/_components/StaffGuestDirectory.tsx` | Search needs a signal | No internet. Saved items will send when the signal is back. |
| `src/app/(app)/v2/[eventCode]/guests/_components/ClientGuestDirectory.tsx` | Nothing matches | (client) No match. Try a different spelling. |
| `src/app/(app)/v2/[eventCode]/logistics/fleet/FleetBoard.tsx` | Capacity … with luggage / Sticker | Seats (with luggage) / Sticker seats |

---

## 5. RSVP call outcomes (display text only — enum values in the DB do not change)

| Meaning | Button / chip text |
|---|---|
| coming | Confirmed |
| not coming | Not coming |
| maybe | Not sure yet |
| no answer | Not picking up |
| unreachable / switched off | Not reachable |
| call back | Call back later |
| wrong number | Wrong number |

If an outcome in this table has no matching value in the code, do NOT add one.
List it.
