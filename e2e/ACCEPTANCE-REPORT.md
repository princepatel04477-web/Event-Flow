# Nuvent — Acceptance Report

Generated 2026-08-09T07:37:06.254Z

## Scoreboard

- Tier 0: 10/10 → 70/70
- Tier 1: 7/7 → 28/28
- Tier 2: 2/2 → 2/2
- **TOTAL: 100/100**
- **EVENT-READY: YES** (requires Tier 0 at 10/10; NOT BUILT/MANUAL do not count as passes)

## Results

| ID | Test | Result | Duration |
|---|---|---|---|
| T0.1 | Login persists | PASS | 3220ms |
| T0.2 | Import lands correctly | PASS | 4254ms |
| T0.3 | Import is idempotent | PASS | 7341ms |
| T0.4 | Guest list loads fast, windowed, search finds any guest | PASS | 7224ms |
| T0.5 | RSVP logging persists | PASS | 7852ms |
| T0.6 | Room double-booking rejected (UI) | PASS | 10083ms |
| T0.7 | Photo proof lands and is retrievable | PASS | 5922ms |
| T0.8 | Photo proof is tamper-evident | PASS | 512ms |
| T0.9 | Timestamps are server-stamped | PASS | 1056ms |
| T0.10 | Excel export round-trips | PASS | 3888ms |
| T1.1 | Multi-user, no corruption | PASS | 4062ms |
| T1.2 | Duplicate delivery handled | PASS | 5540ms |
| T1.3 | Check-in / check-out persists | PASS | 9060ms |
| T1.4 | Calling (tel: link) | PASS | 2271ms |
| T1.5 | Arrival / departure tracking | PASS | 5095ms |
| T1.6 | Dashboard accuracy | PASS | 2946ms |
| T1.7 | Mobile viewport integrity | PASS | 40619ms |
| T2.1 | Vehicle allocation — no split, luggage capacity | PASS | 1824ms |
| T2.2 | Offline capture and sync | PASS | 4261ms |

## Failures

None.

## MANUAL — cannot be automated

None.

## NOT BUILT — the feature does not exist in this build

None.

## Notes

- The acceptance doc's SQL uses `family_heads` / `room_allocations` / `delivered_by` / `created_at`; the real schema uses `guest_groups` / `room_assignments` / `captured_by` / `recorded_at`. Tests here use the real names.
- `delivery_proofs` is insert-only by design; proof counts in re-runs are deltas, and T0.8 verifies the trigger holds against the service role.
- Run the suite twice to confirm stable scores.
