---
tags: [ops, infrastructure]
updated: 2026-07-31
---

# Supabase Project

Back to [[EventFlow]].

## The project

| | |
|---|---|
| Name | EventFlow |
| Ref | `xktxnkuzplhzxkevwrcj` |
| Org | Varunya Technologies (`cuwsovksnpfsoaonyteg`) |
| Region | ap-northeast-2 |
| Postgres | **17.6.1.155** |
| Created | 30 July 2026 |
| Linked to repo | **no** |

> [!warning] Postgres 17, not 16
> Docs say the schema was verified on Postgres 16 — that was a separate instance. The live
> project is 17. Re-run [[Security Tests|test_security.sql]] after the first push.

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

## First-time setup — not yet done

```bash
npx supabase init
npx supabase link --project-ref xktxnkuzplhzxkevwrcj
mkdir -p supabase/migrations && mv 2026*.sql supabase/migrations/
npx supabase db push
```

Migration files currently sit at the **repo root**, not in `supabase/migrations/`, so
`db push` will not see them until they move.

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
