# DECISIONS.md

Non-obvious decisions, newest first. Per CLAUDE.md §14: record it here as it is
made, so the next session does not re-litigate it.

---

## 31 July 2026 — Phase 1 application build

### Realtime was never actually on

Migrations 0100–0700 never add any table to the `supabase_realtime` publication.
Supabase ships that publication empty, so `postgres_changes` subscribes, reports
`SUBSCRIBED`, and then delivers **zero events forever**. The calling queue's live
sync was inert from the moment it was written.

`20260731000800_realtime.sql` publishes `guest_groups` **and** `call_attempts`.
Two tables, not one: `attempt_count`, `last_attempt_at`, `last_outcome` and
`next_callback_at` in `v_rsvp_queue` are computed entirely from `call_attempts`,
and migration 0200 states outright that nothing in that chain writes to
`guest_groups`. Publishing only `guest_groups` would leave exactly the four
numbers a caller needs stale on every other phone.

Both tables get `replica identity full`. The client subscribes with
`filter: event_id=eq.<uuid>`, evaluated against the record in the payload; under
the default replica identity a DELETE carries only the primary key, so `event_id`
is absent and the event is dropped rather than delivered.

**The migration is written but NOT applied.** Live sync stays inert until someone
runs `supabase db push`. The file is idempotent, so re-running is safe.

### Dialing is now strict, and some families may show as un-dialable

`dialTarget()` returns a `tel:` link only for a number that reduces to 10 Indian
digits, or one explicitly stored with a leading `+`. Anything else returns null
and the call screen says "No dialable number on file".

The old code truncated with `slice(-10)`, which meant `+1 415 555 1234` dialed the
unrelated Indian number `4155551234`. Refusing to dial is the correct trade — but
if the source sheet is messy, some families will be un-dialable until the sheet is
fixed. The import preview already warns on exactly those cells.

### Row identity survives a corrected mobile

`source_row_hash` covers head name + primary mobile + group code. That alone meant
correcting a mobile the preview had *warned about* changed the row's identity and
created a duplicate family — i.e. following the tool's own advice broke CLAUDE.md
guarantee #6.

`classifyRows` gained a second pass matching on normalised head name, accepting an
existing family only when every identifying field present on both sides agrees and
exactly one candidate is compatible. Two existing families sharing a head name are
treated as no-match rather than merged into one of them: a duplicate is recoverable,
a wrong merge is not.

### "Callbacks due now" was impossible as specified

`v_rsvp_queue.next_callback_at` is `min(callback_at) filter (where callback_at > now())`
— it can only ever hold a **future** value, so `lte(next_callback_at, now)` matched
essentially nothing regardless of whose clock was used. The phone-clock complaint was
real but not the actual defect.

Relabelled **"Callback booked"**: filters non-null, sorts soonest-first, shows the time
on the row. A true *overdue callbacks* filter needs a view change — deferred to p1e
follow-ups.

### `getEventAccess()` is for honesty, not authorisation

A client-role account can reach `/[eventCode]/import` (RLS `app.is_member()` lets them
read their own event), and base-table reads return **zero rows with no error**. The
preview therefore reported a confident "238 New" against a database already holding all
238 — the one screen CLAUDE.md forbids cutting, lying.

`getEventAccess()` in `src/lib/supabase/queries.ts` computes admin / event_team / client /
none from the same two inputs `app.is_staff()` uses. It exists to tell the user the truth
where a zero-row read would otherwise be presented as fact. **RLS remains the fence** —
do not turn this into the authorisation gate.

### A cancelled dialer is not an outcome

`call_attempts` freezes permanently the instant `outcome` goes non-null. The original
screen offered "Abandon", which forced a caller who backed out of the dialer to either
invent an outcome or strand a null-outcome row holding the family's lock.

Replaced with two honest exits: **"Dial again"** re-fires `tel:` against the *same*
attempt row (backing out of the dialer is one attempt, not two), and **"No call
happened"** finalises as `other` with an explanatory note.

### Deliberately deferred

- **No automated tests.** No test runner in `package.json`, which the build agents were
  told not to edit. Every fix is verified by `tsc` / `eslint` / `build` and by reading,
  not by execution. `classifyRows` pass 2 and `describeCallbackProblem` are pure functions
  and the two things most worth covering first once a runner exists.
- **Nothing tested on a real Android phone** (CLAUDE.md §14 requires this). The call
  screen's `visibilitychange` duration, resume-at-mount stamping and `tel:` re-fire all
  depend on real Android page-lifecycle behaviour a laptop browser will not reproduce.
- `import_batches.status` can now be `'completed_with_errors'`. The column is free-form
  and nothing reads it yet — flag it if an admin screen ever enumerates statuses.
