---
tags: [ops, security, testing]
updated: 2026-07-31
---

# Security Tests

Back to [[EventFlow]]. Task `p1b`, file `test_security.sql`.

## What it sets up

Two events (Sharma, Patel), four users — one admin, `event_team` on each event, and one
client on event 1 — plus groups, guests, a hotel, a 2-bed room, and a hamper deliverable.
Auth is simulated with `set role authenticated` and `set request.jwt.claim.sub = '<uuid>'`.

## The eight tests

| # | Proves |
|---|---|
| 1 | `event_team` of event 1 sees only event 1; cross-event insert raises `insufficient_privilege`; a team delete affects 0 rows |
| 2 | client sees **0** rows in `guest_groups` and `call_attempts`, but 1 row in `client_guest_profiles` |
| 3 | a proof claiming `2020-01-01` gets stamped with real server time; update blocked; delete blocked; the deliverable flips to `delivered` |
| 4 | third guest in a 2-bed room raises `check_violation`; override with a reason is accepted |
| 5 | call attempt claiming `2019` gets server time; first completion accepted; second edit blocked once finalized |
| 6 | second caller claiming a locked group raises `lock_not_available` |
| 7 | `apply_rsvp_extraction()` commits group + travel leg atomically; `v_travel_ledger` reports `departure_missing`; `v_rsvp_queue` reflects it |
| 8 | `audit_log` captured every insert and update, readable by admin only |

## How to run it

> [!danger] Scratch database only
> It inserts directly into `auth.users` and **ends with `commit;`, not `rollback`** — the
> test data persists. Never run it against a database holding real guest data.

```bash
npx supabase db reset                            # local stack, replays migrations
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f test_security.sql
```

## It is a semi-manual harness

Not a pass/fail suite. Two different mechanisms are mixed:

- **Hard assertions** — `do $$ … raise exception 'FAILED: …' … exception when
  <expected_error> then raise notice 'PASS' end $$`. These genuinely fail the script if the
  security hole exists, because `ON_ERROR_STOP` is on.
- **Printed counts you must read** — Test 1's `groups_visible_to_team1`, Test 2's three
  counts, Test 8's audit summary. Nothing fails if these are wrong; a human has to look.

So "8 tests passing" means: the script ran to completion **and** someone eyeballed the
counts. Worth converting the printed ones into assertions if this is ever run in CI.

## Still to do

> [!warning] Never run against the live project
> These tests have only run on a Postgres 16 scratch instance. The live project is
> Postgres 17 and the migrations have not been pushed. Run against a **local**
> `supabase db reset` stack after the first push — not against the cloud project, which
> will hold real guest data. See [[Supabase Project]].

## Related

[[Tenancy and RLS]] · [[Roles and Access]] · [[Schema Reality Check]] · [[Status]]
