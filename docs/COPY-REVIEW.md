# COPY-REVIEW — "Speak Like an Indian Event Team"

The record of the L-series. `docs/COPY-INDIA.md` holds the wording authority;
this file holds what each prompt changed and what it deliberately left.

Run the guard with `npm run test:copy`. It scans the v2 screens and
`src/components` for the phrases `docs/COPY-INDIA.md` §2 bans, skips comment
lines, and lets a line opt out with `// copy-ok: <reason>`.

## What changed

| Prompt | What it did |
|---|---|
| **L0** | `docs/COPY-INDIA.md` created; `docs/GLOSSARY.md` marked superseded. PAX returns to staff screens. |
| **L1** | Home: "Today's Status", Total PAX, calls pending, "Pending Work", the attention cards and their buttons, "Calls done" / "Rooms allotted", "How to use". |
| **L2** | Nav labels: Dashboard, Guest List / Import from Excel / Export to Excel, Calling List / Call Records / Auto Dialer, Arrivals / Departures / Vehicles / Pickup & Drop, Room Allotment / Rooming List / Check-in / Check-out / Hotel & Room Setup. |
| **L3** | RSVP outcomes in the callers' words (Confirmed, Not coming, Not picking up, Not sure yet, Call back later), "Call now", "What did they say?". |
| **L4** | Hospitality: PAX room wording ("Room full (2/2 PAX)"), check-in buttons, "Room no." / "Capacity (PAX)", room types "Twin/Triple sharing", hamper status and the sealed-proof confirmation. |
| **L5** | Logistics: Vehicles (was Fleet), Pickup & Drop (was Trips), "seats with luggage", driver sheets. |
| **L6** | Errors and empty states to V9/V10 ("No internet", "Could not search", "No match", the vehicle and driver-sheet states). |
| **L7** | Client view: no raw error text, "for viewing only"; already said "guests" everywhere. |
| **L8** | `src/lib/format/india.ts` (`en-IN` / `Asia/Kolkata`) + tests; driver sheets moved over. |
| **L9** | This file and `tests/copy.test.ts`. |

## Deliberately left alone

- **Legacy `(staff)` screens.** Only the v2 tree is the live UI, so legacy
  copy was left and named in `DECISIONS.md` at each step rather than edited.
- **Excel export headers.** Out of scope by the series' own rule.
- **`nuvent_*` storage/cookie keys, route segments, section ids, enum values,
  DB columns.** Frozen; a change would be a rename, not copy.
- **Vehicle type names** ("Sedan", "SUV", "Tempo Traveller", "Bus") — DB rows,
  not UI copy.
- **Code comments.** Kept, per the series, even where they name an old string.
- **The full render-only formatting sweep.** Started (driver sheets); the rest
  is listed in `DECISIONS.md` under L8.

## Escape hatch

When a readable line must contain a banned word (a regex, a value that is not
screen text), add a reason on the line:

```ts
const alsoMatches = /still to call/ // copy-ok: matches old data, not shown
```
