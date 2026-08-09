---
tags: [ops, infrastructure]
updated: 2026-08-02
---

# Supabase Project

Back to [[Nuvent]].

## The project

| | |
|---|---|
| Name | Nuvent |
| Ref | `xktxnkuzplhzxkevwrcj` |
| Org | Varunya Technologies (`cuwsovksnpfsoaonyteg`) |
| Region | ap-northeast-2 |
| Postgres | **17.6.1.155** |
| Created | 30 July 2026 |
| Linked to repo | `supabase link --project-ref xktxnkuzplhzxkevwrcj` ✓ |

> [!warning] Postgres 17, not 16
> Docs say the schema was verified on Postgres 16 — that was a separate instance. The live
> project is 17. Re-run [[Security Tests|test_security.sql]] after the first push.

## First-time setup — done

```
npx supabase init ✓
npx supabase link --project-ref xktxnkuzplhzxkevwrcj ✓
npx supabase db push ✓
```

Migrations live in `supabase/migrations/`:

| File | Contents |
|---|---|
| `20260731000100_foundation.sql` | extensions, enums, tenancy, access helpers, audit, guards |
| `20260731000200_guests_rsvp.sql` | groups, guests, travel legs, call chain |
| `20260731000300_rooms_deliverables.sql` | hotels, rooms, assignments, deliverables, proofs |
| `20260731000400_logistics_messaging.sql` | vehicles, trips, templates, messages, import audit |
| `20260731000500_rls.sql` | every RLS policy, storage buckets |
| `20260731000600_views_rpc.sql` | 4 views, 3 RPCs |
| `20260731000700_seed.sql` | vehicle types, message templates, bootstrap notes |
| `20260731000800_realtime.sql` | `guest_groups` + `call_attempts` → publication, `replica identity full` |

> [!danger] Realtime migration (0800) is NOT applied
> The file exists in `supabase/migrations/` but has not been pushed. Live sync
> is inert until `npx supabase db push`. Publishing only `guest_groups` would
> leave call-attempt counters stale on every other phone — both tables need to
> be in the publication. Both use `replica identity full` so DELETEs carry
> `event_id` in the payload.

## The CLI is not on PATH

There is no global `supabase` binary on this machine. **Always go through `npx`.**

```bash
npx supabase --version
npx supabase projects list     # also shows which account is logged in
npx supabase orgs list
```

> [!note] Check the account first
> This machine has had more than one Supabase account logged in. `npx supabase orgs list`
> should say **Varunya Technologies**. If it says anything else, run `npx supabase login`
> before touching migrations.

## Storage buckets

Created by migration `0500`, both **private**:

| Bucket | Path convention |
|---|---|
| `call-recordings` | `{event_id}/{group_id}/{uuid}.m4a` |
| `delivery-proofs` | `{event_id}/{deliverable_id}/{uuid}.jpg` |

Select + insert policies only. No update, no delete — deliberately. See
[[Tenancy and RLS]].

## Bootstrap after first push

1. You and your friend sign up through the app, or via Supabase Auth → Add user
2. In the SQL editor:

```sql
update public.profiles set global_role = 'admin'
 where id in (select id from auth.users
              where email in ('you@example.com','friend@example.com'));
```

This works because `app.guard_profile_role()` short-circuits when `auth.uid()` is null,
which it is in the SQL editor. See [[Tenancy and RLS]].

3. Create the event, then the team and client logins, then grant them:

```sql
insert into public.events (name, code) values ('Sharma Wedding','SHARMA26');

insert into public.event_members (event_id, user_id, role)
values ('<event-uuid>', '<team-user-uuid>',   'event_team'),
       ('<event-uuid>', '<client-user-uuid>', 'client');
```

That is the whole access model. See [[Roles and Access]].

## Related

[[Security Tests]] · [[Status]] · [[Stack Decisions]]
