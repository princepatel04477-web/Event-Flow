-- =====================================================================
-- B9: commit_guest_import supports remarks and rsvp_status
--
-- Preserves guest_groups.remarks and rsvp_status from import rows
-- when present (e.g. "declined" or "tentative" derived from remarks).
-- =====================================================================

create or replace function public.commit_guest_import(
  p_event_id   uuid,
  p_kind       text,
  p_filename   text,
  p_rows       jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch_id    uuid;
  v_row         jsonb;
  v_existing_id uuid;
  v_group_id    uuid;
  v_row_number  integer;
  v_hash        text;
  v_head        text;
  v_can_import  boolean;
  v_code        text;
  v_mobile      text;
  v_alt         text;
  v_city        text;
  v_side        public.app.side;
  v_group_type  public.app.group_type;
  v_pax         integer;
  v_gift        boolean;
  v_remarks     text;
  v_rsvp_status public.app.rsvp_status;
  v_reason      text;
  v_inserted    integer := 0;
  v_updated     integer := 0;
  v_skipped     integer := 0;
  v_failed      integer := 0;
begin
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
    v_rsvp_status:= nullif(coalesce(v_row ->> 'rsvpStatus', v_row ->> 'rsvp_status'), '')::app.rsvp_status;

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

    v_existing_id := null;

    select g.id into v_existing_id
      from public.guest_groups g
     where g.event_id = p_event_id
       and g.source_row_hash = v_hash
     limit 1;

    if v_existing_id is null then
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

    if v_existing_id is not null then
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
             rsvp_status      = coalesce(v_rsvp_status, g.rsvp_status),
             source_row_hash  = v_hash,
             updated_at       = now()
       where g.id = v_existing_id;

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

      perform public.upsert_import_leg(
        p_event_id, v_existing_id, 'arrival', v_row -> 'arrival'
      );
      perform public.upsert_import_leg(
        p_event_id, v_existing_id, 'departure', v_row -> 'departure'
      );
      continue;
    end if;

    begin
      insert into public.guest_groups (
        event_id, group_code, head_name, primary_mobile, alt_mobile,
        side, group_type, city, expected_pax, needs_return_gift,
        remarks, rsvp_status, source_row_hash, created_by
      ) values (
        p_event_id, nullif(v_code, ''), v_head, nullif(v_mobile, ''),
        nullif(v_alt, ''), v_side, v_group_type, nullif(v_city, ''),
        coalesce(v_pax, 1), coalesce(v_gift, false),
        nullif(v_remarks, ''), coalesce(v_rsvp_status, 'not_started'::app.rsvp_status),
        v_hash, auth.uid()
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

      perform public.upsert_import_leg(
        p_event_id, v_group_id, 'arrival', v_row -> 'arrival'
      );
      perform public.upsert_import_leg(
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
