# Nuvent — Post-Event Reform Runbook

**Source:** `reforms of software.txt` (event team feedback) + SRS
**Context:** No live event. Schema lockout is lifted. Verification discipline is not.
**Repo:** `C:\dev\EventFlow` · branch `master` · production alias `nuvent-five.vercel.app`

---

## How to use this file

Steps run **in order**. Each step has a stop condition — do not advance past a
red stop condition by working around it.

Tags:
- **[CC]** — paste the prompt into Claude Code
- **[YOU]** — Prince does this manually
- **[SQL]** — Prince runs this himself in the Supabase SQL editor, *never* an agent, *never* a `.mjs` script

**CHECKPOINT** markers are decision points. Stop, read the output, decide, then continue.

---

## §0 — Standing constraints

Paste this at the top of **every** Claude Code session in this runbook.

```
STANDING CONSTRAINTS — apply to every task in this session:
- ONE change at a time. Show me the full diff and WAIT for approval before applying.
- One concern per commit. No drive-by fixes bundled in.
- No dependency changes. No package.json edits.
- No refactors, no file moves, no renames beyond exactly what I ask.
- Schema changes: PROPOSE migration SQL only. Never apply. I run migrations myself.
- Never run a script with the service-role key. Never write to the database directly.
- If the task needs a second concern, a dependency, or an unplanned schema change:
  STOP and tell me. Do not proceed.
- Repo: C:\dev\EventFlow. Branch: master. Read CLAUDE.md before you start.
- Single agent only. I am not running another session in parallel.
```

**Why the service-role rule is absolute:** `repoint-exec.mjs` ran with service-role
access, bypassed RLS, and wrote the JW Marriott hotel row to the wrong `event_id`.
That is the failure mode this rule exists to prevent.

---

## §1 — Clear the decks

Pending work from the SHARMA26 push must land before anything new is designed on top of it.

### 1.1 — Commit the `commitTrips` date fix **[CC]**

```
There are uncommitted modifications to pack.ts and pack.test.ts fixing the
commitTrips bug that stamped scheduled_at as 2000-01-01T{time}.

1. Show me the diff of both files.
2. Run the test suite for pack.test.ts and show me the output.
3. If green, commit ONLY those two files. Message:
   "fix(logistics): stamp commitTrips scheduled_at with real trip date"

Nothing else goes in this commit.
```

**Stop condition:** tests red → do not commit, report the failure and stop.

---

### 1.2 — Commit the staged deletions **[CC]**

```
Two byte-identical BackRow.tsx files are staged for deletion.

1. Confirm they are byte-identical.
2. Confirm nothing imports either path.
3. If both confirmed, commit ONLY those deletions. Message:
   "chore: remove duplicate BackRow components"

Do not touch departures.ts, fleet.ts, or messages.ts in this commit.
```

---

### 1.3 — Archive the mutation scripts **[CC]**

```
Rename these three files. Do NOT delete them:
  repoint-exec.mjs   -> repoint-exec.mjs.ARCHIVED
  repoint-step1.mjs  -> repoint-step1.mjs.ARCHIVED
  insert-test.mjs    -> insert-test.mjs.ARCHIVED

These are service-role scripts that bypassed RLS and corrupted an event_id.
They are kept as evidence of what ran, not for reuse.

Single commit: "chore: archive service-role mutation scripts (evidence, do not run)"
Leave the other untracked scratchpad files alone for now.
```

---

### 1.4 — Dead-code deletions **[CC]**

```
departures.ts, fleet.ts, and messages.ts have uncommitted dead-code deletions.

For EACH file separately:
1. Show me the diff.
2. Confirm the deleted code has no remaining callers.
3. Commit that file alone, with its own message.

Three separate commits. Do not combine them.
```

**Note:** `fleet.ts` is about to be rewritten in §3. Clean it now so the fleet
work starts from a known state.

---

## §2 — Recon before design

### 2.1 — Full schema and modelling audit **[CC]**

```
Read-only recon. No edits, no writes, no migrations.

I'm scoping a fleet management module from event team feedback. Before any design:

1. Show me the current trips table definition — every column, constraint, FK, index.
2. Show me any existing vehicle, driver, or fleet-related table or column
   anywhere in the schema.
3. Show me how hampers are currently modelled: per-guest, per-room, or
   per-family-head? Show the table and its FKs.
4. Show me the message tables left over from the WhatsApp cut — full definitions.
5. Show me what fleet.ts currently does today.
6. Show me the rsvp_status type definition — the exact literal values.
7. Show me how guest mobile numbers are stored and whether a normalisation
   helper already exists.

Report only. I will design from this.
```

