-- =====================================================================
-- Helper: upsert ONE travel leg for a group from the import payload.
-- public schema, client-callable — the server action drives it inside
-- commit_guest_import.
--
-- The leg object mirrors ParsedTravelLeg in src/lib/import/families.ts:
--   {
--     "travelDate": "2026-12-04", "travelTime": "10:30",
--     "mode": "train", "reference": "19004/KHANDESH EXP", "point": "VAPI",
--     "hasAnyValue": true
--   }
-- Coalesce semantics like everywhere else: a null cell leaves the DB value
-- alone; only the oldest leg per direction is updated (the same rule
-- apply_rsvp_extraction uses). Source is 'excel_import'.
-- =====================================================================

create or replace function public.upsert_import_leg(
  p_event_id  uuid,
  p_group_id  uuid,
  p_direction app.travel_direction,
  p_leg       jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_leg_id uuid;
begin
  if p_leg is null or jsonb_typeof(p_leg) <> 'object' then
    return;
  end if;
  if coalesce((p_leg ->> 'hasAnyValue')::boolean, false) = false then
    return;
  end if;

  select tl.id into v_leg_id
    from public.travel_legs tl
   where tl.group_id = p_group_id and tl.direction = p_direction
   order by tl.created_at
   limit 1;

  if v_leg_id is null then
    insert into public.travel_legs (
      event_id, group_id, direction, mode, travel_date, travel_time,
      reference, point, source
    ) values (
      p_event_id, p_group_id, p_direction,
      nullif(p_leg ->> 'mode', '')::app.travel_mode,
      nullif(p_leg ->> 'travelDate', '')::date,
      nullif(p_leg ->> 'travelTime', '')::time,
      nullif(p_leg ->> 'reference', ''),
      nullif(p_leg ->> 'point', ''),
      'excel_import'
    );
  else
    update public.travel_legs tl
       set mode        = coalesce(nullif(p_leg ->> 'mode', '')::app.travel_mode, tl.mode),
           travel_date = coalesce(nullif(p_leg ->> 'travelDate', '')::date, tl.travel_date),
           travel_time = coalesce(nullif(p_leg ->> 'travelTime', '')::time, tl.travel_time),
           reference   = coalesce(nullif(p_leg ->> 'reference', ''), tl.reference),
           point       = coalesce(nullif(p_leg ->> 'point', ''), tl.point),
           updated_at  = now()
     where tl.id = v_leg_id;
  end if;
end;
$$;

grant execute on function public.upsert_import_leg(uuid, uuid, app.travel_direction, jsonb)
  to authenticated;

-- =====================================================================
-- THE COMMIT FUNCTION (public schema — client-callable via supabase.rpc,
-- same as claim_group / apply_rsvp_extraction; `app` is for internal
-- helpers only).
-- =====================================================================
-- The write path that the preview has always pointed at. One Postgres
-- function, one transaction, one outcome — the exact opposite of the
-- old supabase-js loop of independent HTTP writes that was removed
-- from src/lib/actions/import.ts (see that file's header).
--
-- WHAT IT DOES, PER ROW:
--   - Skips rows flagged can_import = false (the blockReason is stored
--     on the import_rows row, not silently dropped).
--   - Matches an existing family by source_row_hash (fast path), or by
--     head name with compatible identity fields (the idempotency
--     fallback — see hash.ts "identity drift"). A re-run of the same
--     sheet therefore updates the remark/city/alt mobile in place
--     instead of creating a duplicate.
--   - On INSERT, writes guest_groups + the head guests row (is_head).
--     client_guest_profiles is built from guests, NOT guest_groups —
--     an import that only created groups would leave the client's
--     screen blank (Known Traps).
--   - Never touches rsvp_status / confirmed_pax / priority. Those are
--     evidence from the calling team; the sheet must never win against
--     them (CLAUDE.md guarantee #5, and the whole reason the old
--     client-side commit was deleted).
--
-- INPUT SHAPE:
--   p_batch is a jsonb array of row objects, exactly as produced by
--   toImportRowInput() in src/lib/import/rows.ts:
--     {
--       "rowNumber": 2,
--       "raw": {...sheet cells keyed by header...},
--       "canImport": true,
--       "blockReason": null,
--       "headName": "GHANSHYAMDAS KHATRI",
--       "groupCode": "1",
--       "primaryMobile": "9425155093",
--       "altMobile": null,
--       "expectedPax": 2,
--       "side": null,
--       "groupType": "family",
--       "city": "JABALPUR",
--       "remarks": "With JHETHANAND KHATRI",
--       "needsReturnGift": false
--     }
--   The server action re-derives each row's source_row_hash itself
--   (never trusts a client-supplied hash) and passes it as "rowHash".
--
-- RETURNS the same summary shape the preview shows:
--   { "inserted": N, "updated": N, "skipped": N,
--     "failed": N, "total": N, "batchId": uuid }
-- =====================================================================

create or replace function public.commit_guest_import(
  p_event_id uuid,
  p_kind     text,
  p_filename text,
  p_rows     jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch_id    uuid;
  v_row         jsonb;
  v_head        text;
  v_hash        text;
  v_group_id    uuid;
  v_existing_id uuid;
  v_mobile      text;
  v_alt         text;
  v_code        text;
  v_city        text;
  v_side        app.side;
  v_group_type  app.group_type;
  v_pax         integer;
  v_gift        boolean;
  v_remarks     text;
  v_row_number  integer;
  v_can_import  boolean;
  v_reason      text;
  v_inserted    integer := 0;
  v_updated     integer := 0;
  v_skipped     integer := 0;
  v_failed      integer := 0;
begin
  -- Staff gate. Same fence as every other write: a client or a stranger
  -- gets a clean 42501. (Admin is staff everywhere via app.is_staff.)
  if not app.is_staff(p_event_id) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a jsonb array of import rows.';
  end if;

  insert into public.import_batches (event_id, kind, filename, total_rows, status, imported_by)
  values (p_event_id, p_kind, p_filename, jsonb_array_length(p_rows), 'processing', auth.uid())
  returning id into v_batch_id;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_row_number := coalesce((v_row ->> 'rowNumber')::integer, 0);
    v_hash       := v_row ->> 'rowHash';
    v_head       := v_row ->> 'headName';
    v_can_import := coalesce((v_row ->> 'canImport')::boolean, true);
    v_reason     := v_row ->> 'blockReason';
    v_code       := v_row ->> 'groupCode';
    v_mobile     := v_row ->> 'primaryMobile';
    v_alt        := v_row ->> 'altMobile';
    v_city       := v_row ->> 'city';
    v_side       := nullif(v_row ->> 'side', '')::app.side;
    v_group_type := coalesce(nullif(v_row ->> 'groupType', '')::app.group_type, 'family');
    v_pax        := (v_row ->> 'expectedPax')::integer;
    v_gift       := coalesce((v_row ->> 'needsReturnGift')::boolean, false);
    v_remarks    := v_row ->> 'remarks';

    -- ---- rows the parser blocked: record why, count as failed --------
    if not v_can_import or v_head is null or v_head = '' then
      v_failed := v_failed + 1;
      insert into public.import_rows (
        event_id, batch_id, row_number, raw, row_hash, status, error
      ) values (
        p_event_id, v_batch_id, v_row_number,
        coalesce(v_row -> 'raw', '{}'::jsonb),
        coalesce(v_hash, ''),
        'error',
        coalesce(v_reason, 'Row has no head name.')
      );
      continue;
    end if;

    -- ---- match an existing family (idempotent) -----------------------
    v_existing_id := null;

    -- Fast path: exact row hash.
    select g.id into v_existing_id
      from public.guest_groups g
     where g.event_id = p_event_id
       and g.source_row_hash = v_hash
     limit 1;

    -- Identity-drift fallback: same head name + compatible identifying
    -- fields. Only accept an unambiguous match; two families sharing a
    -- head name are treated as no-match (a duplicate is recoverable, a
    -- wrong merge is not — hash.ts).
    if v_existing_id is null then
      -- Count same-name candidates first. If more than one exists, refuse
      -- to merge (limit + order-by would just pick an arbitrary one).
      if (select count(*) from public.guest_groups g
            where g.event_id = p_event_id
              and lower(regexp_replace(g.head_name, '\s+', ' ', 'g')) =
                  lower(regexp_replace(v_head, '\s+', ' ', 'g'))) = 1
      then
        select g.id into v_existing_id
          from public.guest_groups g
         where g.event_id = p_event_id
           and lower(regexp_replace(g.head_name, '\s+', ' ', 'g')) =
               lower(regexp_replace(v_head, '\s+', ' ', 'g'))
         limit 1;

        -- Same name but a different, non-null mobile on both sides means
        -- this is a different family, not a drifted row.
        if v_existing_id is not null and v_mobile is not null then
          if exists (
            select 1 from public.guest_groups g2
             where g2.id = v_existing_id
               and g2.primary_mobile is not null
               and g2.primary_mobile <> v_mobile
          ) then
            v_existing_id := null;
          end if;
        end if;
      end if;
    end if;

    -- ---- UPDATE existing ----------------------------------------------
    if v_existing_id is not null then
      -- Coalesce semantics: the sheet's blank cells leave the DB value
      -- alone (the same convention apply_rsvp_extraction uses). rsvp_status,
      -- confirmed_pax and priority are deliberately untouched — a corrected
      -- remark must update a family, but the calling team's RSVP evidence
      -- must never be overwritten by the Excel snapshot.
      update public.guest_groups g
         set group_code       = coalesce(nullif(v_code, ''), g.group_code),
             primary_mobile   = coalesce(nullif(v_mobile, ''), g.primary_mobile),
             alt_mobile       = coalesce(nullif(v_alt, ''), g.alt_mobile),
             city             = coalesce(nullif(v_city, ''), g.city),
             side             = coalesce(v_side, g.side),
             group_type       = v_group_type,
             expected_pax     = coalesce(v_pax, g.expected_pax),
             needs_return_gift= coalesce(v_gift, g.needs_return_gift),
             remarks          = coalesce(nullif(v_remarks, ''), g.remarks),
             source_row_hash  = v_hash,
             updated_at       = now()
       where g.id = v_existing_id;

      -- Ensure the head guests row exists even when the family pre-dates
      -- the import (e.g. created by hand in the admin UI).
      if not exists (
        select 1 from public.guests
         where group_id = v_existing_id and is_head
      ) then
        insert into public.guests (event_id, group_id, full_name, mobile, is_head)
        values (p_event_id, v_existing_id, v_head, v_mobile, true);
      end if;

      v_updated := v_updated + 1;
      insert into public.import_rows (
        event_id, batch_id, row_number, raw, row_hash, status, group_id
      ) values (
        p_event_id, v_batch_id, v_row_number,
        coalesce(v_row -> 'raw', '{}'::jsonb), v_hash, 'updated', v_existing_id
      );

      -- Travel legs from the sheet: arrival + departure. Coalesce so the
      -- file only fills what the calling team has not already recorded.
      perform app.upsert_import_leg(
        p_event_id, v_existing_id, 'arrival', v_row -> 'arrival'
      );
      perform app.upsert_import_leg(
        p_event_id, v_existing_id, 'departure', v_row -> 'departure'
      );
      continue;
    end if;

    -- ---- INSERT new family --------------------------------------------
    -- Note: if a row with this exact hash was inserted in a PREVIOUS run
    -- but the head-name fallback missed (e.g. the head name changed), the
    -- partial unique index on (event_id, source_row_hash) raises a
    -- duplicate_key. We catch it and report the row as skipped — the
    -- family already exists, and skipping is the honest outcome.
    begin
      insert into public.guest_groups (
        event_id, group_code, head_name, primary_mobile, alt_mobile,
        side, group_type, city, expected_pax, needs_return_gift,
        remarks, source_row_hash, created_by
      ) values (
        p_event_id, nullif(v_code, ''), v_head, nullif(v_mobile, ''),
        nullif(v_alt, ''), v_side, v_group_type, nullif(v_city, ''),
        coalesce(v_pax, 1), coalesce(v_gift, false),
        nullif(v_remarks, ''), v_hash, auth.uid()
      )
      returning id into v_group_id;

      insert into public.guests (event_id, group_id, full_name, mobile, is_head)
      values (p_event_id, v_group_id, v_head, nullif(v_mobile, ''), true);

      v_inserted := v_inserted + 1;
      insert into public.import_rows (
        event_id, batch_id, row_number, raw, row_hash, status, group_id
      ) values (
        p_event_id, v_batch_id, v_row_number,
        coalesce(v_row -> 'raw', '{}'::jsonb), v_hash, 'inserted', v_group_id
      );

      perform app.upsert_import_leg(
        p_event_id, v_group_id, 'arrival', v_row -> 'arrival'
      );
      perform app.upsert_import_leg(
        p_event_id, v_group_id, 'departure', v_row -> 'departure'
      );
    exception
      when unique_violation then
        v_skipped := v_skipped + 1;
        insert into public.import_rows (
          event_id, batch_id, row_number, raw, row_hash, status, error
        ) values (
          p_event_id, v_batch_id, v_row_number,
          coalesce(v_row -> 'raw', '{}'::jsonb), v_hash,
          'skipped', 'A family with this row hash already exists for this event.'
        );
    end;
  end loop;

  update public.import_batches
     set status       = 'completed',
         inserted_rows = v_inserted,
         updated_rows  = v_updated,
         skipped_rows  = v_skipped,
         completed_at  = now()
   where id = v_batch_id;

  return jsonb_build_object(
    'batchId',  v_batch_id,
    'inserted', v_inserted,
    'updated',  v_updated,
    'skipped',  v_skipped,
    'failed',   v_failed,
    'total',    jsonb_array_length(p_rows)
  );
end;
$$;

grant execute on function public.commit_guest_import(uuid, text, text, jsonb)
  to authenticated;
