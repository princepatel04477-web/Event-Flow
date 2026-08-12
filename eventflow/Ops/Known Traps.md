---
tags: [ops, gotchas, important]
updated: 2026-07-31
---

# Known Traps

Back to [[Nuvent]]. Learned the hard way — **do not rediscover these.**

For places where docs disagree with the SQL, see [[Schema Reality Check]] instead.

## Storage paths must start with the event id

Bucket policies read `(storage.foldername(name))[1]` and cast it to uuid. The **first
folder segment is the tenant key**.

```
delivery-proofs/{event_id}/{deliverable_id}/{uuid}.jpg
call-recordings/{event_id}/{group_id}/{uuid}.m4a
```

Get it wrong and every upload is rejected — and the error will look like a permissions
problem, not a path problem.

## Excel import must create a `guests` row for the family head

`client_guest_profiles` reads from `guests`, not `guest_groups`. An import that only creates
groups leaves the client's screen blank.

Worse: the bug does not surface until Phase 2, long after the import is "done". See
[[Excel Import]].

## `tel:` backgrounds the browser and Android may discard page state

> [!danger] Write the `call_attempts` row **before** the dial fires
> Keep the id in `sessionStorage` and rehydrate on resume. The flow is *resume-first*, not
> *continue-first*.

And remember the row **freezes** once `outcome` is set — `app.guard_call_attempt()` raises
on any later edit. Write the outcome once, at the end. See [[Guests and RSVP]].

## Real Excel is messy

Merged family rows, `"4th"` vs `"4TH"`, mobile numbers stored as decimals, `"Not Coming"` /
`"Not Sure"` buried in a remarks column, blank rows scattered through. Import must show a
**preview with a warning list** before it writes anything. See [[Excel Import]].

## No browser can record a live phone call

OS-level restriction, not a coding problem. It is why the native Capacitor module exists,
and why a post-call voice note must be a first-class fallback. See [[Open Questions]].

## `delivery_proofs` insert requires `captured_by = auth.uid()`

The RLS check is `app.is_staff(event_id) and captured_by = auth.uid()`. Setting it to
anyone else fails — **even for an admin**. Do not let a UI "upload on behalf of".

## `event_team` deletes return 0 rows, not an error

The delete policy is `using (app.is_admin())`. A non-admin delete silently affects nothing.
UI must check the affected count rather than treating a lack of error as success. See
[[Roles and Access]].

## `trips.seats_used` is trigger-maintained

`app.recount_trip_seats()` recomputes it from `trip_passengers`. Writing it from app code
will be overwritten, or worse, will look right until the next passenger change. See
[[Logistics]].

## The Supabase CLI is not on PATH

Use `npx supabase …`, always. And check `npx supabase orgs list` says **Varunya
Technologies** before running migrations — more than one account has been logged in on this
machine. See [[Supabase Project]].

## The Obsidian vault lives inside the repo

`eventflow/` sits inside the project folder. Once `git init` runs, Obsidian's
`workspace.json` will churn on every pane you open and show up in every diff. Either move
the vault to a sibling folder or gitignore `eventflow/.obsidian/workspace.json`.

## Related

[[Schema Reality Check]] · [[Open Questions]] · [[Excel Import]] · [[RSVP Capture Pipeline]]