**CHECKPOINT A — read the output before continuing.**

Three answers change the plan downstream:

| Question | If… | Then… |
|---|---|---|
| Hampers per-room or per-guest? | per-room | §5.4 is a modelling change, not a display tweak — re-scope it |
| Message tables reusable for drivers? | yes | §4.4 needs no new schema |
| Phone normalisation helper exists? | yes | §5.1 reuses it, does not write a new one |

---

### 2.2 — Scope the corrupted trip rows **[CC]**

```
Read-only. SELECT queries only. No writes.

Commit 044fb8c shipped a bug stamping scheduled_at as 2000-01-01T{time}.

1. Count rows in trips where scheduled_at < '2001-01-01'.
2. Break that count down by event_id.
3. For 5 sample rows show: id, event_id, scheduled_at, created_at, and every
   FK that might carry the real date (guest arrival, room check-in, etc).
4. Tell me whether the correct date is RECOVERABLE from another column, or
   whether it is lost.

Report only. Do NOT write a repair script.
```

**CHECKPOINT B.**

- Recoverable → proceed to 2.3
- Not recoverable → these rows are historical junk from a dead event. Decide:
  delete them, or leave them and exclude by `event_id`. Do not hand-repair data
  for an event that isn't running.

---

### 2.3 — Repair, by hand **[SQL]**

Supabase SQL editor. Prince only.

```sql
BEGIN;

-- 1. Count first. Note the number.
SELECT count(*) FROM trips WHERE scheduled_at < '2001-01-01';

-- 2. UPDATE with an explicit WHERE, derived from the CHECKPOINT B answer.
--    Write this yourself from the audit output. Do not paste a generated script.

-- 3. Count again. Must match step 1.

-- COMMIT only if the numbers match. Otherwise ROLLBACK.
COMMIT;
```

---

### 2.4 — JW Marriott mis-scoped row **[CC]**

```
Read-only. No writes.

A hotel row (JW Marriott) was written to the wrong event_id — Sample 2 instead
of SHARMA26 — by repoint-exec.mjs running with service-role access.

1. Show me that hotel row and its current event_id.
2. Show me every child row referencing it: rooms, allocations, anything with
   an FK. Count each, with their event_ids.
3. Tell me whether repointing the parent alone would orphan or mis-scope any child.

Report only.
```

Repair — if needed — is **[SQL]**, by hand, same transaction pattern as 2.3.

---

## §3 — Fleet module (the bulk of the feedback)

Roughly 70% of `reforms of software.txt` describes one thing that does not exist:
a **fleet management module**. KM counting, repeat-car logic, driver assignment,
spare-time tracking, fairness across vehicles, manual odometer entry.

`pack.ts` packs trips. It does not manage a fleet. This is new.

### 3.1 — Propose the schema **[CC]**

```
Based on the §2.1 audit, propose migrations for a fleet module.

Tables:
- vehicles          — plate no, label/car no, type, capacity, event_id
- drivers           — name, mobile, event_id
- vehicle_assignments — vehicle_id, driver_id, date (drivers swap cars per day)
- odometer_logs     — vehicle_id, date, start_km, end_km, start_time, end_time
- trips (ALTER)     — add vehicle_id, driver_id, status, pickup_location, drop_location

Requirements:
- Event-scoped RLS on every new table, matching the existing pattern exactly.
- CHECK constraints stated explicitly, including end_km >= start_km.
- Server-side clock enforcement. No client timestamps.
- NO stored aggregates. KM totals, availability windows, and fairness ranking
  are all query-time. Storing them creates drift.
- Follow the existing num_nonnulls CHECK pattern where a column is conditional.

Show me the SQL. Do NOT apply anything.
Then tell me exactly what breaks in existing code if these land.
```

**CHECKPOINT C** — read the "what breaks" list before applying anything.

---

### 3.2 — Apply the migration **[SQL]**

Prince runs it. Verify RLS on the new tables immediately after — with an
**authenticated non-admin client**, not an admin one. An admin client proves
nothing about event_team permissions.

---

### 3.3 — Manual entry UI **[CC]**

```
Build the manual fleet entry screen against the new schema.

Fields, per the event team's exact request:
  Car No, Plate No, Driver No, Starting KMS, Ending KMS, Starting Time, Ending Time
Entered per vehicle, per day.

- Reuse the existing react-hook-form + Zod pattern already in the codebase.
- Reuse existing shadcn components. No new dependencies.
- Validation mirrors the DB CHECK constraints — do not invent new rules.

Show me the diff before applying. Single commit.
```

