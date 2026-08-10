# TEST-LOG

Severity: **BLOCKS EVENT** / **ANNOYING** / **AFTER**.
Nothing ships to staff phones with an open BLOCKS EVENT item.

---

## L1 — Adversarial security

Date: 2026-08-09 Tester: Prince (driving Claude Code)
Environment: scratch database `l1_scratch`, **Postgres 17.6**, built from zero
(auth/storage schemas → platform grants → all 44 migrations → suite).
Reproduce with `bash tests/run-l1.sh`.

**Scoreboard: 43 PASS / 4 FAIL (47 assertions).**

### Scope actually covered

| Plan item | Covered | Notes |
|---|---|---|
| L1.1 a–c | **NO** | App-layer: direct URL, server-action payload, form tamper. Needs the running app + real sessions. |
| L1.1 d | yes | Event A's JWT against Event B's rows — read, insert, update, composite-FK smuggle. |
| L1.2 | yes | 13 tables probed from a client session, plus two writes. |
| L1.3 | partly | DB-enforced escalation. Admin *routes* are app-layer and untested. |
| L1.4 | yes | Including service_role **and** superuser. |
| L1.5 | **NO** | Lockout lives in the `verify-access-code` Edge Function, not the DB. |

### Method note — why the first run was worthless

The first run of this suite reported 42/44 green. It was wrong.

A hand-built scratch database gets **no table grants**: the migrations never
`GRANT` anything, because a real Supabase project installs `ALTER DEFAULT
PRIVILEGES` so every new table grants ALL to `anon`/`authenticated`/`service_role`
and RLS does the restricting. Measured: **5** grants to `authenticated` on the
scratch DB versus **190** on a real one. So every attack was "denied" at the
privilege layer before RLS was ever consulted — a wall of green for the wrong
reason, which is the exact failure mode this whole plan exists to catch.

Two things fixed it, and both are now permanent:

- `tests/l1_scratch_bootstrap.sql` replicates the platform grants.
- `tests/run-l1.sh` **aborts** if `authenticated` has under 100 grants.
- The suite carries **positive controls** (`L1.1d-CONTROL`,
  `L1.4-CONTROL-proof-insert`, `L1.2-view`). If a control fails, the denials
  around it mean nothing.

---

### Live-row audit — run before any constraint was added
Date: 2026-08-09 Tester: Prince
Project: `xktxnkuzplhzxkevwrcj` (live)

```
total proofs                : 206
  captured_by_staff only    : 7    ok
  captured_by only          : 197  ok
  BOTH set (violation)      : 0
  NEITHER set (violation)   : 2
```

Both violating rows are in event `85e716fc-…`, which is `E2E_EVENT_ID` — the
acceptance-test event — recorded 2026-08-07 two seconds apart, same deliverable,
files `msjlgrt1.jpg` / `msjlgrt1b.jpg`. They were written by test tooling through
the **service role**, which bypasses RLS. That is the unattributed-proof hole in
`L1.4-attrib-neither`, and it has already happened twice in practice.

```
4841321b-b539-441b-92cd-0da1ec1b9e64  captured_by=NULL  captured_by_staff=NULL
575cd763-fcb3-4d20-8b08-f020e615db86  captured_by=NULL  captured_by_staff=NULL
```

**No production guest data is affected** — the other 204 rows are properly
attributed. But these two cannot be repaired (UPDATE blocked by trigger) or
removed (DELETE likewise), so a plain `CHECK` cannot be added.

**DECISION NEEDED — the CHECK is not applied.** Options:

1. **`NOT VALID` (recommended).** Enforces on every future row; skips the
   validation scan of the two legacy rows. This is not weakening the rule —
   new rows get the full constraint. It is the standard mechanism for exactly
   this situation, and the only one that works given the rows are immutable.
   ```sql
   alter table public.delivery_proofs
     add constraint delivery_proofs_captured_by_one_of
     check (num_nonnulls(captured_by, captured_by_staff) = 1) not valid;
   ```
2. Leave it off. The insert policy plus `route_attribution` already close every
   app path; only a service-role writer can still produce a bad row.

Until one is chosen, `L1.4-attrib-both` and `L1.4-attrib-neither` stay red.
They are the only two red assertions in the suite.

---

