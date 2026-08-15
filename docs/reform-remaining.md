# Reform runbook — what is left, and exactly how to finish it

**Date:** 15 August 2026 · **Branch:** `FINAL-002` · **Companion:** `docs/reform-verification.md`

§1 through §5 of `nuvent-reform-runbook.md` are complete and committed. This file
closes out everything that remained: the §2.2 census, §6.1–§6.4, the two §8
questions, and the merge.

Four of the items below end in **[SQL]** or **[YOU]** — they need the service-role
SQL editor, the Supabase CLI logged in as you, or two handsets. §0 of the runbook
puts those outside an agent's hands on purpose, so each one is written here as a
paste-ready block rather than run.

---

## §2.2 / §2.3 — corrupted trip rows: census, then repair **[SQL]**

**Why this is not a [CC] step in practice.** The census has to break down by
`event_id`, which means reading across events. A code session sees exactly one
event by RLS, and minting sessions for the others requires the service-role key —
which §0 forbids an agent from running. So the census is yours.

**What is already known.** `044fb8c`'s fix is verified against real data: a trip
created through the app's own `commitTrips` derivation carried
`2026-09-20T05:00:00+00:00` (10:30 IST), not the Y2K stamp
(`docs/reform-verification.md`). Any row below 2001 therefore predates the fix and
is historical, not ongoing.

### Census

```sql
-- 1. The count the runbook asks for.
select count(*) as y2k_rows
from trips
where scheduled_at < '2001-01-01';

-- 2. By event.
select e.code, e.id as event_id, count(*) as y2k_rows
from trips t
join events e on e.id = t.event_id
where t.scheduled_at < '2001-01-01'
group by e.code, e.id
order by y2k_rows desc;

-- 3. Five samples, with the column the real date is recoverable from.
select
  t.id,
  t.event_id,
  t.direction,
  t.scheduled_at,
  t.created_at,
  tl.travel_date          as recoverable_date,
  tl.travel_time          as recoverable_time,
  (t.scheduled_at at time zone 'Asia/Kolkata')::time as stamped_time_of_day
from trips t
left join trip_passengers tp on tp.trip_id = t.id
left join travel_legs tl on tl.id = tp.travel_leg_id
where t.scheduled_at < '2001-01-01'
order by t.created_at
limit 5;
```

**The answer to CHECKPOINT B, in advance:** the date **is** recoverable.
`commitTrips` builds `scheduled_at` as `` `${travelDate}T${scheduledTime}` ``
(`src/lib/actions/logistics.ts:316-319`), and the bug lost only the date half —
the time of day survived. `trip_passengers.travel_leg_id` is a direct FK to
`travel_legs`, so the correct date is one join away. Recovery is possible for any
trip that has passengers; a trip with none has no source date and is junk.

### Repair — only if the census returns rows

```sql
BEGIN;

-- 1. Count. Note the number.
select count(*) from trips where scheduled_at < '2001-01-01';

-- 2. Repair from the leg, preserving the time of day that survived the bug.
update trips t
set scheduled_at = (tl.travel_date + (t.scheduled_at at time zone 'Asia/Kolkata')::time)
                   at time zone 'Asia/Kolkata'
from trip_passengers tp
join travel_legs tl on tl.id = tp.travel_leg_id
where tp.trip_id = t.id
  and t.scheduled_at < '2001-01-01'
  and tl.travel_date is not null;

-- 3. Count again. The remainder are trips with no passenger leg to recover from.
select count(*) from trips where scheduled_at < '2001-01-01';

-- COMMIT only if the numbers are what you expect. Otherwise ROLLBACK.
COMMIT;
```

If step 3 leaves rows, they belong to a dead event and the runbook's own guidance
applies: delete them or exclude by `event_id`. Do not hand-repair data for an
event that is not running.

---

## §6.1 — the consent CHECK: proposed, not applied **[SQL]**

