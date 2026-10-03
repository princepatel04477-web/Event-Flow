# EventFlow — what changed, 3 October 2026

A plain-English summary of this round of feedback. No code words.

**1. The export numbers (PAX / quantity).**
The Excel export now shows each family's real number of guests instead of a
1, and the room sheet has a "PAX" column that adds up correctly. *Find it:
Guests → Export.*

**2. Planning vehicles from the board.**
Fixed. Before, when the planning screen could not read its data it just looked
empty — now it says what went wrong and offers a Refresh button. The "Back to
fleet" button after you commit a plan also no longer lands on a dead page.
*Find it: a family on Arrivals/Departures → "Plan vehicles for this board".*

**3. The "Calls" section is now "RSVP".**
The tab, the page title and every heading now say RSVP. Nothing about how it
works changed.

**4. "Guests called" on the call list.**
The call list now reads **"Guests called 312 · 146 families"** — the big number
is guests, the small one is families. *Find it: RSVP → the top of the call
list.* (The Home screen still shows families only — see "Still waiting".)

**5. The logistics log.**
The vehicle/trip list now uses the same short two-line rows as the call log
instead of a big box per trip. Tap a row to see the vehicle, driver, pickup and
every family on that trip. *Find it: Logistics → Trips.*

**6. Notes on departures.**
The departure form now has a Notes box ("Anything the driver should know"). The
note shows under the row on the departures board and appears in the Excel
export. *Find it: Logistics → Departures → new departure.*

**7. Guests vs adults (in progress).**
The database change to record how many of a family's guests are adults and how
many are children (a child is under 12, and children count in "guests") is
written and waiting for you to say **"apply"**. Once applied, the split appears
on the family record, in the totals and in the exports.

**8. Rooms: occupied, with a bed, extra bed, not placed.**
The Rooms screen now shows four figures at the top — Occupied guests, With bed,
Extra bed, Not placed yet — and each room card reads "3 / 2 beds · 1 extra". A
guest in a room beyond its beds is counted as an **extra bed**, not as having a
bed. *Find it: Hospitality → Rooms.*

**9. Hampers by room (in progress).**
The database change for **one hamper per room** (a family split across rooms
gets one hamper in each) is written and waiting for **"apply"**. The new
"By room" hamper screen comes with it.

---

## Still waiting on you

1. **Say "apply"** for the two database changes above (guests/adults, hampers
   by room). Nothing is applied until you do.
2. **Home screen "guests called".** The Home screen's "Families called" bar
   cannot show guests yet, because that screen only loads totals, not each
   family's guest count. Adding it needs one small extra database count — tell
   us to add it.
3. **Which list is "the logistics log"?** We changed the vehicle/trip list. If
   you meant the arrivals/departures family list instead, say so and it is a
   small follow-up.

## One caution for the hampers change

The one-hamper-per-room database change must be applied **together with** the
new hamper screen work. Applied on its own it will stop the "Create them now"
hamper button from working. We will not apply it while a real event is running.