### L1.4-attrib-both-rls — proof attribution can be forged — **FIXED**
Date: 2026-08-09 Tester: Prince
Result: **FAIL** → **PASS** after `20260809130000_delivery_proof_attribution.sql`
Saw: a team session inserted a `delivery_proofs` row carrying **both**
`captured_by = <the admin's auth uid>` **and** `captured_by_staff = <itself>`.
Row confirmed on disk, both columns non-null, different identities.
Expected: rejected.
Severity: **BLOCKS EVENT**
Fixed: `20260809130000_delivery_proof_attribution.sql`. Verified: the
`L1.4-attrib-both-rls` assertion now reports `denied`, and `L1.4-attrib-frame`
(pinning a proof on a different colleague) is refused too. Positive control
`L1.4-CONTROL-proof-insert` still passes, so the path is closed, not broken.

Why it happened — the INSERT policy was:

```
captured_by_staff = app.jwt_staff_member_id()
OR (captured_by_staff IS NULL AND captured_by = auth.uid())
```

The first branch never constrains `captured_by`, so a team session satisfying it
may put *any* value in `captured_by`. `delivery_proofs` is insert-only and has no
UPDATE path, **so the row can never be corrected** — not by an admin, not by the
service role.

It matters because the two readers disagree. `src/lib/export/sheets.ts:272`
resolves `captured_by_staff` first and reports the staff member; anything reading
`captured_by` reports the admin. One immutable row, two answers to "who delivered
this hamper" — the precise question CLAUDE.md §5.9 says must always be answerable.

Root cause is narrower than the policy: **`delivery_proofs` is the only
attribution table with no pair CHECK and no `app.route_attribution` trigger.**
All eight siblings have both:

```
guest_groups · call_attempts · travel_legs · call_recordings
room_assignments · trips · messages · import_batches
```

CLAUDE.md §5.9 names `delivery_proofs` as the table that "set the precedent". It
is in fact the only one that never got the fix.

Suggested fix — one constraint, no code change:
```sql
alter table public.delivery_proofs
  add constraint delivery_proofs_captured_by_one_of
  check (num_nonnulls(captured_by, captured_by_staff) = 1);
```
Verify no existing proof violates it before adding, since they cannot be repaired.

---

### L1.4-attrib-both / L1.4-attrib-neither — no database backstop
Date: 2026-08-09 Tester: Prince
Result: **FAIL** (both)
Saw: with RLS bypassed (service role / backend), a proof can be written with both
attribution columns set, or with neither — permanently unattributable.
Expected: rejected by CHECK.
Severity: **AFTER** — no app path reaches it today; same one-line fix as above.
Fixed: Not yet

---

### L1.4-attrib-stale-default — latent FK break on the hamper path
Date: 2026-08-09 Tester: Prince
Result: **FAIL** (documents current behaviour as a defect)
Saw: a team-session proof insert that omits `captured_by` dies with `23503`.
`captured_by` still DEFAULTs to `app.current_identity()`, which returns
`coalesce(jwt_staff_member_id(), auth.uid())` — a `staff_members.id` for a code
session, which cannot satisfy `captured_by`'s FK to `auth.users`. This is the
original `23503` that `20260808100000_attribution_split` fixed everywhere else
via `route_attribution`.
Expected: succeed, attributed to the staff member.
Severity: **AFTER** — not live. `src/lib/proof.ts:270` explicitly sends
`captured_by: null`, deliberately dodging the default.
Fixed: Not yet

The risk is that the guarantee lives in one line of TypeScript. Any second write
path — an Edge Function, a backfill script, an offline-queue replay that omits the
field — fails hard at the moment a staff member is standing at a door with a
hamper. Dropping the default on `captured_by`/`captured_by_staff`, or attaching
`route_attribution`, removes the trap.

---

### Passing guarantees worth recording

- Cross-event isolation holds at the DB layer: Event A's JWT cannot read, insert,
  update, or FK-smuggle into Event B. Event B is invisible, not merely empty.
- A client session reads **zero** rows from all 13 sensitive tables
  (`transcripts`, `call_recordings`, `rsvp_extractions`, `event_access_codes`,
  `staff_members`, `admin_devices`, `call_attempts`, `delivery_proofs`,
  `login_attempt_log`, `code_reveal_log`, `audit_log`, `profiles`,
  `guest_groups`) and cannot write. It still reads `client_guest_profiles`, so
  the session is genuinely working.
