-- Seed messy import_rows for the backfill, mirroring CALLING_MASTER_LIST:
--   U | SR.NO | <blank> | PLACE | CONTACT | ID | Romm | bed | Pax
-- Includes every mess the prompt calls out: blanks, "201/202", duplicates
-- across families, and unreadable values.
\set ON_ERROR_STOP on

do $$
declare
  v_event uuid;
  v_batch uuid;
  v_user  uuid;
  r       record;
  n       integer := 0;
  v_gid   uuid;
begin
  select id into v_event from public.events where code = 'TSTEST';
  select id into v_user  from auth.users where email = 'admin@eventflow.test';

  delete from public.import_rows where event_id = v_event;
  delete from public.import_batches where event_id = v_event;

  insert into public.import_batches (event_id, kind, filename, total_rows, status, imported_by)
  values (v_event, 'guests', 'CALLING_MASTER_LIST.xlsx', 8, 'completed', v_user)
  returning id into v_batch;

  -- Families to hang the rows on. Two already exist from the base seed.
  for r in
    select * from (values
      ('Rameshbhai Patel', '201',     '2', 2),
      ('Nileshbhai Shah',  '202/203', '4', 3),
      ('Kiritbhai Mehta',  '',        '',  2),   -- blank room
      ('Dineshbhai Desai', 'NA',      '2', 1),   -- unreadable
      ('Jayeshbhai Joshi', '204',     '',  2),   -- no bed hint -> default
      ('Hasmukhbhai Trivedi','201',   '2', 1),   -- duplicate of Patel's room
      ('Bhaveshbhai Bhatt','205',     '3', 3)
    ) as t(head, romm, bed, pax)
  loop
    n := n + 1;

    select id into v_gid from public.guest_groups
     where event_id = v_event and head_name = r.head;

    if v_gid is null then
      insert into public.guest_groups (event_id, head_name, primary_mobile, expected_pax, rsvp_status)
      values (v_event, r.head, '98765432' || lpad(n::text, 2, '0'), r.pax, 'confirmed')
      returning id into v_gid;
    end if;

    -- Guests: one per pax, head first. The backfill needs real guest rows.
    -- `guests_single_head_per_group` allows at most one head, and the base
    -- seed already made one for the two pre-existing families.
    for i in 1..r.pax loop
      if not exists (
        select 1 from public.guests
         where group_id = v_gid and full_name = r.head || ' #' || i
      ) then
        insert into public.guests (event_id, group_id, full_name, is_head, age_band)
        values (
          v_event, v_gid, r.head || ' #' || i,
          i = 1 and not exists (select 1 from public.guests where group_id = v_gid and is_head),
          'adult'
        );
      end if;
    end loop;

    insert into public.import_rows (event_id, batch_id, row_number, raw, row_hash, status, group_id)
    values (
      v_event, v_batch, n + 1,
      jsonb_build_object(
        'U', n,
        'SR.NO', n,
        'FAMILY NAME', r.head,
        'PLACE', 'Ahmedabad',
        'CONTACT', '98765432' || lpad(n::text, 2, '0'),
        'ID', 'ID' || n,
        'Romm', r.romm,
        'bed', r.bed,
        'Pax', r.pax
      ),
      'hash-' || n, 'inserted', v_gid
    );
  end loop;

  -- A row the import never resolved to a family, carrying a room number.
  insert into public.import_rows (event_id, batch_id, row_number, raw, row_hash, status, group_id)
  values (
    v_event, v_batch, 99,
    jsonb_build_object('FAMILY NAME', '', 'Romm', '206', 'bed', '2', 'Pax', 2),
    'hash-orphan', 'error', null
  );

  raise notice 'seeded % import rows for event %', n + 1, v_event;
end $$;

select row_number, raw->>'FAMILY NAME' as family, raw->>'Romm' as romm,
       raw->>'bed' as bed, (group_id is not null) as resolved
  from public.import_rows
 order by row_number;
