---
tags: [database, security, architecture]
updated: 2026-07-31
---

# Tenancy and RLS

Back to [[Schema Overview]]. Guarantee #1: **every table is fenced by `event_id`.**

## Two independent fences

1. **Row Level Security** — policies call `app.is_staff(event_id)`
2. **Composite foreign keys** — `(child_id, event_id)` referencing `unique (id, event_id)`

Either alone would mostly work. Together, a cross-event row is both forbidden *and*
unrepresentable. See [[Schema Overview]] for the FK pattern.

## Access helpers

All four are `security definer` with `set search_path = ''`, so a policy calling them never
recurses back into RLS.

| Function | Returns |
|---|---|
| `app.is_admin()` | `global_role = 'admin'` and `is_active` |
| `app.role_in_event(uuid)` | the `event_role` for the caller on that event, or null |
| `app.is_staff(uuid)` | admin **or** `event_team` on that event |
| `app.is_member(uuid)` | admin **or** any role on that event (staff or client) |

`is_staff` gates base tables. `is_member` gates the `events` row itself and
`client_guest_profiles`. That difference is the whole client model — see [[Roles and Access]].

## The standard policy set

`app.apply_staff_policies(text)` enables **and forces** RLS, then creates four policies:

```sql
select  using (app.is_staff(event_id))
insert  with check (app.is_staff(event_id))
update  using (app.is_staff(event_id)) with check (app.is_staff(event_id))
delete  using (app.is_admin())          -- admin only, everywhere, always
```

Applied to: `guest_groups`, `guests`, `travel_legs`, `call_attempts`, `call_recordings`,
`transcripts`, `rsvp_extractions`, `hotels`, `rooms`, `room_assignments`, `deliverables`,
`vehicles`, `trips`, `trip_passengers`, `messages`, `import_batches`, `import_rows`.

> [!note] `force row level security`
> Not just `enable`. Without `force`, the table owner bypasses RLS — which would mean
> policies silently do nothing when a migration or an owner-run function touches the table.

## Tables with bespoke policies

| Table | Rule |
|---|---|
| `events` | select `is_member(id)`; insert/update/delete admin only |
| `profiles` | select/update self or admin; insert/delete admin only |
| `event_members` | select own rows or admin; all writes admin only |
| `delivery_proofs` | select + insert only, no update/delete policy at all |
| `vehicle_types` | global rows (`event_id is null`) readable by all, writable by admin |
| `message_templates` | same global-row rule |
| `audit_log` | select admin only; insert/update/delete revoked from `authenticated` |

`events` using `is_member(id)` rather than `is_staff` is what lets a client see the name of
their own wedding while remaining unable to discover any other event exists.

## Grants revoked outright

```sql
revoke update, delete on public.delivery_proofs from authenticated;
revoke delete        on public.call_attempts   from authenticated;
revoke insert, update, delete on public.audit_log from authenticated;
```

Grants sit *below* RLS. Even a policy bug cannot re-enable these.

The audit trigger still writes to `audit_log` because `app.audit_trigger()` is
`security definer` and runs as the owner.

## Bootstrapping the first admin

`app.guard_profile_role()` blocks any change to `global_role` by a non-admin — but
short-circuits when `auth.uid()` is null. That is the case in the Supabase SQL editor or
under a service-role key, and it is how the very first admin is created:

```sql
update public.profiles set global_role = 'admin'
 where id in (select id from auth.users where email in ('you@x.com','friend@x.com'));
```

## Storage

Both buckets are **private**, created in migration 0500:

| Bucket | Path convention |
|---|---|
| `call-recordings` | `{event_id}/{group_id}/{uuid}.m4a` |
| `delivery-proofs` | `{event_id}/{deliverable_id}/{uuid}.jpg` |

Policies read `(storage.foldername(name))[1]` and cast it to uuid, so **the first folder
segment is the tenant key**. Select and insert only — deliberately no update or delete
policy on either bucket. See [[Known Traps]].

## Related

[[Roles and Access]] · [[Schema Reality Check]] · [[Security Tests]]