---

### 3.4 — KM dashboard **[CC]**

```
Build the KM counting dashboard.

Per vehicle: total KM, total trips, and a fairness indicator showing which
vehicles are over- or under-used relative to the fleet average.

- All figures computed at query time from odometer_logs and trips. Nothing stored.
- Use Recharts, already a dependency.
- Read-only view. No mutations.

Show me the diff before applying. Single commit.
```

---

### 3.5 — Vehicle availability **[CC]**

```
The event team needs to know whether a car is free after a drop-off, before
its next pickup.

1. First, WITHOUT writing code, tell me how availability should be derived
   from trips + vehicle_assignments. Show me the query.
2. Wait for my approval of the logic.
3. Then build the view.

Derived state only. Do not add an availability column to any table.
```

---

## §4 — Logistics intelligence

Each item here depends on §3 being live. Do not start these before the fleet
module has real data in it.

### 4.1 — Time-wise sorting **[CC]**

```
Sort the arrivals/logistics view by time.
Depends on the §2.3 date repair being complete — confirm scheduled_at is clean
before you start.
Single commit. Display and query-order only.
```

### 4.2 — Vehicle suggestion by PAX **[CC]**

```
Suggest vehicles based on arriving PAX at a given time slot, using the capacity
data in the vehicles table.

Reference capacities from the SRS: Sedan ~3, Family SUV ~4,
Tempo Traveller 17-24, Bus 34-56 — but read actual capacity from the DB,
do not hardcode.

The system PROPOSES. A human commits. Manual override always available.
This is the same pattern as the RSVP extraction pipeline — follow it.

Show me the algorithm and its test cases BEFORE writing implementation code.
```

### 4.3 — Route buffering **[CC]**

```
Add a configurable buffer to route time suggestions. Event team asked for
1 to 1.5 hours.

Make it a setting, not a hardcoded constant.
Single commit.
```

### 4.4 — Driver pickup messaging **[CC]**

```
Drivers should receive a message listing their total pickups for the day.

FIRST: confirm whether the existing message tables (from the WhatsApp cut)
fit this use case. Report before building.

If they fit, use them. If not, tell me what's missing before proposing schema.
```

### 4.5 — Google Distance Matrix **[CC]** — scope only, do not build yet

```
Scope Google Distance Matrix integration for logistics recommendations.

Report on:
- API key management and where it lives
- Estimated cost per event at ~465 guests
- Rate limits
- The failure path when the API is down or the key is rejected
- What the system does WITHOUT it (graceful degradation)

Report only. No code, no dependency added.
```

### 4.6 — Unannounced arrivals **[CC]** — scope only

```
Event team scenario: extra people arrive with no prior information, at the same
time as a scheduled arrival. They want the system to reschedule and assign a car
with at least 2 hours of slack before its next pickup.

Scope this. It must PROPOSE only — a human commits — matching the existing
extraction pipeline pattern.

Report the design. No implementation yet.
```

---

## §5 — Small display items

These sit on existing columns. Fast, low-risk, high day-to-day value for the
event team. Can run in parallel with §4 if you want quick wins.

### 5.1 — WhatsApp deep link **[CC]**

```
Add a WhatsApp message button beside the existing call button on the
guest/family-head row.

- Plain wa.me deep link from the guest's existing mobile number.
- No API, no new dependency, no new table, no message logging.
- Reuse the phone normalisation helper found in the §2.1 audit. Do not write a new one.
- If the number is missing or malformed, render the button disabled.

Show me the diff. Single commit:
"feat(guests): add WhatsApp deep-link button beside call button"
```

### 5.2 — Red for declined **[CC]**

```
Guests whose RSVP status is "not attending" render in red on the calling list.

- Use the exact status literal from the §2.1 audit.
- Styling only. No filter, sort, or query change.
- Use the existing Tailwind destructive token. No new hex values.

Show me the diff. Single commit:
"feat(rsvp): highlight declined guests in red on calling list"
```

### 5.3 — Room tap → guest panel **[CC]**

```
Tapping a room number opens a read-only panel showing, for that room:
guest name, mobile number, hamper received status.

- Display only. No mutations.
- Check whether the data is already loaded in the parent before adding a query.
- Reuse the existing shadcn sheet/dialog component.

Show me the diff. Single commit.
```

### 5.4 — Hamper colour coding **[CC]**

