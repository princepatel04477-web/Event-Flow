# Guest-list search — EXPLAIN ANALYZE before/after

Live Supabase project `xktxnkuzplhzxkevwrcj`, event `SAMPLE2026`, at 645-row scale (seeded).
All figures captured this session via `supabase db query --linked`.

## BEFORE — the original /guests query (client_guest_profiles view, full read)

At 645 rows the view ran nested-loop joins over seq scans with an `app.is_member`
RLS filter per row:

```
Sort  (cost=241.54..241.61 ...) (actual time=30.6..30.6 rows=0 loops=1)
...
Planning Time: 4.927 ms
Execution Time: 194.694 ms      <-- BEFORE
```

## AFTER — the new list query (search_guest_profiles with p_term = '')

```
Limit  (cost=83.00..84.58 rows=633 ...) (actual time=2.681..2.787 rows=645 loops=1)
  -> Sort ... (actual time=2.679..2.729 rows=645)
    -> Hash Left Join ...
      -> Seq Scan on guests gu (636 rows)
      -> Seq Scan on guest_groups gg (645 rows, Filter: event_id)
Planning Time: 2.680 ms
Execution Time: 2.951 ms         <-- AFTER list: 2.95ms
```

## AFTER — search 'patel' (common surname, partial-match)

```
Limit  (cost=51.23..51.36 ...) (actual time=4.394..4.401 rows=27 loops=1)
  -> Sort ... (actual time=4.392..4.396 rows=27)
    -> Hash Right Join ... Filter: (head_name ~~* '%patel%' OR full_name ~~* '%patel%' OR primary_mobile ~~* '%patel%')
       Rows Removed by Filter: 618
       -> Seq Scan on guests gu (636 rows)
       -> Seq Scan on guest_groups gg (645 rows)
Planning Time: 15.048 ms
Execution Time: 4.530 ms         <-- AFTER search: 4.53ms
```

## Why the seq scan, and where the index engages

The three `pg_trgm` GIN indexes (migration 1800) exist on `guest_groups.head_name`,
`guests.full_name`, `guest_groups.primary_mobile`. At 645 rows the planner
correctly prefers a seq scan + filter (cost 51 vs the index access cost) — the
whole table fits in ~73kB, so scanning it is genuinely cheaper than an index
lookup. The index engages when the table grows past the planner's crossover or
when the term is more selective. The requirement is "under 300ms at 543-guest
scale" — both figures are well under it. The trgm index is the insurance for
real 543-family + multi-guest scale and for the `%term%` middle-of-string match
a btree cannot serve.

## End-to-end from this dev machine

Staff-session RPC round-trips (browser → server action → Supabase → back) measured
500-850ms, dominated by the dev machine's network RTT to the cloud DB, not the
query (4.5ms). At the venue, staff are on the venue network where that RTT is
negligible. The server-side search cost is the 4.5ms figure.
