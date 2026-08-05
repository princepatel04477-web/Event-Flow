Build hamper and return gift delivery for the event-ops app. Routes under
/team/deliveries, event_team and admin. The schema is deployed —
deliverables and delivery_proofs exist, proofs are insert-only, and
recorded_at is overwritten with the server clock by trigger. Do not modify
any migration and do not try to set recorded_at from the client.

1. GENERATING THE DELIVERY LIST — /admin/deliveries/generate, admin only
   Create deliverables rows for the active event:
   - kind 'hamper': one per guest_group that has an active room
     assignment. Groups with no room yet are listed as "waiting on a
     room", not skipped silently.
   - kind 'return_gift': ONLY for groups where needs_return_gift is
     true. Return gifts are for special guests, so the default is none.
   - Let me set item_name and quantity, in bulk and per group.
   - Idempotent: re-running after more rooms are allocated adds the new
     ones and touches nothing existing.

2. THE DELIVERY RUN — /team/deliveries
   The team member is walking a corridor holding a hamper in one hand.
   Design for that.
   - Group by hotel, then by floor, then room number ascending. That is
     walking order, and it is the whole point of the screen.
   - Each row: room number large and first, family head name, item and
     quantity, status.
   - Filter chips: Pending · Delivered · All. Default Pending.
   - A hotel and floor selector at the top, sticky.
   - Search by room number or family name.
   - Progress in the header: "14 of 62 delivered".

3. DELIVERING — /team/deliveries/[deliverableId]
   - Confirm the room and family, so nothing is delivered to the wrong
     door.
   - A big Take photo button using the Capacitor Camera plugin.
     Quality around 70, max width 1600 — this is proof, not photography,
     and it travels over a venue network.
   - Show the captured photo with Retake and Confirm.
   - Optional: received_by_name, notes.
   - On confirm: upload to storage, then insert the delivery_proofs row.

   STORAGE PATH — must begin with the event id:
     delivery-proofs/{event_id}/{deliverable_id}/{uuid}.jpg
   The bucket policy reads the first folder segment as the tenant key.
   Any other shape is rejected by RLS.

   Set device_captured_at from the phone if you like — it is stored as a
   reference and explicitly untrusted. recorded_at is set by the server
   trigger. Do not send it, do not display the phone's time as if it
   were the record.

   The insert flips the parent deliverable to 'delivered' by trigger.
   Do not update the status from the client as well; you will race the
   trigger for no benefit.

4. OFFLINE QUEUE — not optional
   Hotel corridors and basements have no signal. This is where the app
   either works or does not.
   - Store the photo blob plus the pending insert in IndexedDB (Dexie).
   - Mark the row "delivered, waiting to upload" in the UI immediately.
     The team member must not stand in a corridor waiting for a spinner.
   - Drain the queue on reconnect, oldest first, one at a time.
   - A persistent chip: "3 deliveries waiting to upload". Tapping it
     shows which.
   - Retry with backoff. After three failures, surface it as a real
     error with a Retry button — never drop a proof silently.
   - Deduplicate on the client-generated proof uuid so a retry cannot
     create two rows for one photo.

5. PROOF GALLERY — /admin/deliveries/proofs, admin only
   The dispute-settling screen. A family says they got nothing:
   - Search by room number or family name.
   - Show the photo, the SERVER timestamp, who captured it, and
     received_by_name.
   - Display the phone's own claimed time only if it differs materially
     from the server time, labelled "phone clock" — it is a diagnostic,
     not evidence.
   - No delete button. There is no delete path at any layer: no policy,
     no grant, and a trigger that raises. If a delete control appears in
     this UI, it is a bug.
6. RETURN GIFTS
   Same flow, kind 'return_gift', filtered to flagged groups only. A
   separate tab, not mixed into the hamper list — they happen on
   different days and mixing them causes double deliveries.

DEFINITION OF DONE
On a real Android phone:
- I walk a floor and deliver six hampers, each with a photo, in under
  three minutes.
- In airplane mode, three deliveries record and all three upload on
  reconnect, with no duplicates and none lost.
- Setting the phone clock to last year and delivering still records the
  correct server time.
- The proof gallery finds a delivery by room number and shows the photo
  with its server timestamp.
- Nowhere in the app can a proof be edited or deleted.
