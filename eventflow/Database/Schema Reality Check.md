---
tags: [database, gotchas, important]
updated: 2026-07-31
---

# Schema Reality Check

Back to [[Schema Overview]]. **Read this before trusting any design doc.**

Verified line by line against the seven migrations on 31 July 2026. Everything below is a
place where the written design and the actual SQL disagree, or where an obvious assumption
is wrong. Do not go hunting for these — they are not there.

## Room double-booking is not prevented by an EXCLUDE constraint

Docs describe a Postgres `EXCLUDE` constraint with `btree_gist` on
`(room_id WITH =, stay_range WITH &&)`. **None of that exists.** No extension, no
`stay_range` column, no exclusion constraint.

What exists: `app.guard_room_capacity()`, a trigger counting active rows, plus
one-active-room-per-guest. **Dates are never considered.** See [[Rooms and Assignments]].

## There is no "disputed proof" mechanism

No `disputed` column, no admin flow. `delivery_proofs` is genuinely immutable — the
`block_mutation()` triggers are unconditional, so admin and service role are blocked too.
Building disputes means a new sibling table. See [[Deliverables and Proofs]].

## `call_attempts` is not insert-only

It is **append-only with one-shot completion**. UPDATE is allowed until `outcome` is set;
then `finalized_at` stamps and the row freezes permanently. DELETE is blocked.

This matters for the call screen: write the outcome **once, at the end**. See
[[Guests and RSVP]].

## There are no `desk` or `hamper` roles

`app.event_role` is exactly `('event_team', 'client')`. See [[Roles and Access]].

## Audit trigger coverage is not universal

Docs say "every core table". Actually attached to: `events`, `profiles`, `event_members`,
`guest_groups`, `guests`, `travel_legs`, `call_attempts`, `call_recordings`,
`rsvp_extractions`, `hotels`, `rooms`, `room_assignments`, `deliverables`, `vehicle_types`,
`vehicles`, `trips`, `message_templates`, and `delivery_proofs` (insert only).

**Missing on:** `transcripts`, `trip_passengers`, `messages`, `import_batches`,
`import_rows`.

## The extraction payload is not the extraction contract

`apply_rsvp_extraction()` reads `remarks`, not `special_requests`. It ignores `language`
and `confidence` entirely. Full mapping in [[Extraction Contract]] — this is the single
most likely thing to silently lose data in `p1i`.

## `apply_rsvp_extraction()` cannot null a field

Every assignment is `coalesce(payload_value, existing_value)`. A reviewer who clears a
wrong flight number and saves will find it unchanged. If clearing must be supported, it
needs an RPC change.

## The live database is Postgres 17, not 16

Docs say Postgres 16. The Nuvent Supabase project runs **17.6.1.155**. The migrations
were verified on a separate PG16 instance and have **not been applied to the live project**.
See [[Supabase Project]].

## Smaller surprises

- `rooms` is `unique (hotel_id, room_number)`, not keyed on `event_id` — safe, because
  `hotel_id` is already event-fenced
- `guests` allows at most one head per group — partial unique on `(group_id) where is_head`
- `deliverables_one_per_group_kind` only constrains rows `where guest_id is null`
- `trips.seats_used` is maintained by `app.recount_trip_seats()`. **Never write it from
  application code.**
- `trip_passengers` allows at most one row per `travel_leg_id`
- `delivery_proofs` insert requires `captured_by = auth.uid()` — cannot be set to anyone
  else, even by an admin
- `event_team` deleting a row gets **0 rows affected, not an error**. UI must not read
  success as deletion.
- `client_guest_profiles` is `security_invoker = false` and bypasses RLS — its `where`
  clause is the only fence

## Related

[[Tenancy and RLS]] · [[Views and RPCs]] · [[Known Traps]] · [[Security Tests]]
