Build the client view for the event-ops app. Route /client, role 'client'
(admins may also view). This is the ONLY screen a client can reach.

1. DATA SOURCE — this matters
   Read exclusively from the existing view public.client_guest_profiles.
   Do NOT query guest_groups, guests, travel_legs, rooms or deliverables
   from this screen. That view is deliberately narrow: it exposes no
   mobile numbers, no expenses, no call history, no other event. Going
   around it re-opens everything it was built to close.

   It returns per guest: guest_name, family_head, group_type, side, pax,
   hotel_name, room_number, arrival_date, arrival_time, arrival_mode,
   arrival_point, departure_date, departure_time, departure_mode,
   departure_point, hamper_delivered, return_gift_delivered,
   needs_return_gift.

2. THE CARD
   One card per guest, exactly the fields agreed:
     guest name, large
     family head, if different from the guest
     PAX travelling with them
     arrival — date, time, mode
     departure — date, time, mode
     hotel and room number, if allocated
     hamper: delivered or pending
     return gift: delivered or pending, and HIDDEN ENTIRELY when
       needs_return_gift is false — return gifts are for special guests
       only, and a client seeing "pending" for everyone would be wrong
   Missing values read "Not yet confirmed", never a blank or a dash.

3. LIST AND SEARCH
   - Search by guest name or family head. Debounced, in the URL.
   - Filter chips: All · Arriving today · Departing today · Room
     allocated · Room pending · Hamper pending
   - Group by family, collapsed, with the head's name on the header row.
   - Virtualise the list — 465 guests will stutter otherwise.

4. A SMALL SUMMARY, TOP OF SCREEN
   Total guests, arriving today, departing today, rooms allocated,
   hampers delivered. Four or five numbers, no charts. The client wants
   reassurance at a glance, not a dashboard.

5. READ-ONLY, ENFORCED
   No edit controls anywhere. No forms, no buttons that write. RLS
   already blocks writes, but the UI must not offer an action that will
   fail — a disabled button the client keeps tapping is worse than no
   button.

6. PROOF PHOTOS — deliberately excluded
   Do not show hamper photos on this screen. The status flag is what the
   client needs day to day. The photos are the audit trail for disputes,
   and exposing 465 guests' delivery photos to a client login is a
   privacy decision I have not made. If a dispute needs settling, an
   admin pulls the photo.

7. MOBILE AND POLISH
   The client is likely the oldest user of this app and will open it on
   a phone. Large type, high contrast, generous spacing, 44px tap
   targets. Pull to refresh. A real loading state, never a blank screen.

DEFINITION OF DONE
- A client login sees only their event's guests, and no URL I try
  reaches another event or another screen.
- A guest with no room shows "Not yet confirmed", not a blank.
- Return gift status is absent for guests who are not flagged for one.
- Searching a family head shows the whole family.
- The list scrolls smoothly through 465 guests on a mid-range phone.
