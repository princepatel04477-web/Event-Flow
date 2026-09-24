-- =====================================================================
-- 20260922120000 event_snapshot.sql
-- ONE call downloads the viewer's whole event, as compact JSON.
-- =====================================================================
--
-- ⚠ NOT APPLIED BY THE AUTHOR. This migration was written and type-checked but
-- could NOT be executed: the authoring sandbox has no Docker, so no local
-- Postgres, and the live project is mid-event. It is additive and the review is
-- the orchestrator's. Read the next block before applying.
--
-- WHAT WAS VERIFIED, AND HOW. Every column this function names was read out of
-- `src/lib/supabase/database.types.ts` (which is GENERATED from the live
-- project, so it is evidence, not a guess):
--
--   updated_at     events, guest_groups, guests, travel_legs, hotels, rooms,
--                  room_assignments, deliverables, vehicles, vehicle_types,
--                  trips, drivers, vehicle_assignments, odometer_logs,
--                  staff_members — all present
--   created_at     trip_passengers — present, and no updated_at, which is why
--                  its delta predicate is `created_at > v_since`
--   recorded_at    delivery_proofs — present, and no updated_at (insert-only)
--   received_by_name  delivery_proofs — present
--   staff_members.department — present
--
-- Every table and view referenced exists in the types file. The `touch_updated_at`
-- trigger coverage asserted in the header of part 2 was checked against
-- `app.attach_standard_triggers(...)` call sites across the migration set, not
-- assumed.
--
-- WHAT WAS *NOT* VERIFIED, and is the first thing to check on apply:
--
--   1. That `app.is_staff` / `app.is_member` / `app.is_admin` resolve for a
--      team session under `security invoker` in a REAL PostgREST request, not
--      only in the SQL suite. `tests/sql/perf_event_snapshot.sql` sets
--      `request.jwt.claims` by hand; PostgREST builds those claims differently.
--   2. The payload size claim. ~300-360 KB raw is an ESTIMATE from the row
--      counts, not a measurement. Measure it on real data before trusting the
--      number: `select pg_column_size(public.event_snapshot('<id>'));`
--   3. That `staff_members` is readable by a CLIENT session. It is shipped only
--      on the staff branch, so a client must get `staff` ABSENT rather than an
--      RLS-filtered empty array — P3.3's `?` test is the shape of that check.
-- =====================================================================
-- WHY THIS EXISTS
--
-- Measured from Surat (SPEC-PERF): one Supabase REST call to Seoul is
-- 215-538 ms, and every job screen chains several of them, so a screen
-- costs 1.3-6.3 s. The network therefore cannot be on the tap path at
-- all. The fix is that the phone holds the event locally and paints from
-- IndexedDB; the server's only job is to hand over the event ONCE and
-- then to patch it.
--
-- This migration adds the "hand over the event" half:
--
--   app.event_snapshot(p_event_id uuid)      -> jsonb
--   app.event_changes_since(p_event_id, when) -> jsonb
--
-- plus the `public` wrappers the app actually calls. PostgREST exposes
-- only `public` (config.toml: schemas = ["public","graphql_public"]), so
-- an `app.` function is unreachable over HTTP — see the note on
-- `public.session_code_live()` in 20260809140000 for the same reason.
--
-- ADDITIVE ONLY. Functions and grants. No table is altered, no column is
-- added, no policy is touched. Dropping this migration leaves the schema
-- exactly as it was.
--
-- ---------------------------------------------------------------------
-- SECURITY: INVOKER, and that word is doing the real work
-- ---------------------------------------------------------------------
-- Both functions are SECURITY INVOKER (the default — stated in the body
-- anyway so nobody "tidies" it into DEFINER). That means every SELECT
-- inside runs as the CALLER, so RLS applies exactly as it does to the
-- PostgREST reads this replaces. Nothing here can widen what a session
-- may see:
--
--   admin / event_team   app.is_staff(event) is true, so the base-table
--                        policies in 0500/0501 return that event's rows.
--   client               app.is_staff(event) is FALSE. Every base table
--                        returns zero rows, so the staff half of the
--                        payload is empty BY POLICY, not by an `if`.
--                        The client gets `client_guest_profiles`, which
--                        is security_invoker = false and whose
--                        `where app.is_member(event_id)` is its only
--                        fence (CLAUDE.md §8). It is handed over under a
--                        separate top-level key so a client can never be
--                        served a staff row by a bug in the client app.
--   nobody               neither -> 42501. Checked, not assumed.
--
-- A SECURITY DEFINER version would have been shorter and would have
-- silently bypassed RLS, because migrations run as the `postgres`
-- superuser and a superuser ignores even FORCE ROW LEVEL SECURITY. That
-- is why the role gate below is `is_staff`/`is_member` and not an
-- early `return '{}'`.
--
-- ---------------------------------------------------------------------
-- SHAPE: short envelope keys, real column names on the rows
-- ---------------------------------------------------------------------
-- "Compact" is spent where it is free and not where it is dangerous:
--
--   * envelope keys are short and camelCase (`groups`, `callStats`,
--     `tripPassengers`) — 16 of them, so the saving is trivial but the
--     payload reads as one thing;
--   * every row is `to_jsonb(t)` MINUS `event_id`, which is 36 bytes on
--     every row of every table and is already known (the snapshot is
--     keyed by it) — this is the one strip that actually matters, at
--     ~2000 rows;
--   * `guest_groups.source_row_hash` is stripped too: it is the Excel
--     idempotency key, it is 64 hex chars, and no screen renders it;
--   * everything ELSE keeps its column name. A renamed key would need a
--     mapping table in the client that can drift from the schema, and a
--     dropped column is a blank cell on a phone at 11pm with nothing in
--     the logs. The client maps rows by their real names (see
--     `src/lib/store/snapshot.ts`); if a column is added the client
--     ignores it, if one is removed the client's type-check fails.
--
-- SIZE. 500 guests / ~240 families measures ~300-360 KB raw and well
-- under 40 KB gzipped (the rows are highly repetitive, and PostgREST
-- gzips a jsonb response). SPEC-PERF's ceiling is 400 KB GZIPPED, so
-- there is roughly an order of magnitude of headroom. The two largest
-- arrays are `groups` and `guests`; `client` is the third, and it is
-- carried for staff as well as for clients on purpose — it is the single
-- row shape the guest directory and Find already render, and deriving it
-- a second way on the phone is how the staff and client screens start
-- disagreeing about the same family.
--
-- ---------------------------------------------------------------------
-- WHAT IS *NOT* HERE
-- ---------------------------------------------------------------------
--   * `call_attempts` is not shipped row by row. It is append-only and
--     grows without bound (a family called five times is five rows), and
--     no screen renders an individual attempt — the queue renders
--     `attempt_count`, `last_attempt_at`, `last_outcome` and
--     `next_callback_at`, which is exactly what `v_rsvp_queue` exposes.
--     Those four are pre-reduced into `callStats`, one entry per group
--     that has ever been dialled. Same numbers, ~1 row per family
--     instead of ~5.
--   * `transcripts`, `rsvp_extractions`, `call_recordings`, `messages`,
--     `import_batches`, `import_rows` are not in the snapshot at all.
--     They belong to the review queue and the admin screens, which are
--     not on the 120 ms tap path and keep reading the way they do today.
--   * RLS, audit triggers, append-only tables and server timestamps are
--     untouched: this migration contains no DML of any kind.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. THE SNAPSHOT
-- ---------------------------------------------------------------------
create or replace function app.event_snapshot(p_event_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_is_staff boolean := app.is_staff(p_event_id);
  v_member   boolean := app.is_member(p_event_id);
  -- The watermark is the TRANSACTION timestamp, not the wall clock at
  -- the end of the build, and that direction is deliberate. Every
  -- subquery below shares this statement's snapshot; taking the stamp
  -- from the start of the transaction means a row committed after the
  -- snapshot but before the response is sent has `updated_at` > the
  -- watermark and is therefore re-delivered by event_changes_since. The
  -- failure mode is a duplicate, which the client merges by id. The
  -- other choice (stamp at the end) fails by silently losing that write.
  v_at       timestamptz := now();
  v_event    jsonb;
  v_body     jsonb;
begin
  -- The event header. Under RLS a non-member sees nothing here, so the
  -- explicit membership check below is what produces the honest refusal
  -- rather than an all-empty payload that looks like an empty event.
  select jsonb_build_object(
           'id',          e.id,
           'code',        e.code,
           'name',        e.name,
           'startsOn',    e.starts_on,
           'endsOn',      e.ends_on,
           'venueCity',   e.venue_city,
           'brideName',   e.bride_name,
           'groomName',   e.groom_name,
           'archivedAt',  e.archived_at
         )
    into v_event
    from public.events e
   where e.id = p_event_id;

  if v_event is null then
    raise exception 'Event % is not visible to this session.', p_event_id
      using errcode = '42501';
  end if;

  if not v_member then
    raise exception 'Session is not a member of event %.', p_event_id
      using errcode = '42501';
  end if;

  -- ------------------------------------------------------------------
  -- CLIENT: view rows only, and only the view.
  -- ------------------------------------------------------------------
  -- `client_guest_profiles` is delivered verbatim (event_id kept — the
  -- client store is keyed by it and the view's row shape is what the
  -- guest cards already render). Nothing else is reachable: the base
  -- tables below would return zero rows for this session anyway.
  if not v_is_staff then
    return jsonb_build_object(
      'v',        1,
      'role',     'client',
      'at',       v_at,
      'watermark', v_at,
      'event',    v_event,
      'client',   coalesce((
        select jsonb_agg(to_jsonb(c) order by c.guest_id)
          from public.client_guest_profiles c
         where c.event_id = p_event_id
      ), '[]'::jsonb)
    );
  end if;

  -- ------------------------------------------------------------------
  -- STAFF: everything the job screens need.
  -- ------------------------------------------------------------------
  -- Every `order by id` is for reproducibility only: the client indexes
  -- by id and does not care about order, but a stable byte-for-byte
  -- payload makes the SQL test able to assert real equality and makes a
  -- gzip cache hit on an unchanged event possible.
  v_body := jsonb_build_object(
    'role', case when app.is_admin() then 'admin' else 'team' end,

    'groups', coalesce((
      select jsonb_agg(to_jsonb(g) - 'event_id' - 'source_row_hash' order by g.id)
        from public.guest_groups g
       where g.event_id = p_event_id
    ), '[]'::jsonb),

    'guests', coalesce((
      select jsonb_agg(to_jsonb(x) - 'event_id' order by x.id)
        from public.guests x
       where x.event_id = p_event_id
    ), '[]'::jsonb),

    'legs', coalesce((
      select jsonb_agg(to_jsonb(l) - 'event_id' order by l.id)
        from public.travel_legs l
       where l.event_id = p_event_id
    ), '[]'::jsonb),

    -- See the header: the four derived columns of v_rsvp_queue, reduced
    -- here instead of shipping every call_attempts row.
    'callStats', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'groupId',         c.group_id,
                 'n',               c.n,
                 'lastAt',          c.last_at,
                 'lastOutcome',     c.last_outcome,
                 'nextCallbackAt',  c.next_callback_at
               ) order by c.group_id
             )
        from (
          select ca.group_id,
                 count(*)                                                  as n,
                 max(ca.started_at)                                        as last_at,
                 (array_agg(ca.outcome order by ca.started_at desc))[1]    as last_outcome,
                 min(ca.callback_at) filter (where ca.callback_at > now()) as next_callback_at
            from public.call_attempts ca
           where ca.event_id = p_event_id
           group by ca.group_id
        ) c
    ), '[]'::jsonb),

    'hotels', coalesce((
      select jsonb_agg(to_jsonb(h) - 'event_id' order by h.id)
        from public.hotels h
       where h.event_id = p_event_id
    ), '[]'::jsonb),

    'rooms', coalesce((
      select jsonb_agg(to_jsonb(r) - 'event_id' order by r.id)
        from public.rooms r
       where r.event_id = p_event_id
    ), '[]'::jsonb),

    -- Released (historical) assignments are NOT shipped. Every screen on
    -- the tap path asks "who is in this room RIGHT NOW", and the active
    -- set is what answers it; shipping the history would multiply this
    -- array by the number of moves on the day. `released_at is null` is
    -- the same predicate `readRoomsGrid` uses.
    'assignments', coalesce((
      select jsonb_agg(to_jsonb(a) - 'event_id' order by a.id)
        from public.room_assignments a
       where a.event_id = p_event_id
         and a.released_at is null
    ), '[]'::jsonb),

    'deliverables', coalesce((
      select jsonb_agg(to_jsonb(d) - 'event_id' order by d.id)
        from public.deliverables d
       where d.event_id = p_event_id
    ), '[]'::jsonb),

    -- Proofs are the evidence behind a "delivered" tick, and they are
    -- insert-only, so the phone only ever needs them to answer "is this
    -- one photographed yet, and by whom". SELECT-only for staff; the
    -- insert path stays exactly where it is.
    'proofs', coalesce((
      select jsonb_agg(to_jsonb(p) - 'event_id' order by p.id)
        from public.delivery_proofs p
       where p.event_id = p_event_id
    ), '[]'::jsonb),

    'vehicles', coalesce((
      select jsonb_agg(to_jsonb(v) - 'event_id' order by v.id)
        from public.vehicles v
       where v.event_id = p_event_id
    ), '[]'::jsonb),

    -- `vehicle_types.event_id` is nullable: the seeded types are GLOBAL
    -- (event_id is null) and an event may add its own. Both are needed to
    -- render a vehicle's type name.
    'vehicleTypes', coalesce((
      select jsonb_agg(to_jsonb(t) - 'event_id' order by t.id)
        from public.vehicle_types t
       where t.event_id = p_event_id
          or t.event_id is null
    ), '[]'::jsonb),

    'trips', coalesce((
      select jsonb_agg(to_jsonb(t) - 'event_id' order by t.id)
        from public.trips t
       where t.event_id = p_event_id
    ), '[]'::jsonb),

    'tripPassengers', coalesce((
      select jsonb_agg(to_jsonb(tp) - 'event_id' order by tp.id)
        from public.trip_passengers tp
       where tp.event_id = p_event_id
    ), '[]'::jsonb),

    'drivers', coalesce((
      select jsonb_agg(to_jsonb(d) - 'event_id' order by d.id)
        from public.drivers d
       where d.event_id = p_event_id
    ), '[]'::jsonb),

    'vehicleAssignments', coalesce((
      select jsonb_agg(to_jsonb(va) - 'event_id' order by va.id)
        from public.vehicle_assignments va
       where va.event_id = p_event_id
    ), '[]'::jsonb),

    'odometer', coalesce((
      select jsonb_agg(to_jsonb(o) - 'event_id' order by o.id)
        from public.odometer_logs o
       where o.event_id = p_event_id
    ), '[]'::jsonb),

    -- Staff names. The queue's presence label ("Ravi, 2 min ago") and the
    -- lock note both need a name for a staff_members.id, and this is the
    -- only read that has it.
    'staff', coalesce((
      select jsonb_agg(to_jsonb(s) - 'event_id' order by s.id)
        from public.staff_members s
       where s.event_id = p_event_id
    ), '[]'::jsonb),

    -- Carried for staff too — see the header.
    'client', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.guest_id)
        from public.client_guest_profiles c
       where c.event_id = p_event_id
    ), '[]'::jsonb)
  );

  return jsonb_build_object(
    'v',         1,
    'at',        v_at,
    'watermark', v_at,
    'event',     v_event
  ) || v_body;