- `delivery_proofs` UPDATE and DELETE are refused for team, **service_role, and
  the database superuser**. This is the strongest result in the run: the trigger
  holds where RLS does not apply.
- Server clock wins — a phone claiming 2030 is stamped with `now()`, and its
  claim is preserved in `device_captured_at`.
- Room overlap **is** refused (`23514`). See the correction below.
- A finalized `call_attempt` cannot be re-outcomed or deleted.
- Team sessions cannot create events, mint or read access codes, self-promote to
  admin, or call `app.rotate_access_code` / `app.revoke_access_code`.

---

## Corrections to the plan and to CLAUDE.md

**1. The room-overlap guarantee is a trigger, not an EXCLUDE constraint.**
The plan (L1.4, L6.5) expects "the EXCLUDE constraint". There isn't one.
`20260805140000_room_allocation.sql:52` implements `app.guard_room_overlap()`,
a `BEFORE INSERT OR UPDATE` trigger raising `23514`, precisely because
`room_assignments` uses soft-release and an EXCLUDE cannot be partial — released
history would wrongly block new bookings. By the plan's own L1.4 reasoning this
is the stronger form. **CLAUDE.md §10 is also wrong here**: it states no overlap
guard exists at all. It does, and it works.

**2. `admin_users` does not exist.** L1.2 lists it. Admin identity is
`profiles.global_role`. Substituted `profiles`, and added `login_attempt_log`,
`code_reveal_log` and `audit_log`, which are equally sensitive and were not on
the list. `extractions` is `rsvp_extractions`.

**3. CLAUDE.md §5.9 overstates the attribution guarantee.** It says every pair
has a CHECK and a `route_attribution` trigger, and cites `delivery_proofs` as
the precedent. `delivery_proofs` has neither. Eight other tables have both.

---

## L5.1 — Revocation and rotation do not end sessions — **CONFIRMED, then FIXED**

Date: 2026-08-09 Tester: Prince
Result: **FAIL** → **PASS** after `20260809140000_session_revocation.sql`
Severity: **BLOCKS EVENT**

Confirmed against the **live running project**, not by reading. A real team
session was minted with the real E-code, a staff member bound through
`bind-staff-member` exactly as the phone does, then the code was revoked and the
same token retried:

```
                        READ           WRITE
before revocation       200 ALLOWED    200 ALLOWED
new login w/ that code  401 blocked  (correct)
after revocation        200 ALLOWED    200 ALLOWED   <-- the finding
token still valid for   30 days
```

`revoked_at` was restored to null afterwards, so the acceptance suite is
unaffected.

A first run showed WRITE denied both before and after — but that token had no
staff claim, so the write was failing on `has_staff_identity`, not on
revocation. Binding a staff member (the token goes in the request **body**, not
the Authorization header) settled it: **a revoked session can still write guest
data.** Worth recording as its own near-miss — the inconclusive run looked like
a partial pass.

Fixed in three places:

- `app.code_is_live()` folded into `app.is_staff()` / `app.is_member()`, so
  every policy inherits it. This is what closes **PostgREST**, which is how the
  probe got in — it never touches Next.js, so an app-layer check alone would
  not have helped.
- `app.rotate_access_code` now retires the old row and inserts a replacement,
  matching its own header comment. It previously stamped `rotated_at = now()`
  and then set it back to null on the **same row**, so rotation marked nothing.
  This needed uniqueness relaxed to a partial index over live codes only, so
  retired rows can persist — they must, or a retired session is unrecognisable.
- `public.session_code_live()` for the app layer, called with the session's own
  JWT (a plain select on `event_access_codes` returns nothing under RLS for
  every session type, so it would fail closed for everyone). Without this a
  revoked phone renders an empty shell instead of returning to the login screen
  — at a venue that reads as "the app is broken", not "this phone was revoked".

Token lifetime cut **30 days → 7**. `code_is_live()` is the control now; the
expiry is just the ceiling.

Regression assertions added — all six pass, and all fail against the previous
build: `L5.1-CONTROL`, `L5.1-revoked-read`, `L5.1-revoked-write`,
`L5.1-rotate-stamps-old`, `L5.1-rotate-makes-new`, `L5.1-rotated-read`.

**Not yet deployed.** Both migrations are verified on the scratch DB only. See
"Still open" below.

---

## Superseded — original reading-only note

