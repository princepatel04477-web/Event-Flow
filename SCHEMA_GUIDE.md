# Event Software — Database Schema

Postgres / Supabase. Seven migrations, applied in filename order.
All of it has been run and tested against a real Postgres 16 instance.

---

## How to apply

```bash
supabase init                     # if not already
# copy supabase/migrations/*.sql into your project
supabase db push                  # or paste each file into the SQL editor, in order
```

Or, in the Supabase SQL editor, run the seven files top to bottom.

### Bootstrap, once

1. You and your friend sign up through the app (or Supabase Auth → Add user).
2. In the SQL editor:

```sql
update public.profiles set global_role = 'admin'
 where id in (select id from auth.users
              where email in ('you@example.com','friend@example.com'));
```

3. Create an event, then create the team and client logins, then grant them:

```sql
insert into public.events (name, code) values ('Sharma Wedding','SHARMA26');

insert into public.event_members (event_id, user_id, role)
values ('<event-uuid>', '<team-user-uuid>',   'event_team'),
       ('<event-uuid>', '<client-user-uuid>', 'client');
```

That is the whole access model. There is no fourth role and no global
"see everything" switch except `profiles.global_role = 'admin'`.

---

## The three roles, precisely

| | admin (you + friend) | event_team | client |
|---|---|---|---|
| Scope | every event | one event | one event |
| Base tables | read + write + delete | read + insert + update | **nothing** |
| Views | all | staff views | `client_guest_profiles` only |
| Can see other events exist? | yes | no | no |
| Can change roles? | yes | no | no |
| Can delete anything? | yes (except proofs) | no | no |

A client login querying `guest_groups` gets **zero rows**, not an error. It
cannot discover that another wedding exists in the same database.

---

## Table map

**Tenancy** — `events`, `profiles`, `event_members`, `audit_log`

**Phase 1: RSVP**
- `guest_groups` — the calling unit. One row per family head. Carries
  `expected_pax`, `confirmed_pax`, `rsvp_status`, `needs_return_gift`,
  and the caller lock (`locked_by` / `locked_until`).
- `guests` — individual members, linked to a group.
- `travel_legs` — arrival **and** departure in one table, so LHS = RHS is one query.
- `call_attempts` → `call_recordings` → `transcripts` → `rsvp_extractions`

**Rooms** — `hotels`, `rooms`, `room_assignments`

**Hampers / return gifts** — `deliverables`, `delivery_proofs`

**Logistics** — `vehicle_types`, `vehicles`, `trips`, `trip_passengers`

**Messaging / import** — `message_templates`, `messages`, `import_batches`, `import_rows`

**Views** — `client_guest_profiles`, `v_rsvp_queue`, `v_travel_ledger`, `v_event_dashboard`

**RPCs** — `claim_group()`, `release_group()`, `apply_rsvp_extraction()`

---

## The five guarantees, and where they live

1. **Every table is fenced by `event_id`.** RLS uses `app.is_staff(event_id)`.
   Child tables use composite foreign keys `(child_id, event_id)`, so a row
   physically cannot point at a parent in a different event.

2. **Hamper photos cannot be faked or removed.** `delivery_proofs` has no
   UPDATE or DELETE policy, no UPDATE/DELETE grant, and a trigger that raises
   on both. Storage has upload + read policies only. `recorded_at` is
   overwritten with `now()` on every insert, so a phone with a wrong clock
   backdates nothing. The phone's own claim is kept in `device_captured_at`
   for reference, clearly marked as untrusted.

3. **Call attempts are append-only.** Attempt count is `count(*)`, never a
   stored counter — stored counters drift the moment two devices go offline.
   A row can be completed once (`ended_at`, `outcome`), then it freezes.

4. **AI output is evidence, not data.** A transcript and an extraction change
   nothing. Only `apply_rsvp_extraction()`, called after a human reviews the
   screen, writes to `guest_groups` and `travel_legs` — in one transaction, so
   a review lands completely or not at all.

5. **Excel re-import is idempotent.** `guest_groups.source_row_hash` is unique
   per event. Running the same sheet twice changes nothing instead of creating
   238 duplicates.

---

## Gotchas that will bite you

**Storage paths must start with the event id.** The bucket policies read the
first folder segment as the tenant key:

```
delivery-proofs/{event_id}/{deliverable_id}/{uuid}.jpg
call-recordings/{event_id}/{group_id}/{uuid}.m4a
```

Get this wrong and every upload is rejected.

**Create a `guests` row for the family head at import time.**
`client_guest_profiles` is built from `guests`, not `guest_groups`. If the
Excel import only creates groups, the client's screen will be empty.

**Bus capacities are estimates.** Your numbers were exact for sedan (3),
SUV (4), and travellers (17→14, 20→17, 24→20, 33→29). You gave bus sizes
(34 and 56) but not the luggage-adjusted figure. I seeded 30 and 50 as
placeholders — confirm with your transport vendor and update
`vehicle_types` before the first dispatch.

**Room capacity is enforced.** Adding a third guest to a two-bed room raises
an error unless you set `is_override = true` with an `override_reason`. Your
"two singles decide to share" case just works — that is two rows pointing at
one room, within capacity. Auto-allocate first, manual always wins.

**Deletes are admin-only everywhere**, and delivery proofs cannot be deleted
by anyone at all, including you.

---

## Verify it yourself

`test_security.sql` sets up two events, four users, and proves all of the
above. Run it against a scratch database. All eight tests pass:

1. event_team of Event 1 sees only Event 1; cross-event insert is blocked
2. client sees zero base-table rows, one profile card
3. hamper proof: server clock wins over a lying phone; update and delete blocked
4. room capacity guard fires; override with a reason is accepted
5. call attempt server clock; frozen after finalize
6. two callers cannot lock the same family
7. reviewed extraction commits group + travel leg atomically
8. audit log captured every insert and update

---

## Next

The schema is done and covers all nineteen sections of your SRS, not just
Phase 1 — retrofitting `event_id` across twenty tables in week three is how
deadlines die, so the tables exist now even where the UI does not.

Phase 1 UI order: Excel import → calling queue → call screen → recording
upload → transcript → extraction → review screen → Excel export.