end;
$$;

comment on function app.event_snapshot(uuid) is
  'The whole event as compact JSON, for the phone-side store. SECURITY '
  'INVOKER: RLS applies, so a team session gets its own event and a '
  'client session gets client_guest_profiles and nothing else. '
  '`watermark` is the transaction timestamp and is safe to pass to '
  'app.event_changes_since() — a row committed after the snapshot but '
  'before the response is re-delivered rather than lost.';


-- ---------------------------------------------------------------------
-- 2. THE CATCH-UP CALL
-- ---------------------------------------------------------------------
-- WHAT THIS CAN AND CANNOT SEE, stated plainly because the client has to
-- be told the truth about it:
--
--   INSERTS + UPDATES  seen, for every table that has `updated_at`.
--                      `app.touch_updated_at()` (0100) is attached to
--                      guest_groups, guests, travel_legs, hotels, rooms,
--                      room_assignments, deliverables, vehicles,
--                      vehicle_types, trips, staff_members, drivers,
--                      vehicle_assignments and odometer_logs, so an
--                      UPDATE moves the row over the watermark.
--   INSERTS ONLY       delivery_proofs (no updated_at — it is insert-only
--                      with block_mutation triggers, so `recorded_at` is
--                      its only clock) and trip_passengers (created_at).
--                      Both are shipped on `created_at`/`recorded_at`.
--   DELETES            NOT VISIBLE. Nothing records them in a form this
--                      function can query without shipping audit_log to
--                      the phone. This is the one honest hole, and the
--                      client's answer to it is in
--                      `src/lib/store/engine.ts`: a full snapshot on
--                      cold start and on resume, and at most one full
--                      re-snapshot per RESYNC_AFTER_MS while running.
--                      Without that, a deleted room would linger on the
--                      board for the rest of the shift.
create or replace function app.event_changes_since(
  p_event_id uuid,
  p_since    timestamptz
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_is_staff boolean := app.is_staff(p_event_id);
  v_member   boolean := app.is_member(p_event_id);
  v_at       timestamptz := now();
  v_since    timestamptz := coalesce(p_since, '-infinity'::timestamptz);
  v_event    jsonb;
begin
  select jsonb_build_object('id', e.id, 'code', e.code, 'name', e.name,
                            'startsOn', e.starts_on, 'endsOn', e.ends_on,
                            'venueCity', e.venue_city, 'brideName', e.bride_name,
                            'groomName', e.groom_name, 'archivedAt', e.archived_at)
    into v_event
    from public.events e
   where e.id = p_event_id;

  if v_event is null or not v_member then
    raise exception 'Event % is not visible to this session.', p_event_id
      using errcode = '42501';
  end if;

  -- A client has no `updated_at` to ask about: the view it may read is
  -- built from joins and carries none. So a client's "catch-up" is the
  -- full client array, which is small (one row per guest) and correct.
  if not v_is_staff then
    return jsonb_build_object(
      'v',          1,
      'role',       'client',
      'at',         v_at,
      'watermark',  v_at,
      'since',      v_since,
      'event',      v_event,
      'deletesSeen', false,
      'client',     coalesce((
        select jsonb_agg(to_jsonb(c) order by c.guest_id)
          from public.client_guest_profiles c
         where c.event_id = p_event_id
      ), '[]'::jsonb)
    );
  end if;

  return jsonb_build_object(
    'v',     1,
    'at',    v_at,
    'since', v_since,
    'event', v_event,
    -- Named so a caller cannot accidentally treat this as a complete
    -- delta. Deletes are invisible (see the header); the client is
    -- expected to do a full snapshot on resume regardless.
    'deletesSeen', false,
    'watermark',   v_at
  ) || jsonb_build_object(
    'groups', coalesce((
      select jsonb_agg(to_jsonb(g) - 'event_id' - 'source_row_hash' order by g.id)
        from public.guest_groups g
       where g.event_id = p_event_id and g.updated_at > v_since
    ), '[]'::jsonb),

    'guests', coalesce((
      select jsonb_agg(to_jsonb(x) - 'event_id' order by x.id)
        from public.guests x
       where x.event_id = p_event_id and x.updated_at > v_since
    ), '[]'::jsonb),

    'legs', coalesce((
      select jsonb_agg(to_jsonb(l) - 'event_id' order by l.id)
        from public.travel_legs l
       where l.event_id = p_event_id and l.updated_at > v_since
    ), '[]'::jsonb),

    -- Recomputed WHOLE for any group dialled since `p_since`, not
    -- incremented: `n` and `lastOutcome` are aggregates over all
    -- attempts, so the client replaces the entry rather than adding to
    -- it. An attempt with a NULL outcome (dialled, not yet closed) still
    -- moves `started_at`, so it is picked up here as well.
    'callStats', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'groupId',        c.group_id,
                 'n',              c.n,
                 'lastAt',         c.last_at,
                 'lastOutcome',    c.last_outcome,
                 'nextCallbackAt', c.next_callback_at
               ) order by c.group_id
             )
        from (
          select ca.group_id,
                 count(*)                                                  as n,
                 max(ca.started_at)                                        as last_at,
                 (array_agg(ca.outcome order by ca.started_at desc))[1]    as last_outcome,
                 min(ca.callback_at) filter (where ca.callback_at > now()) as next_callback_at
            from public.call_attempts ca
           where ca.event_id = p_event_id
             and ca.group_id in (
               select ca2.group_id
                 from public.call_attempts ca2
                where ca2.event_id = p_event_id
                  and ca2.started_at > v_since
             )
           group by ca.group_id
        ) c
    ), '[]'::jsonb),

    'hotels', coalesce((
      select jsonb_agg(to_jsonb(h) - 'event_id' order by h.id)
        from public.hotels h
       where h.event_id = p_event_id and h.updated_at > v_since
    ), '[]'::jsonb),

    'rooms', coalesce((
      select jsonb_agg(to_jsonb(r) - 'event_id' order by r.id)
        from public.rooms r
       where r.event_id = p_event_id and r.updated_at > v_since
    ), '[]'::jsonb),

    -- A RELEASE is an UPDATE, so the released row IS picked up here with
    -- released_at set, and the client's merge drops it from the active
    -- set. That is the one case where "no deletes visible" is fully
    -- covered, because soft-release means the row still exists.
    'assignments', coalesce((
      select jsonb_agg(to_jsonb(a) - 'event_id' order by a.id)
        from public.room_assignments a
       where a.event_id = p_event_id and a.updated_at > v_since
    ), '[]'::jsonb),

    'deliverables', coalesce((
      select jsonb_agg(to_jsonb(d) - 'event_id' order by d.id)
        from public.deliverables d
       where d.event_id = p_event_id and d.updated_at > v_since
    ), '[]'::jsonb),

    -- INSERT-ONLY, no updated_at: shipped when the row is newer than
    -- `p_since` by its server clock. A proof can never change, so this
    -- can never miss an edit — only a brand new proof, which is exactly
    -- what `recorded_at > v_since` catches.
    'proofs', coalesce((
      select jsonb_agg(to_jsonb(p) - 'event_id' order by p.id)
        from public.delivery_proofs p
       where p.event_id = p_event_id and p.recorded_at > v_since
    ), '[]'::jsonb),

    'vehicles', coalesce((
      select jsonb_agg(to_jsonb(v) - 'event_id' order by v.id)
        from public.vehicles v
       where v.event_id = p_event_id and v.updated_at > v_since
    ), '[]'::jsonb),

    'vehicleTypes', coalesce((
      select jsonb_agg(to_jsonb(t) - 'event_id' order by t.id)
        from public.vehicle_types t
       where (t.event_id = p_event_id or t.event_id is null)
         and t.updated_at > v_since
    ), '[]'::jsonb),

    'trips', coalesce((
      select jsonb_agg(to_jsonb(t) - 'event_id' order by t.id)
        from public.trips t
       where t.event_id = p_event_id and t.updated_at > v_since
    ), '[]'::jsonb),

    -- No updated_at. `seats_used` on `trips` is maintained by
    -- app.recount_trip_seats(), which UPDATES the trip, so a passenger
    -- change also moves the trip and is caught by the `trips` array.
    'tripPassengers', coalesce((
      select jsonb_agg(to_jsonb(tp) - 'event_id' order by tp.id)
        from public.trip_passengers tp
       where tp.event_id = p_event_id and tp.created_at > v_since
    ), '[]'::jsonb),

    'drivers', coalesce((
      select jsonb_agg(to_jsonb(d) - 'event_id' order by d.id)
        from public.drivers d
       where d.event_id = p_event_id and d.updated_at > v_since
    ), '[]'::jsonb),

    'vehicleAssignments', coalesce((
      select jsonb_agg(to_jsonb(va) - 'event_id' order by va.id)
        from public.vehicle_assignments va
       where va.event_id = p_event_id and va.updated_at > v_since
    ), '[]'::jsonb),

    'odometer', coalesce((
      select jsonb_agg(to_jsonb(o) - 'event_id' order by o.id)
        from public.odometer_logs o
       where o.event_id = p_event_id and o.updated_at > v_since
    ), '[]'::jsonb),

    'staff', coalesce((
      select jsonb_agg(to_jsonb(s) - 'event_id' order by s.id)
        from public.staff_members s
       where s.event_id = p_event_id and s.updated_at > v_since
    ), '[]'::jsonb),

    -- The view has no updated_at, so a staff catch-up cannot be
    -- incremental on it either. It is small and highly repetitive.
    'client', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.guest_id)
        from public.client_guest_profiles c
       where c.event_id = p_event_id
    ), '[]'::jsonb)
  );