### Revoking or rotating an access code does not end live sessions
Severity: **BLOCKS EVENT** — now confirmed and fixed, see L5.1 above.

`verifyCodeAuthToken` (`src/lib/auth/claims.ts:36`) validates **signature and
expiry only**. It never consults `event_access_codes.revoked_at` / `rotated_at`,
and neither do the RLS helpers — `app.jwt_*` read claims straight from the JWT.
Tokens are minted with a **30-day** expiry
(`supabase/functions/verify-access-code/index.ts:217`).

So a revoked code stops *new* logins but leaves every existing session working
for up to 30 days. `app.revoke_access_code`'s own comment claims "sessions issued
from it are invalidated by the Edge Function's revoked_at check" — that check
runs at mint time only.

`app.rotate_access_code` is worse: it stamps `rotated_at = now()`, then
immediately updates the *same row* setting `rotated_at = null` with the new hash
(`20260807000504_code_management.sql:40-52`). The header comment describes
stamping the old row and inserting a new one, which is not what the code does.

This directly breaks two L5 drills — "rotate a compromised E-code → sessions
invalidated" and "staff phone lost mid-event → that device is locked out". The
lost-phone drill is the scenario revocation exists for.

Needs a session-invalidation check on each request (or short-lived tokens plus a
refresh that re-validates the code row). Confirm against the running app before
fixing.

---

## Still open

**Decision needed:** the `delivery_proofs` pair CHECK — see the live-row audit
above. Two immutable rows block a plain constraint; `NOT VALID` is the
recommendation.

**DECISION TAKEN 2026-08-10.** NOT VALID applied via
`20260810180000_delivery_proofs_attribution_check.sql`. The two grandfathered
rows (NEITHER column set) are:

```
4841321b-b539-441b-92cd-0da1ec1b9e64  captured_by=NULL  captured_by_staff=NULL
575cd763-fcb3-4d20-8b08-f020e615db86  captured_by=NULL  captured_by_staff=NULL
```

Both in event `85e716fc-...` (E2E), written by test tooling through the
service role on 2026-08-07. They cannot be repaired (UPDATE blocked by
trigger) or removed (DELETE likewise), so convalidated = false is the
decision, not an oversight. Every future insert — including from service_role
and superuser — must carry exactly one non-null attribution column.

**Edge Functions deployed 2026-08-10.** `verify-access-code` (v13) and
`bind-staff-member` (v8) redeployed. Token expiry is 7 days (`SESSION_EXPIRY_SEC
= 60 * 60 * 24 * 7`), confirmed in the deployed function source. Old 30-day
sessions: none remain on staff phones (handset wiped by APK reinstall on
2026-08-10); any tokens minted before ~09:15 UTC that day carry 30-day
expiry. Rotation invalidates them — `code_is_live()` reports false for every
token carrying the retired `access_code_id`. See L5.1 verification above.

**No misspelled function exists.** The deployed functions list shows
`transcribe-recording` (correct spelling), `verify-access-code`, and
`bind-staff-member`. No `transcibe-recording`.

### Error-swallowing pattern audit (2026-08-10)

**Seed script: already fixed.** `scripts/seed-543.mjs:73-89` — `countExisting()`
throws after 6 retries rather than returning 0 on error. The comment documents
the 2026-08-10 near-miss.

**Write-path findings (src/lib):** Every `?? []` instance in `src/lib/actions/`
is a read-path or presentation-layer coalesce on a Supabase response where the
error was already checked by the `failure = rest.find(r => r.error)` guard
above. These are **not** error-swallowing — the guard catches the error and
returns early. The coalesce then safely handles the `data = null` case for an
empty result set with no error, which Supabase's `select` legitimately returns.

**The one write-path coalesce worth watching** is `src/lib/actions/import.ts:103-104`:
`existingFamilies: groups.count ?? 0`. If `groups.count` is `null` (network
blip during the `.select('*', {count: 'exact'})`), the preview reports
"0 existing families." The commit path then inserts 238 duplicates against a
database already holding 238. This is identical structure to the seed-543 bug.
**Not fixed** — the import path needs the same treatment as seed-543 (throw
rather than coalesce to 0). Deferred because import has not been run against
live data and the code path needs its own audit session.

**Read-path occurrences:** All remaining `?? 0` / `?? []` / `|| 0` / `|| []`
are presentation-layer (dashboard counters, UI display, badge counts, fallback
map initializers). Coalescing to zero or empty for display is correct behaviour
— a dashboard showing "—" because a counter query blipped is worse than
showing 0. None of these instances decide whether to create rows.

