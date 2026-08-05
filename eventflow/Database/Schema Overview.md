---
tags: [database, moc]
updated: 2026-07-31
---

# Schema Overview

Back to [[EventFlow]]. Eight migrations, applied in filename order.

| Migration | Contents |
|---|---|
| `0100_foundation` | extensions, enums, tenancy, access helpers, audit log, guard triggers |
| `0200_guests_rsvp` | [[Guests and RSVP]] — groups, guests, travel legs, the call chain |
| `0300_rooms_deliverables` | [[Rooms and Assignments]], [[Deliverables and Proofs]] |
| `0400_logistics_messaging` | [[Logistics]], [[Messaging and Import]] |
| `0500_rls` | [[Tenancy and RLS]] — every policy, plus storage buckets |
| `0600_views_rpc` | [[Views and RPCs]] |
| `0700_seed` | vehicle types, message templates, bootstrap notes |
| `0800_realtime` | `guest_groups` + `call_attempts` → publication, `replica identity full` |

## Table map

**Tenancy** — `events`, `profiles`, `event_members`, `audit_log`

**RSVP (Phase 1)** — `guest_groups`, `guests`, `travel_legs`,
`call_attempts` → `call_recordings` → `transcripts` → `rsvp_extractions`

**Rooms** — `hotels`, `rooms`, `room_assignments`

**Hampers / return gifts** — `deliverables`, `delivery_proofs`

**Logistics** — `vehicle_types`, `vehicles`, `trips`, `trip_passengers`

**Messaging / import** — `message_templates`, `messages`, `import_batches`, `import_rows`

**Views** — `client_guest_profiles`, `v_rsvp_queue`, `v_travel_ledger`, `v_event_dashboard`

**RPCs** — `claim_group()`, `release_group()`, `apply_rsvp_extraction()`

## The `app` schema

Everything that is not a table lives in `app`, not `public` — enums, access helpers, guard
triggers. `public` holds tables, views, and the three RPCs that the client calls.

Enums: `global_role`, `event_role`, `side`, `group_type`, `age_band`, `rsvp_status`,
`travel_direction`, `travel_mode`, `call_outcome`, `extraction_status`, `deliverable_kind`,
`deliverable_status`, `vehicle_status`, `trip_status`, `message_status`, `data_source`.

> [!note] `role_in_event`, not `event_role`
> The helper function is named `app.role_in_event(uuid)` because `app.event_role` is
> already the enum type. Easy to mistype.

## The composite foreign key pattern

Every parent table carries `unique (id, event_id)` — redundant on its own, since `id` is
already the primary key. Its purpose is to be a foreign-key target. Children then declare:

```sql
foreign key (group_id, event_id)
  references public.guest_groups (id, event_id) on delete cascade
```

This makes a cross-event row **physically impossible**, independent of RLS. A `travel_leg`
carrying event A's `event_id` cannot point at a group in event B, because no such
`(id, event_id)` pair exists. Belt and braces with the RLS policies.

## Standard triggers

`app.attach_standard_triggers(regclass)` attaches an audit trigger, plus a
`touch_updated_at` trigger where the table has an `updated_at` column. Coverage is **not
universal** — see [[Schema Reality Check]].

## Related

[[Tenancy and RLS]] · [[Roles and Access]] · [[Views and RPCs]] · [[Schema Reality Check]]