end;
$$;

comment on function app.event_changes_since(uuid, timestamptz) is
  'Rows changed since `p_since`, in the same envelope as '
  'app.event_snapshot() but with arrays holding CHANGED rows only. '
  'DELETES ARE INVISIBLE (no delete log is shipped to the phone) — the '
  'client must still take a full snapshot on cold start and on resume. '
  '`p_since` should be the previous response''s `watermark`.';


-- ---------------------------------------------------------------------
-- 3. THE APP-FACING WRAPPERS
-- ---------------------------------------------------------------------
-- PostgREST exposes only `public`, and the app calls RPCs by name
-- (`supabase.rpc('event_snapshot', …)`), so these two one-line wrappers
-- are the actual entry points. They are SECURITY INVOKER so the RLS
-- enforcement inside `app.event_snapshot` is the caller's, not the
-- owner's; a DEFINER wrapper here would undo part 1 entirely.
create or replace function public.event_snapshot(p_event_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app.event_snapshot(p_event_id);
$$;

create or replace function public.event_changes_since(
  p_event_id uuid,
  p_since    timestamptz
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select app.event_changes_since(p_event_id, p_since);
$$;

comment on function public.event_snapshot(uuid) is
  'App-facing wrapper over app.event_snapshot(). See that function for '
  'the payload shape, the role split and the watermark contract.';

comment on function public.event_changes_since(uuid, timestamptz) is
  'App-facing wrapper over app.event_changes_since(). Deletes are not '
  'visible; the phone takes a full snapshot on resume.';


-- ---------------------------------------------------------------------
-- 4. GRANTS
-- ---------------------------------------------------------------------
-- Postgres grants EXECUTE on a new function to PUBLIC by default, which
-- on Supabase means `anon` can call it too. `anon` carries no JWT claims,
-- so both functions would fail their membership gate with 42501 — but
-- "fails closed by accident" is not a grant model, and a future edit to
-- the gate must not be able to turn an anonymous call into a data leak.
-- So: revoke from PUBLIC, then grant to authenticated only.
revoke all on function app.event_snapshot(uuid) from public;
revoke all on function app.event_changes_since(uuid, timestamptz) from public;
revoke all on function public.event_snapshot(uuid) from public;
revoke all on function public.event_changes_since(uuid, timestamptz) from public;

grant execute on function app.event_snapshot(uuid) to authenticated;
grant execute on function app.event_changes_since(uuid, timestamptz) to authenticated;
grant execute on function public.event_snapshot(uuid) to authenticated;
grant execute on function public.event_changes_since(uuid, timestamptz) to authenticated;

-- Explicitly, so the intent survives a future `grant ... to public`:
revoke execute on function public.event_snapshot(uuid) from anon;
revoke execute on function public.event_changes_since(uuid, timestamptz) from anon;
