-- =====================================================================
-- M26: Atomic fleet plan commit RPC
--
-- Commits all trips, passengers, and vehicle status updates in a single
-- database transaction. All-or-nothing: if any trip or passenger insert
-- fails, the entire plan rolls back and no vehicle status changes.
-- =====================================================================

create or replace function public.commit_fleet_plan(
  p_event_id uuid,
  p_trips jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip jsonb;
  v_passenger jsonb;
  v_trip_id uuid;
  v_trip_count integer := 0;
  v_vehicle_ids uuid[] := array[]::uuid[];
  v_vehicle_id uuid;
begin
  if not app.is_staff(p_event_id) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  if p_trips is null or jsonb_typeof(p_trips) <> 'array' then
    raise exception 'p_trips must be a jsonb array of trips.';
  end if;

  for v_trip in select * from jsonb_array_elements(p_trips) loop
    v_vehicle_id := (v_trip ->> 'vehicleId')::uuid;
    if v_vehicle_id is not null then
      v_vehicle_ids := array_append(v_vehicle_ids, v_vehicle_id);
    end if;

    insert into public.trips (
      event_id,
      vehicle_id,
      direction,
      scheduled_at,
      pickup_point,
      drop_point,
      driver_name,
      driver_mobile,
      status,
      seats_capacity
    ) values (
      p_event_id,
      v_vehicle_id,
      (v_trip ->> 'direction')::public.app.travel_direction,
      (v_trip ->> 'scheduledAt')::timestamptz,
      v_trip ->> 'pickupPoint',
      v_trip ->> 'dropPoint',
      v_trip ->> 'driverName',
      v_trip ->> 'driverMobile',
      'planned',
      (v_trip ->> 'capacity')::integer
    )
    returning id into v_trip_id;

    for v_passenger in select * from jsonb_array_elements(coalesce(v_trip -> 'groups', '[]'::jsonb)) loop
      insert into public.trip_passengers (
        event_id,
        trip_id,
        group_id,
        travel_leg_id,
        pax
      ) values (
        p_event_id,
        v_trip_id,
        (v_passenger ->> 'groupId')::uuid,
        nullif(v_passenger ->> 'travelLegId', '')::uuid,
        coalesce((v_passenger ->> 'pax')::integer, 1)
      );
    end loop;

    v_trip_count := v_trip_count + 1;
  end loop;

  -- Update vehicles status to assigned
  if array_length(v_vehicle_ids, 1) > 0 then
    update public.vehicles
       set status = 'assigned',
           updated_at = now()
     where event_id = p_event_id
       and id = any(v_vehicle_ids);
  end if;

  return jsonb_build_object(
    'ok', true,
    'tripCount', v_trip_count
  );
end;
$$;

grant execute on function public.commit_fleet_plan(uuid, jsonb)
  to authenticated;