**Shipped already:** the application gate (`6f86081`). `transcribe-recording`
reads `consent_given` and returns `skipped: 'consent_missing'` before it claims a
transcript row and before any ₹0.75 is spent. The capture path already refused
non-consented audio (`harvest-upload.ts:35`; `voice-note.ts` writes `true`), so the
defence is layered at both ends.

**Still open:** the DB constraint. All 10 live `call_recordings` rows have
`consent_given = false` — synthetic test rows from 2026-08-06 on the sample event —
so a strict CHECK cannot be added while they exist.

### The three options, in the order I'd take them

1. **Delete the 10 rows, then add the CHECK.** They are synthetic. Nothing
   references them that matters. Cleanest end state.
2. **Backfill them to `true`, then add the CHECK.** Cheapest, but it writes a
   consent record that never happened — the row would then assert a guest agreed
   when no guest existed. Do not do this to a table whose whole purpose is
   evidence.
3. **Add the CHECK `not valid`.** New rows are constrained, the 10 stay. Honest
   and reversible, but leaves a permanently un-validated constraint that someone
   will trip over later.

### The migration, when you have decided

```sql
-- supabase/migrations/<timestamp>_call_recordings_consent_check.sql
--
-- Deliberately NOT committed to supabase/migrations/ yet: a file in that
-- directory applies on the next `db push`, and this one fails while the 10
-- legacy rows exist. Move it there only after the rows are resolved.

-- Option 1 — delete first (run in the same transaction):
-- delete from public.call_recordings where consent_given = false;

alter table public.call_recordings
  add constraint call_recordings_consent_required
  check (consent_given = true);

comment on constraint call_recordings_consent_required on public.call_recordings is
  'A2: audio may not exist in this table without recorded consent. The STT
   function also refuses non-consented rows (application gate, 2026-08-15);
   this constraint is the one that cannot be bypassed by a future call site.';
```

For option 3, append `not valid` to the `check (...)` clause and skip the delete.

**When it lands, flip T1.7 back.** `tests/t1_isolation.test.ts` currently asserts
the honest present state — the DB accepts a `consent_given = false` insert and the
STT gate refuses to transcribe it. The flip-back instruction is written inline at
the test. It must go back to asserting the insert is rejected, or the suite will
keep certifying the old behaviour after the constraint exists.

---

## §6.2 — deploy `extract-rsvp` **[YOU]**

Confirmed not deployed: `functions list` shows `verify-access-code`,
`bind-staff-member`, `transcribe-recording` — and nothing else. The source is at
`supabase/functions/extract-rsvp/index.ts` (709 lines) and the trigger that calls
it already exists in migration `20260812100000_extract_webhook.sql`.

**Four secrets, read straight from the source** (`index.ts:26-29`):

| Name | Where it comes from |
|---|---|
| `SUPABASE_URL` | injected by the platform — do not set |
| `SUPABASE_SERVICE_ROLE_KEY` | injected by the platform — do not set |
| `ANTHROPIC_API_KEY` | yours to supply |
| `EXTRACT_WEBHOOK_SECRET` | any strong random string; must equal the Vault value below |

```bash
# 1. Function secrets
npx supabase secrets set ANTHROPIC_API_KEY=<key> --project-ref xktxnkuzplhzxkevwrcj
npx supabase secrets set EXTRACT_WEBHOOK_SECRET=<random> --project-ref xktxnkuzplhzxkevwrcj

# 2. Deploy
npx supabase functions deploy extract-rsvp --project-ref xktxnkuzplhzxkevwrcj

# 3. Confirm
npx supabase functions list --project-ref xktxnkuzplhzxkevwrcj
```

Then, in the SQL editor once (**not** in a migration — these are secrets and
migrations are committed to git):

```sql
select vault.create_secret(
  'https://xktxnkuzplhzxkevwrcj.supabase.co/functions/v1/extract-rsvp',
  'extract_webhook_url');
select vault.create_secret('<the same value as EXTRACT_WEBHOOK_SECRET>',
  'extract_webhook_secret');
```