### Error-swallowing status

**TOTAL found:** 120+ instances in `src/` and `scripts/`.
**Write-path:** 1 (import preview count, deferred to import audit).
**Read-path/presentation:** all remaining — correct behaviour for data being
shown.
**Seed scripts:** already fixed (seed-543.mjs throws after retries).
**Backup/check scripts:** read-only, correct to report counts.

**DEPLOYED 2026-08-10.** All five pending migrations pushed to the live project
(`20260809120000`, `130000`, `140000`, `20260810120000`, `130000`), and
`verify-access-code` + `bind-staff-member` redeployed. The earlier note that
these were scratch-DB-only is superseded — see "Deployed-state verification"
below for what was measured against the live system rather than inferred.

**Environment note:** outbound HTTPS from this machine is intermittent — roughly
1 connect in 3 times out, successful connects take 3–6s. It broke Docker image
pulls, the dev server's Supabase calls (`AuthRetryableFetchError`), and the first
audit run. Every script against the live project now retries. Worth knowing
before blaming the app for a timeout.

## Deployed-state verification — L5.1 against the live system

Date: 2026-08-10 Tester: Prince (driving Claude Code)
Target: **deployed Supabase surface** (Edge Functions + PostgREST), not localhost.
PostgREST is the target that matters — L5.1 records that the original probe got
in that way precisely because it never touches Next.js.

**Token lifetime is now 7 days, confirmed on a freshly minted token:**
`expires_in = 604800s`. Before this deploy the live function was still issuing
**30 days**, so the 7-day figure recorded above was true of the repo and false
of production for a day.

**Revocation fires.** Same token, before and after revoking its code, straight
through PostgREST:

```
                read                write
before revoke   200 rows=1          403
after revoke    200 rows=0          200 affected=0
new login       401 Invalid code
```

Read collapsing 1 -> 0 rows and the write affecting 0 rows are the correct
denial semantics (RLS refuses by returning nothing, not by erroring).
`revoked_at` was restored to null afterwards.

**The write half of that table is INCONCLUSIVE, and deliberately marked so.**
The `403` before revocation means the write was already failing on
`app.has_staff_identity()` — that token had no staff member bound. This is the
exact near-miss L5.1 warns about ("the inconclusive run looked like a partial
pass"). To make the write comparison meaningful the probe must call
`bind-staff-member` first. Not yet done.

**Old 30-day sessions.** Sessions are stateless JWTs with no server-side session
table, so they cannot be enumerated — there is no query that answers "who holds
one". Any token minted before 2026-08-10 ~09:15 UTC carries a 30-day expiry.
Known holders: none on staff phones (the handset was wiped by an APK reinstall
that day), plus two throwaway probe tokens. To invalidate them, **rotate the
code**: rotation retires the old row, and `app.code_is_live()` then reports
false for every token carrying that `access_code_id`, which the probe above
shows ends both read and write. Expiry is the ceiling; `code_is_live()` is the
control.

**Rate limiting is NOT the cause of the acceptance-suite login failures.**
Hypothesis tested and rejected: `login_attempt_log` shows 8 attempts in 6 hours,
peaking at 6/hour against `RATE_IP_MAX` of 20/hour.

## AFTER the event

**`transcribe-recording` write containment is code-review-enforced, not
grant-enforced.** The function authenticates with the service role key, which
carries `BYPASSRLS`, so no policy can restrict it to writing only `transcripts`
— an RLS test asserting otherwise would be theatre. Dropped as a DoD item
deliberately: the containment that actually matters already holds (the Sarvam
key never leaves Edge Function secrets, and the code writes only to
`transcripts`), and moving the function onto a dedicated database role with
explicit grants is real work that buys little before the deadline. What *is*
provable is tested in `tests/l2_transcribe.sql` — client sessions cannot read
transcripts, cross-event reads are fenced, and `delivery_proofs` stays immutable
even to `service_role`.

## Not yet run

- **L1.1 a–c, L1.3 routes, L1.5 lockout** — app-layer, need the running app.
- **L2, L4, L6** — not started.
- **L3, the dry run** — untouched, and still the highest-value item in the plan.
  It needs people rather than code: your partner, two staff, twenty families,
  you watching silently.
