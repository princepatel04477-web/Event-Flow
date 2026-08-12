# T1 audit — which existing tests were false green

Written 2026-08-11, while building `tests/t1_isolation.test.ts`.

The brief: *"Audit the existing 123 tests and report every one that uses service
role to test isolation — those are false green."*

The answer is worse than the question assumed. Two of the isolation tests are
false green, and separately **no UI test in the repo could ever have detected a
cross-tenant leak**, for a reason that has nothing to do with service role.

---

## 1. `tests/hotels.test.ts` — two tests that prove arithmetic

`hotels — DB-backed > cross-event isolation: hotel invisible to different event`
`hotels — DB-backed > cross-event isolation: room not visible from different event`

Both do this:

```ts
const sf = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)   // bypasses RLS
await sf.from('hotels').insert({ event_id: event1, name: hotelName })
const { data } = await sf.from('hotels')
  .select('id').eq('event_id', event2).eq('name', hotelName)       // ← event2
expect(data).toHaveLength(0)
```

The row was written with `event_id = event1`. The query filters
`event_id = event2`. It returns zero rows because `event1 ≠ event2` — with RLS
enabled, with RLS disabled, with every policy on the database dropped. The test
asserts that two different UUIDs are different.

The file's own comment admits it: *"Verify event2 cannot see it (RLS would
block, but with service key we test at DB level)"*. RLS is never exercised.

**They have also never run.** Both `return` early unless `E2E_EVENT_ID_2` is
set, and it was never in `.env.test`. So they were a pair of tests that would
have proved nothing, and did not even do that. `vitest` reported them green.

The other four DB-backed tests in that file (capacity `23514`, max_capacity,
`room_number` uniqueness `23505`, soft-delete blocked) are **legitimate** uses
of service role: CHECK constraints and triggers bind every role, so testing
them as service role is correct and is in fact the stronger test.

## 2. Every Playwright acceptance test runs as a global admin

Not a service-role problem, and bigger.

`e2e/helpers/auth.ts` logs in as `E2E_USER_A` / `E2E_USER_B`. Against the live
project both are `profiles.global_role = 'admin'`:

| user | `global_role` | membership |
|---|---|---|
| `princepatel04477@…` (USER_A) | **admin** | event_team on SAMPLE2026 |
| `patelprince125899@…` (USER_B) | **admin** | event_team on SAMPLE2026 |

An admin is *supposed* to see every event (CLAUDE.md §7). So an admin session
reading event B's rows is correct behaviour, and **no test driven by these two
accounts can distinguish a leak from working-as-designed** — regardless of how
the assertion is written. Both are also members of the *same* event, so there
was no second tenant to leak across in the first place.

## 3. The SQL suites are sound

`tests/l1_adversarial.sql` and `tests/l2_transcribe.sql` use
`set role service_role` **deliberately**, to prove the `delivery_proofs`
mutation triggers bind even the service role and even a superuser. That is the
guarantee under test, so anything weaker would not test it. Correct as written.

`tests/cross_tenant.sql` sets up two events and two users inside a transaction
and probes with real role switching. Sound — but it is a manual `psql` script
that no automated run invokes, so nothing enforces that it still passes.

---

## What the new suite found while being built

Three findings that only surfaced because the suite refused to accept a green
it could not explain.

### F1 — `app.is_staff()` no longer consults `event_members`

```sql
app.is_staff(p_event_id) =
  app.is_admin()
  OR (app.jwt_event_id() = p_event_id
      AND app.jwt_app_role() = 'team'
      AND app.code_is_live());
```

Since `20260809140000`, the only two ways to be staff are to be a **global
admin** or to hold a **code session**. An email/password user who is
`event_members.role = 'event_team'` is not staff and reads zero rows from every
table, including their own event.

Consequences:

- CLAUDE.md §7's role table is wrong for email/password members. `event_team`
  as a GoTrue role grants nothing.
- The `event_members` rows on SHARMA26 (one `event_team`, one `client`) grant
  nothing today.
- **It nearly made this suite vacuous.** T1's first draft used email/password
  members and passed all fifteen cross-tenant read checks — because those
  identities could not read anything at all. "B cannot see A" and "B is nobody"
  are the same observation unless you also prove B can see B. Every isolation
  assertion in the final suite is now paired with a **positive control**.

### F2 — nothing enforces recording consent

`call_recordings.consent_given` is `boolean not null default false` with **no
CHECK anywhere in the migrations**. A recording with `consent_given = false` is
accepted. The application sets it to `true` on the one path that writes
recordings, so the column documents an intention rather than enforcing it — and
because the default is `false`, any future insert path that simply omits the
column is accepted too.

`T1.7` is **red on purpose**. It is the honest state of the system. The fix is a
CHECK on the table; T1's job is to report, not to quietly paper over.

### F3 — a false pass inside the new suite itself

`T1.7` briefly went green. `call_recordings.storage_path` is `text not null
unique`, and the probe used a fixed path — so the second run collided with the
row the first run left behind and failed with `23505`. The assertion only asked
*"was there an error"*, so a unique violation read as "consent is enforced".

It now asserts the SQLSTATE is `23514` specifically, and uses a fresh path per
run. Worth recording because it is the same shape as everything else in this
document: **a test that passes for a reason other than the one in its name.**

---

## Rule now enforced

No assertion in `tests/t1_isolation.test.ts` runs on the service-role key.
Service role appears exactly twice: issuing access codes (setup), and the
immutability tests, where the guarantee is specifically *"not even service role
can do this"*. `assertCodeSession()` fails the run if an identity turns out to
be a service-role or wrong-event session.

## Still outstanding

**Mutation proof.** The brief asks that at least three tests be proven to fail
when their protection is temporarily removed. That has been demonstrated
organically for three:

1. `T1.7` fails because the protection genuinely does not exist (F2).
2. `S4.6` in the T3 smoke suite was proven to fail against the stale production
   build, then fixed and re-run.
3. The positive controls (F1) caught fifteen vacuous passes in T1.1.

Deliberate mutation — dropping an RLS policy, re-running, restoring — has **not**
been done, because the only database available is **production, holding real
guest data**. Dropping a policy there, even for seconds, is not a risk worth
taking for a test. It needs either a scratch database (`npx supabase db reset`
against a local stack) or explicit sign-off.