**Until both Vault rows exist the trigger warns and does nothing** — transcripts
still save, they just never reach extraction. That is the designed failure mode,
and it is also why "deployed" and "wired" are two separate things to check.

**Proof it is live:** flip a transcript into `complete` and watch a row appear.

```sql
select id, status, created_at from rsvp_extractions order by created_at desc limit 5;
```

---

## §6.3 — W3, the caller lock: report

### Current state — the import is wired

| | |
|---|---|
| Claims | `rsvp/status/[groupId]/page.tsx:49` and `rsvp/[groupId]/page.tsx:49`, via `claimGroupForCall` on open |
| Releases | `RsvpLogForm.tsx:204`, after a successful outcome save, guarded on `holdsLock` |
| Both routes | render the same `RsvpLogForm`, so both claim sites have a release site |
| RPC safety | `release_group`'s `or app.is_admin()` branch was removed by `20260813000000`; the client guard stays as belt-and-braces |

The original W3 defect — exported but never imported — is fixed. The
happy path releases.

### Test coverage — and the hole in it

| Layer | File | What it proves |
|---|---|---|
| DB | `tests/l4_lock_release.sql` | a non-holder cannot clear a lock, including an admin; a holder can. Six probes, three of them false-green guards. Needs Docker + the local stack |
| E2E | `e2e/tier1.spec.ts` T1.1 | two callers cannot both edit one family; a re-entrant claim by the holder still works |
| Unit | — | nothing |

**Nothing anywhere asserts that the lock is released after a save.** Every test
covers taking the lock and refusing to steal it; the release path — the thing W3
was about — is covered by no automated test at any layer. That is the gap the
handset round below is standing in for.

### The three paths that still leave a lock held for 15 minutes

1. **Abandon.** Open the RSVP status screen, take the lock, walk away without
   saving. Nothing releases on unmount or back-navigation.
2. **Force-kill.** Per CLAUDE.md §11c, killing the app mid-call also strands the
   in-flight `call_attempts` row. The lock is the second casualty.
3. **Signal loss at save.** The save fails, so the release never runs.

All three recover only by `locked_until` expiry. There is no manual override —
`20260813000000` removed the only path anyone other than the holder had
(CLAUDE.md §11b).

### Proposed W3 change — pick one, I recommend B

**A. Release on abandon (`pagehide` / `visibilitychange`).**
**I recommend against this, and it is worth saying why loudly:** `tel:` backgrounds
the WebView on *every single call*, so `visibilitychange` fires in the middle of
normal use. A naive listener would drop the lock the instant the caller dials —
exactly when they need to hold it. It could be made safe by excluding the dial
path, but that is a flag whose correctness depends on remembering to set it at
every future call site.

**B. A named admin override RPC — `force_release_lock`.** This is the shape
CLAUDE.md §11b already prescribes: a NEW, explicitly named RPC with its own
admin-only UI, audited, never a silent branch restored inside `release_group`.
Pair it with the thing that is actually missing on the floor — a screen listing
currently-locked families, which today does not exist, so a stuck lock is
discovered one family at a time by walking into it.

**C. Shorten the lock and re-claim on activity.** `claim_group` is already
re-entrant for the holder, so a 5-minute lock refreshed while the screen is open
would cut the stuck-lock window by two thirds with no new RPC. Weaker than B —
it shrinks the problem rather than giving anyone a way out of it.

No code has been changed for §6.3. The runbook says report first, and B needs a
migration, which is yours to run.

### Then — the handset round **[YOU]**

Two people, two handsets, on the real APK. A lock surviving any round is a blocker.

