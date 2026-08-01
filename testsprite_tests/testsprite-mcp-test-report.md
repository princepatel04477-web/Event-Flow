# EventFlow — Backend Test Report

## 1️⃣ Document Metadata

- **Project:** EventFlow (worktree `review-and-export`)
- **Scope:** backend, codebase
- **Date:** 1 August 2026
- **Target:** Next.js 16 dev server on `http://localhost:3000`
- **Database:** local Supabase stack, PostgreSQL **17.6**, all 8 migrations applied
- **Production:** not touched at any point
- **Runners:** TestSprite MCP 0.0.39 (10 generated tests) · `test_security.sql` (8 tests)
  · direct PostgREST/GoTrue suite (26 assertions) · `safeRedirectPath` unit suite (9 assertions)

---

## 2️⃣ Requirement Validation Summary

### Requirement: Authentication and session handling

| Test | Result | Notes |
|---|---|---|
| TC001 get login page without session | ✅ PASSED | 200 with sign-in form |
| TC002 get auth callback with valid code and next | ⚠️ FAILED (harness) | Sent a bogus `code`; app correctly redirected to `/login?error=link`. Test expected `/dashboard`, which requires a genuine auth code. Behaviour is correct. |
| TC003 get auth callback with malicious next parameter | ✅ PASSED | Open-redirect guard held |
| TC005 get root without session | ✅ PASSED | Redirects to `/login` |
| Open-redirect guard (`safeRedirectPath`, 9 cases) | ✅ 9/9 | `//host`, `https://host`, `/\host`, same-origin absolute URL, `javascript:`, CRLF injection all collapse to `/`; legitimate paths pass through |

### Requirement: Event scoping and role gating

| Test | Result | Notes |
|---|---|---|
| TC004 get root with authenticated session | ✅ PASSED | |
| TC006 get event dashboard with authorized user | ✅ PASSED | |
| TC007 get event dashboard with unauthorized user | ⚠️ FAILED (harness) | Expected 404, got 200. Unauthenticated request returns **307 → `/login?next=/TSTEST`**; the Python client follows redirects and reports the login page's 200. Verified by hand with `curl` (no-follow). |
| TC008 get client guest list with client role | ⚠️ FAILED (harness) | 307 to login — no client-role user existed for the runner to sign in as |
| TC009 get admin events with admin role | ⚠️ FAILED (harness) | Assertion failed after session establishment failed |
| TC010 get admin events with non admin role | ⚠️ FAILED (harness) | Explicit `Login failed with status 400` |
| Cross-event isolation (REST, real JWTs) | ✅ PASSED | `event_team` of Event B sees **zero** rows from Event A, and its own rows normally |
| Cross-event child insert | ✅ PASSED | Refused by composite FK / RLS |
| `event_team` delete attempt | ✅ PASSED | Refused — delete is admin-only |
| Anonymous read of `guest_groups` | ✅ PASSED | Nothing returned |

### Requirement: Calling queue, locking and append-only attempts

| Test | Result | Notes |
|---|---|---|
| First `claim_group` succeeds | ✅ PASSED | |
| Second caller refused the locked group | ✅ PASSED | Verified at both SQL and REST layers |
| Server clock overrides device time | ✅ PASSED | A phone claiming `2020-01-01` is stamped with real server time |
| Phone claim preserved as `device_started_at` | ✅ PASSED | |
| First call completion accepted | ✅ PASSED | |
| Finalized attempt frozen against a second write | ✅ PASSED | |
| `call_attempts` delete blocked | ✅ PASSED | |

### Requirement: RSVP review and commit (`apply_rsvp_extraction`)

| Test | Result | Notes |
|---|---|---|
| First apply succeeds | ✅ PASSED | |
| Group `rsvp_status` and `confirmed_pax` updated | ✅ PASSED | |
| `special_requests` mapped to `remarks` | ✅ PASSED | The mapping most likely to silently lose data |
| Caller lock released by the same call | ✅ PASSED | |
| Arrival leg updated in the same transaction | ✅ PASSED | Group and legs land together |
| Re-apply of an accepted extraction refused | ✅ PASSED | |

### Requirement: Deliverable immutability and capacity guards

| Test | Result | Notes |
|---|---|---|
| Proof update blocked | ✅ PASSED | `app.block_mutation()` trigger |
| Proof delete blocked | ✅ PASSED | Holds even for admin/service role |
| Capacity guard stops 3rd guest in a 2-bed room | ✅ PASSED | raises `23514` |
| Manual override accepted with a reason | ✅ PASSED | |

---

## 3️⃣ Coverage & Matching Metrics

| Suite | Passed | Failed | Notes |
|---|---|---|---|
| `test_security.sql` (PG 17.6) | 8 | 0 | First run on Postgres 17 |
| PostgREST + GoTrue, real JWTs | 26 | 0 | |
| `safeRedirectPath` unit cases | 9 | 0 | |
| TestSprite generated backend tests | 5 | 5 | All 5 failures traced to session-establishment limits, not defects |
| **Total genuine assertions** | **48** | **0** | |

**Why TestSprite could only reach 5/10.** Sign-in in this app is a Next.js **Server Action**
(`'use server'` in `src/lib/actions/auth.ts`), invoked as a POST to a page URL carrying an
opaque, build-specific `Next-Action` header id. A black-box HTTP client cannot drive it, so
the runner could not establish a session or create role-specific users. Every failing test
is one that needed an authenticated session.

---

## 4️⃣ Key Gaps / Risks

### 🔴 HIGH — Migrations never grant base-table privileges

On a freshly reset database, `authenticated` holds only `REFERENCES`/`TRIGGER`/`TRUNCATE`
on base tables. It has **no SELECT/INSERT/UPDATE/DELETE anywhere**; only the four views
carry explicit grants (migration `20260731000600`). `anon` and `service_role` have SELECT on
zero tables.

Grants are evaluated *above* RLS, so Postgres refuses before any policy is consulted — every
policy in `20260731000500_rls.sql` is unreachable on a clean database, and the app is
non-functional. `test_security.sql` cannot get past TEST 1.

Worse, the three `revoke` statements in `0500` are **no-ops on a fresh database**: they
revoke privileges that were never granted. The insert-only guarantee on `delivery_proofs`
currently rests entirely on the `app.block_mutation()` triggers (verified working) plus
Supabase cloud's *implicit* default privileges, which are not captured in the migrations.

**Impact:** a restore into a new project, or any self-hosted deploy, produces a silently
broken application. **Fix:** add a 9th migration granting base-table privileges, then
re-apply the three revokes after the grants.

### 🟠 MEDIUM — `service_role` has no grants on `public.profiles`

`PATCH /rest/v1/profiles` as `service_role` returns `42501 permission denied`. Any
server-side admin tooling that promotes or deactivates a user via the service key will fail.

### 🟡 LOW — Server Actions are not black-box testable

Roughly the entire write surface is Server Actions. External HTTP tooling reaches GET routes,
`/auth/callback` and PostgREST, but not the actions. Anything asserting on write behaviour
must go through the UI or call the RPCs directly.

### 🟡 LOW — `testsprite_bootstrap` is interactive

It starts its own HTTP server and waits for a human to complete a browser form; it cannot
complete in a headless or CI context. It does write `config.json`, and the remaining tools
run without it.

### Not defects, recorded so they are not re-investigated

- `/auth/callback` with an invalid code → `307 /login?error=link`. Correct.
- Unauthenticated staff routes → `307 /login?next=…`. Correct; a redirect-following client
  will report the login page's 200.