> **Blocked on CHECKPOINT A.** If hampers are modelled per-room rather than
> per-guest, this is a modelling change and needs its own design pass first.

```
On the rooms view: red = no hamper delivered, green = hamper delivered.
One dot per person in the room, yellow.

- Derive PAX from existing room/guest data.
- Styling and derived render only. No schema, no writes.

Show me the diff. Single commit.
```

### 5.5 — Hamper photo from room number **[CC]**

```
Event staff tap a room number and get the option to add a hamper photo.

The insert-only proof tables already exist. This should be a routing/UI change,
not new schema.

1. Confirm the existing proof table fits. Report before building.
2. Preserve insert-only semantics. No updates, no deletes, no client timestamps.

Show me the diff. Single commit.
```

### 5.6 — Family head + PAX on room allocation **[CC]**

```
Room allocation view must show family head name and total PAX, with singles
handled correctly.

Display only, from existing columns.
Single commit.
```

### 5.7 — Source → destination map link **[CC]**

```
Add a button opening directions from source to destination on the logistics row.

Plain maps deep link. No API, no dependency.
Single commit.
```

### 5.8 — Active event name always visible **[CC]**

```
Display the active event name persistently in the UI chrome so wrong-event data
entry is immediately visible.

This is the guard against the JW Marriott class of mistake.
Display only. Single commit.
```

---

## §6 — Previously parked, now unblocked

No live event means these can finally land.

### 6.1 — Consent CHECK constraint **[CC]** then **[SQL]**

```
call_recordings has rows with consent=false, and no CHECK constraint enforcing
consent. Non-consented audio has been reaching the STT provider.

1. Count existing rows with consent=false.
2. Propose the CHECK constraint SQL.
3. Tell me what must happen to the existing violating rows before it can apply.
4. Separately: show me where the STT upload happens, and propose an
   application-layer gate on consent=true as defence in depth.

Propose only. Do not apply the migration.
```

T1.7 currently fails on purpose as a reminder this is missing. **When the
constraint lands, update T1.7 so it tests the real behaviour instead of standing
as a marker.**

### 6.2 — Deploy `extract-rsvp` **[CC]**

```
The extract-rsvp edge function was reported built but was never deployed.

1. Confirm the function source exists and show it to me.
2. Show me the deploy command and what env vars it needs.
3. Do NOT deploy. I will run it.
```

### 6.3 — Caller lock removal (W3) **[CC]**

```
releaseGroupAfterCall was exported but never imported, leaving 15-minute locks
on guest_groups rows. The fix was written but never tested on real handsets.

W3 (caller lock removal) was parked because W2 touched the same code path.
W2 is now committed.

1. Show me the current state of the lock code and confirm the import is wired.
2. Show me the test coverage for it.
3. Propose the W3 change.

Report before changing anything.
```

Then **[YOU]** — two people, two handsets: normal round, force-kill mid-call
round, airplane-mode mid-call round. A lock surviving any round is a blocker.

### 6.4 — Retire `generateStaticParams` + `dynamicParams = false` **[CC]**

```
generateStaticParams with dynamicParams = false was a short-term routing fix.
It must be retired before a second event is onboarded.

1. Show me every route using this pattern.
2. Explain what breaks for a second event.
3. Propose the fix. Report before changing anything.
```

---

## §7 — Deferred

| Item | Status |
|---|---|
| Static export migration | v2 — 12 nested dynamic segments make it unworkable |
| Full WhatsApp API integration | v2 — tables remain in schema; §5.1 deep link covers the near-term need |
| Auto-departure feature | Unparked, but needs the §8 answer first |

---

## §8 — Open questions

Two things block specific steps and I don't have answers:

1. **"DEPARTURE: no departure we have to call it"** — does this mean departure
   details are missing and the team must phone families for them, or that the
   departure module itself isn't reachable? §7 auto-departure and any departure
   work waits on this.

2. **"HOSPITALITY:"** — the heading is in the feedback file with nothing under
   it. Worth asking the event team what they meant to write there. It may be a
   whole module.

---

## Sequence summary

```
§1  Clear the decks          — commits only, no new work
§2  Recon + data repair      — CHECKPOINT A, B
§3  Fleet schema + UI        — CHECKPOINT C, the main build
§4  Logistics intelligence   — depends on §3 having real data
§5  Small display items      — can run in parallel with §4
§6  Unparked items           — anytime after §1
```

Do not start §3 before CHECKPOINT A. Do not start §4 before §3 has data.