| # | Round | Expected |
|---|---|---|
| 1 | Normal: A opens family G, logs an outcome, saves | lock clears immediately; B can open G |
| 2 | Contention: A holds G, B opens G | B sees "locked by A, releases automatically by HH:MM" — and the *call* screen still works for B |
| 3 | Force-kill: A opens G, dials, force-closes the app mid-call | lock held; confirm it clears at expiry and that nothing on the queue implies it is free |
| 4 | Airplane mode: A opens G, goes offline, saves | the save queues; confirm what the lock does on reconnect |
| 5 | Abandon: A opens G, presses back without saving | lock held for the full 15 minutes — this is path 1 above, and round 5 is what tells you whether it hurts enough to fix |

---

## §6.4 — `generateStaticParams` + `dynamicParams = false`: closed, not applicable

Zero occurrences in `src/` on this branch. `git log -S` puts every one of them on
`feat/m2-static-export-bundle` (`fd60e01`, `10ffd94`) — the parked static-export
branch, which CLAUDE.md §11d says must not be merged without re-deciding §11a
first.

**So there is nothing to retire here.** The runbook item was written against the
static-export branch's shape, not this one. It becomes live again only if that
branch is ever resumed, and at that point it is part of the export decision rather
than a separate cleanup. No action.

---

## §8 — the two open questions, drafted for the event team

Neither can be answered from the repo. Send these as written — both are phrased to
get a specific answer rather than a nod.

> **1. "DEPARTURE: no departure we have to call it."**
> Which of these two is it?
> (a) The departure *details* are missing — families never told us when they are
> leaving, so the team has to phone each one and collect it. Then the fix is a
> departure calling queue, like the RSVP one.
> (b) The departure *screen* is not reachable, or you could not find it. Then the
> fix is navigation, and it may already exist.
>
> **2. "HOSPITALITY:" — the heading with nothing under it.**
> What was going to go there? Rooms, hampers and delivery proof already live under
> Hospitality in the app, so if the answer is one of those we should look at why
> the heading felt empty. If it is something else — welcome desk, check-in, guest
> requests — it may be a whole module we have not scoped.

Worth asking alongside them, per the discoverability finding in
`docs/reform-verification.md`: **"show me where you looked."** Three of the fifteen
feedback items were features that already shipped. Ask that first and the answer
tells you whether the next thing on the list is a build or a nav fix.

---

## The merge — one deliberate step **[YOU]**

`master` is an ancestor of `FINAL-002`: 54 commits ahead, zero behind, and
`origin/FINAL-002` is in sync. Fast-forward, no conflicts possible.

```bash
git checkout master
git merge --ff-only FINAL-002
git push origin master
```

`vercel.json` deploys whatever `master` points at, and the APK is a remote shell
over the deployed URL — so the fleet module, the §4 logistics work and the §5
display items all go live on that push, with **no APK reinstall**. Rollback is
`npx vercel rollback <deployment-url>`.

This is left to you rather than done for you because pushing `master` is a
production deploy, and the runbook's whole discipline is that those are decided,
not drifted into.

---

## Where each runbook section ended up

| § | State |
|---|---|
| 1.1–1.4 | Done — `044fb8c` (verified `af1e34c`), `14fc714`, `.ARCHIVED` renames, `efff911` |
| 2.1 | Done — drove the fleet design |
| 2.2 / 2.3 | Census SQL above, **[SQL]** |
| 2.4 | Done — JW Marriott correctly scoped to SHARMA26, closed in CLAUDE.md §10 |
| 3.1–3.5 | Done — `f005ca9`, migrations `20260815120000` + `…130000`, RLS proven by T1 |
| 4.1–4.6 | Done — `0b08a5a`, `f3fdebb`, two scope docs |
| 5.1–5.8 | Done — `e89acfc`, `6941748`; four were already built |
| 6.1 | App gate shipped; CHECK proposed above, **[SQL]** |
| 6.2 | Deploy block above, **[YOU]** |
| 6.3 | Report above; change proposed, not made; handset round **[YOU]** |
| 6.4 | Closed — not applicable on this branch |
| 7 | Deferred, unchanged |
| 8 | Questions drafted above |
