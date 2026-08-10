# Nuvent — Acceptance Report

Generated 2026-08-10T10:10:31.750Z

## Scoreboard

- Tier 0: 10/10 → 70/70
- Tier 1: 3/7 → 12/28
- Tier 2: 0/2 → 0/2
- **TOTAL: 82/100**
- **EVENT-READY: YES** (requires Tier 0 at 10/10; NOT BUILT/MANUAL do not count as passes)

## Results

| ID | Test | Result | Duration |
|---|---|---|---|
| T0.1 | Login persists | PASS | 12437ms |
| T0.2 | Import lands correctly | PASS | 10003ms |
| T0.3 | Import is idempotent | PASS | 11540ms |
| T0.4 | Guest list loads fast, windowed, search finds any guest | PASS | 10329ms |
| T0.5 | RSVP logging persists | PASS | 12821ms |
| T0.6 | Room double-booking rejected (UI) | PASS | 14169ms |
| T0.7 | Photo proof lands and is retrievable | PASS | 8308ms |
| T0.8 | Photo proof is tamper-evident | PASS | 644ms |
| T0.9 | Timestamps are server-stamped | PASS | 1385ms |
| T0.10 | Excel export round-trips | PASS | 6784ms |
| T1.1 | Multi-user, no corruption | PASS | 6388ms |
| T1.2 | Duplicate delivery handled | PASS | 8928ms |
| T1.3 | Check-in / check-out persists | PASS | 12906ms |
| T1.4 | Calling (tel: link) | FAIL | 39010ms |
| T1.5 | Arrival / departure tracking | SKIP | 0ms |
| T1.6 | Dashboard accuracy | SKIP | 0ms |
| T1.7 | Mobile viewport integrity | SKIP | 0ms |
| T2.1 | Vehicle allocation — no split, luggage capacity | FAIL | 1ms |
| T2.2 | Offline capture and sync | SKIP | 0ms |

## Failures

- **T1.4** — expected: see test; actual: `TimeoutError: page.waitForURL: Timeout 30000ms exceeded.`
- **T2.1** — expected: see test; actual: `Error: reset trip_passengers failed: TypeError: fetch failed`

## MANUAL — cannot be automated

None.

## NOT BUILT — the feature does not exist in this build

None.

## Notes

- The acceptance doc's SQL uses `family_heads` / `room_allocations` / `delivered_by` / `created_at`; the real schema uses `guest_groups` / `room_assignments` / `captured_by` / `recorded_at`. Tests here use the real names.
- `delivery_proofs` is insert-only by design; proof counts in re-runs are deltas, and T0.8 verifies the trigger holds against the service role.
- Run the suite twice to confirm stable scores.
